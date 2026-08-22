/**
 * LocalFileStore:基于临时目录的文件存储(架构文档 §4.2/§7.1)。
 * 布局: <tempDir>/uploads/<jobId>/input.<ext> 与 <tempDir>/outputs/<jobId>/transcript.txt|summary.txt。
 * 扩展名安全断言防止路径注入(架构文档 §5); 所有 mkdir 幂等(recursive: true)。
 */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FileStore, SaveInputParams, SaveOutputParams } from '../../domain/ports.js';

export class LocalFileStore implements FileStore {
  private readonly uploadsDir: string;
  private readonly outputsDir: string;

  constructor(tempDir: string) {
    // resolve 保证对外返回绝对路径(相对目录在测试/生产下行为一致)
    const root = resolve(tempDir);
    this.uploadsDir = join(root, 'uploads');
    this.outputsDir = join(root, 'outputs');
    mkdirSync(this.uploadsDir, { recursive: true });
    mkdirSync(this.outputsDir, { recursive: true });
  }

  async saveInput(params: SaveInputParams): Promise<{ path: string; sha256: string }> {
    const ext = assertSafeExtension(params.extension);
    const dir = join(this.uploadsDir, params.jobId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `input.${ext}`);
    await writeFile(filePath, params.bytes);
    const sha256 = createHash('sha256').update(params.bytes).digest('hex');
    return { path: filePath, sha256 };
  }

  async saveOutput(params: SaveOutputParams): Promise<{ path: string }> {
    const dir = join(this.outputsDir, params.jobId);
    await mkdir(dir, { recursive: true });
    const fileName = params.kind === 'transcript' ? 'transcript.txt' : 'summary.txt';
    const filePath = join(dir, fileName);
    await writeFile(filePath, params.content, 'utf8');
    return { path: filePath };
  }

  async read(path: string): Promise<Buffer> {
    return readFile(path);
  }

  async deleteJobFiles(jobId: string): Promise<number> {
    const dirs = [join(this.uploadsDir, jobId), join(this.outputsDir, jobId)];
    let count = 0;
    for (const dir of dirs) {
      // 先递归统计文件数, 再整目录删除(§4.2: 清理幂等并记录数量)
      try {
        const entries = await readdir(dir, { recursive: true, withFileTypes: true });
        count += entries.filter((e) => e.isFile()).length;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      await rm(dir, { recursive: true, force: true });
    }
    return count;
  }
}

/**
 * 扩展名安全断言(小写字母/数字, 1-8 字符): 正常值由 domain 校验器保证,
 * 此处为契约失效的预防性防御(架构文档 §5: 拒绝路径分隔符/注入进路径)。
 */
function assertSafeExtension(extension: string): string {
  if (!/^[a-z0-9]{1,8}$/.test(extension)) {
    throw new Error(`Invalid upload extension: ${extension}`);
  }
  return extension;
}
