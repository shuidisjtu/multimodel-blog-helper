import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKSPACE = join(REPO_ROOT, '.release', '__test__');
const COMMIT = 'a'.repeat(40);

/** 必需文件的最小集合, 内容任意; check 只校验清单与磁盘是否自洽。 */
const REQUIRED_FILES: Record<string, string> = {
  '.env.example': 'OPENAI_API_KEY=placeholder\n',
  'README.md': '# 发布制品运行说明\n',
  'package.json': '{}\n',
  'package-lock.json': '{}\n',
  'dist/server/bootstrap/server.js': '// compiled entry\n',
  'web/dist/index.html': '<!doctype html>\n',
};

// 子进程不得继承 CI 的 GITHUB_SHA, 否则 check 会拿它与夹具里的 commit 比对。
const { GITHUB_SHA: _ciSha, ...envWithoutCiSha } = process.env;

function listFiles(directory: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFiles(join(directory, entry.name), path));
    } else if (path !== 'manifest.json') {
      files.push(path);
    }
  }
  return files.sort();
}

function fileRecord(directory: string, path: string) {
  const bytes = readFileSync(join(directory, ...path.split('/')));
  return {
    path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** 建立一份结构合法的制品; 返回仓库相对路径(CLI 要求路径位于 .release 内)。 */
function createArtifact(directoryName = `release-${COMMIT}`): string {
  const directory = join(WORKSPACE, directoryName);
  for (const [path, content] of Object.entries(REQUIRED_FILES)) {
    const target = join(directory, ...path.split('/'));
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }
  writeManifest(directory, COMMIT, false);
  return relative(REPO_ROOT, directory).replace(/\\/g, '/');
}

function writeManifest(directory: string, commit: string, dirty: boolean): void {
  const manifest = {
    schemaVersion: 1,
    commit,
    dirty,
    files: listFiles(directory).map((path) => fileRecord(directory, path)),
  };
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** 可信清单的存放位置(绝对路径, 不依赖 cwd); 它不参与制品自洽校验, 只作为 --expect 的外部锚点。 */
function referencePath(): string {
  return join(WORKSPACE, 'reference.json');
}

function runCheck(
  directory: string,
  expectPath?: string,
  env: NodeJS.ProcessEnv = envWithoutCiSha,
) {
  const args = ['scripts/release.mjs', 'check', directory];
  if (expectPath) args.push('--expect', expectPath);
  const result = spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8', env });
  return { status: result.status, stderr: result.stderr };
}

afterEach(() => {
  rmSync(WORKSPACE, { recursive: true, force: true });
});

describe('release.mjs check', () => {
  it('结构完整的制品通过自洽校验', () => {
    const result = runCheck(createArtifact());
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('文件内容被篡改时拒绝', () => {
    const directory = createArtifact();
    writeFileSync(join(REPO_ROOT, directory, 'README.md'), '# tampered\n');
    const result = runCheck(directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SHA-256');
  });

  it('新增未登记文件时拒绝', () => {
    const directory = createArtifact();
    writeFileSync(join(REPO_ROOT, directory, 'extra.txt'), 'x\n');
    expect(runCheck(directory).status).toBe(1);
  });

  it('缺少必需文件时拒绝', () => {
    const directory = createArtifact();
    rmSync(join(REPO_ROOT, directory, 'web', 'dist', 'index.html'));
    const result = runCheck(directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Required release file is missing');
  });

  it('目录名与 manifest 的 commit 不符时拒绝', () => {
    const directory = createArtifact(`release-${'b'.repeat(40)}`);
    const result = runCheck(directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Artifact directory name does not match manifest');
  });

  it('仅凭自洽校验无法发现"篡改后重算清单"的伪造', () => {
    const directory = createArtifact();
    const absolute = join(REPO_ROOT, directory);
    writeFileSync(join(absolute, 'README.md'), '# backdoored\n');
    writeManifest(absolute, COMMIT, false);
    expect(runCheck(directory).status).toBe(0);
  });

  it('--expect 与可信清单比对, 可发现"篡改后重算清单"的伪造', () => {
    const directory = createArtifact();
    const absolute = join(REPO_ROOT, directory);
    // 可信清单取自未篡改的制品, 之后按篡改后的内容重算制品自身的清单。
    copyFileSync(join(absolute, 'manifest.json'), referencePath());
    writeFileSync(join(absolute, 'README.md'), '# backdoored\n');
    writeManifest(absolute, COMMIT, false);

    const result = runCheck(directory, referencePath());
    expect(result.stderr).toContain('does not match the reference manifest');
    expect(result.status).toBe(1);
  });

  it('--expect 与同一内容重建的清单一致时通过(可复现)', () => {
    const directory = createArtifact();
    copyFileSync(join(REPO_ROOT, directory, 'manifest.json'), referencePath());
    createArtifact(); // 同一路径按相同内容重建

    const result = runCheck(directory, referencePath());
    expect(result.status, result.stderr).toBe(0);
  });

  it('--expect 指向制品自身时拒绝(否则是与自身清单比对, 同义反复)', () => {
    const directory = createArtifact();
    const result = runCheck(directory, `${directory}/manifest.json`);
    expect(result.stderr).toContain('must come from outside the artifact');
    expect(result.status).toBe(1);
  });

  it.each(['.env', 'node_modules/left-pad/index.js', 'temp/uploads/sample.mp3'])(
    '制品含 %s 时拒绝(检查单的必过项不能只靠人工)',
    (path) => {
      const directory = createArtifact();
      const target = join(REPO_ROOT, directory, ...path.split('/'));
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, 'secret\n');
      writeManifest(join(REPO_ROOT, directory), COMMIT, false);

      const result = runCheck(directory);
      expect(result.stderr).toContain('must not contain credentials');
      expect(result.status).toBe(1);
    },
  );

  it('参考清单不存在时拒绝', () => {
    const directory = createArtifact();
    const result = runCheck(directory, '.release/__test__/missing.json');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Reference manifest not found');
  });

  it('CI 环境要求制品 commit 与 GITHUB_SHA 一致', () => {
    const directory = createArtifact();
    const ciEnv = { ...envWithoutCiSha, GITHUB_SHA: COMMIT };
    expect(runCheck(directory, undefined, ciEnv).status).toBe(0);

    const mismatched = { ...envWithoutCiSha, GITHUB_SHA: 'e'.repeat(40) };
    const result = runCheck(directory, undefined, mismatched);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CI SHA does not match manifest');
  });
});
