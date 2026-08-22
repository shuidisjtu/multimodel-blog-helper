/**
 * LocalFileStore 集成测试(架构文档 §9):真实临时目录(mkdtemp)验证落盘/读取/删除。
 * 测试结束统一清理临时目录(afterAll)。
 */

import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalFileStore } from '../../src/infrastructure/storage/file-store.js';

let tempDir: string;
let store: LocalFileStore;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'blog-helper-store-'));
  store = new LocalFileStore(tempDir);
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('LocalFileStore(架构文档 §4.2/§7.1)', () => {
  it('saveInput: 文件落盘、内容一致、返回绝对路径与手工计算一致的 64 位 hex sha256', async () => {
    const bytes = Buffer.from('fake mp3 content');
    const { path, sha256 } = await store.saveInput({
      jobId: 'j1',
      originalName: 'demo.mp3',
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      bytes,
    });
    expect(path).toBe(join(tempDir, 'uploads', 'j1', 'input.mp3'));
    expect(isAbsolute(path)).toBe(true);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    await expect(readFile(path)).resolves.toEqual(bytes);
  });

  it('saveInput 扩展名: 由 extension 参数决定, 用户文件名不参与路径', async () => {
    const { path } = await store.saveInput({
      jobId: 'ext-1',
      originalName: '../evil.MP3',
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      bytes: Buffer.from('x'),
    });
    expect(path).toBe(join(tempDir, 'uploads', 'ext-1', 'input.mp3'));
    expect(path.split(/[\\/]/)).not.toContain('../evil.MP3');
  });

  it('saveInput 非法 extension(大写/含点/空): 拒绝', async () => {
    for (const extension of ['MP3', 'a.mp3', '']) {
      await expect(
        store.saveInput({
          jobId: 'bad-ext',
          originalName: 'x.mp3',
          mimeType: 'audio/mpeg',
          extension,
          bytes: Buffer.from('x'),
        }),
      ).rejects.toThrow();
    }
  });

  it('saveOutput: 按 kind 写 transcript.txt / summary.txt 到 outputs/<jobId>/', async () => {
    const t = await store.saveOutput({
      jobId: 'j2',
      kind: 'transcript',
      content: 'hello transcript',
    });
    const s = await store.saveOutput({ jobId: 'j2', kind: 'summary', content: 'hello summary' });
    expect(t.path).toBe(join(tempDir, 'outputs', 'j2', 'transcript.txt'));
    expect(s.path).toBe(join(tempDir, 'outputs', 'j2', 'summary.txt'));
    expect(isAbsolute(t.path)).toBe(true);
    await expect(readFile(t.path, 'utf8')).resolves.toBe('hello transcript');
    await expect(readFile(s.path, 'utf8')).resolves.toBe('hello summary');
  });

  it('read: 读回 saveInput 的内容', async () => {
    const bytes = Buffer.from('roundtrip bytes');
    const { path } = await store.saveInput({
      jobId: 'j3',
      originalName: 'x.wav',
      mimeType: 'audio/wav',
      extension: 'wav',
      bytes,
    });
    await expect(store.read(path)).resolves.toEqual(bytes);
  });

  it('deleteJobFiles: 删除 uploads/outputs 两个目录并返回文件总数,再次调用幂等返回 0', async () => {
    await store.saveInput({
      jobId: 'j4',
      originalName: 'a.mp3',
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      bytes: Buffer.from('1'),
    });
    await store.saveInput({
      jobId: 'j4',
      originalName: 'b.wav',
      mimeType: 'audio/wav',
      extension: 'wav',
      bytes: Buffer.from('2'),
    });
    await store.saveOutput({ jobId: 'j4', kind: 'transcript', content: 't' });
    await store.saveOutput({ jobId: 'j4', kind: 'summary', content: 's' });
    const count = await store.deleteJobFiles('j4');
    expect(count).toBe(4);
    await expect(readFile(join(tempDir, 'uploads', 'j4', 'input.mp3'))).rejects.toThrow();
    await expect(readFile(join(tempDir, 'outputs', 'j4', 'transcript.txt'))).rejects.toThrow();
    // 目录本身也被删除
    await expect(readdir(join(tempDir, 'uploads'))).resolves.not.toContain('j4');
    await expect(readdir(join(tempDir, 'outputs'))).resolves.not.toContain('j4');
    // 幂等: 再次删除返回 0,不抛错
    await expect(store.deleteJobFiles('j4')).resolves.toBe(0);
  });
});
