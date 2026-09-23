#!/usr/bin/env node
/** Build and verify the C4 release candidate. No credentials or node_modules are packaged. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = join(root, '.release');
const requiredFiles = [
  '.env.example',
  'README.md',
  'package.json',
  'package-lock.json',
  'server/bootstrap/server.js',
  'web/dist/index.html',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function removeGenerated(path) {
  const absolute = resolve(path);
  assert(
    absolute.startsWith(`${root}${sep}`),
    `Refusing to remove outside repository: ${absolute}`,
  );
  rmSync(absolute, { recursive: true, force: true });
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function runNode(script, args, cwd) {
  assert(existsSync(script), `Missing dependency: ${script}. Run npm ci in both projects.`);
  const result = spawnSync(process.execPath, [script, ...args], { cwd, stdio: 'inherit' });
  assert(result.status === 0, `${script} failed with exit code ${result.status}`);
}

function copyTree(source, destination) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(to, { recursive: true });
      copyTree(from, to);
    } else {
      assert(entry.isFile(), `Release input must be a regular file: ${from}`);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }
}

function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFiles(join(directory, entry.name), path));
    } else {
      assert(entry.isFile(), `Release contains a non-file entry: ${path}`);
      if (path !== 'manifest.json') files.push(path);
    }
  }
  return files.sort();
}

function fileRecord(directory, path) {
  const bytes = readFileSync(join(directory, ...path.split('/')));
  return {
    path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function check(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  assert(manifest.schemaVersion === 1, 'Unsupported release manifest version');
  assert(/^[0-9a-f]{40}$/.test(manifest.commit), 'Invalid commit SHA in manifest');
  assert(typeof manifest.dirty === 'boolean', 'Missing dirty flag in manifest');
  assert(
    basename(directory) === `${manifest.dirty ? 'release-preview' : 'release'}-${manifest.commit}`,
    'Artifact directory name does not match manifest',
  );
  if (process.env.GITHUB_SHA) {
    assert(!manifest.dirty, 'CI must not upload a dirty preview');
    assert(manifest.commit === process.env.GITHUB_SHA, 'CI SHA does not match manifest');
  }
  const actualPaths = listFiles(directory);
  assert(
    requiredFiles.every((file) => actualPaths.includes(file)),
    'Required release file is missing',
  );
  assert(Array.isArray(manifest.files), 'Missing file list in manifest');
  assert(
    JSON.stringify(manifest.files) ===
      JSON.stringify(actualPaths.map((path) => fileRecord(directory, path))),
    'Release file list or SHA-256 checksums do not match',
  );
  console.log(
    `Release verified: ${directory} (${actualPaths.length} files, commit ${manifest.commit}${manifest.dirty ? ', dirty preview' : ''})`,
  );
}

function build(allowDirty) {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  assert(nodeMajor >= 24, `Node >= 24 is required (current ${process.version})`);
  const commit = git('rev-parse', 'HEAD');
  assert(/^[0-9a-f]{40}$/.test(commit), 'Could not read full commit SHA');
  const dirty = git('status', '--porcelain=v1', '--untracked-files=all') !== '';
  assert(!dirty || allowDirty, 'Working tree is dirty; use --allow-dirty for a local preview');

  const serverOutput = join(root, 'dist', 'server');
  const webOutput = join(root, 'web', 'dist');
  removeGenerated(serverOutput);
  removeGenerated(webOutput);
  runNode(
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    ['-p', 'tsconfig.build.json'],
    root,
  );
  runNode(
    join(root, 'web', 'node_modules', 'typescript', 'bin', 'tsc'),
    ['--noEmit'],
    join(root, 'web'),
  );
  runNode(
    join(root, 'web', 'node_modules', 'vite', 'bin', 'vite.js'),
    ['build'],
    join(root, 'web'),
  );

  const directory = join(releaseRoot, `${dirty ? 'release-preview' : 'release'}-${commit}`);
  removeGenerated(directory);
  mkdirSync(directory, { recursive: true });
  for (const name of ['.env.example', 'package.json', 'package-lock.json']) {
    copyFileSync(join(root, name), join(directory, name));
  }
  copyFileSync(join(root, 'docs', 'release-runtime.md'), join(directory, 'README.md'));
  copyTree(serverOutput, join(directory, 'server'));
  copyTree(webOutput, join(directory, 'web', 'dist'));
  const manifest = {
    schemaVersion: 1,
    commit,
    dirty,
    files: listFiles(directory).map((path) => fileRecord(directory, path)),
  };
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  check(directory);
}

const [command, option] = process.argv.slice(2);
try {
  if (command === 'build' && (option === undefined || option === '--allow-dirty')) {
    build(option === '--allow-dirty');
  } else if (command === 'check' && option) {
    const directory = resolve(root, option);
    assert(directory.startsWith(`${releaseRoot}${sep}`), 'Release path must be inside .release');
    assert(lstatSync(directory).isDirectory(), 'Release path must be a directory');
    check(directory);
  } else {
    throw new Error(
      'Usage: node scripts/release.mjs build [--allow-dirty] | check .release/release-<sha>',
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
