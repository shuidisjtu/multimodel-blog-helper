/**
 * CleanupExpired 集成测试(架构文档 §9): 真实 FileJobRepository + LocalFileStore + mkdtemp。
 * 覆盖: 终态(succeeded/failed)过期 → 文件删除 + tombstone 最小化 / 非终态过期跳过(文件保留) /
 * tombstone 二次清理(保留期内保留, 超期元数据与幂等占位一并删除) / 连续两次 run 幂等。
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CleanupExpired } from '../../src/application/cleanup-expired.js';
import type { BlogJob } from '../../src/domain/job.js';
import { FileJobRepository } from '../../src/infrastructure/repository/file-job-repository.js';
import { LocalFileStore } from '../../src/infrastructure/storage/file-store.js';
import type { Clock } from '../../src/shared/clock.js';
import { systemIdGenerator } from '../../src/shared/ids.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

/** 记录型 fake 日志: 每个调用打上 level 便于断言。 */
class FakeLogger implements Logger {
  readonly calls: LogFields[] = [];
  debug(f: LogFields): void {
    this.calls.push({ ...f, level: 'debug' });
  }
  info(f: LogFields): void {
    this.calls.push({ ...f, level: 'info' });
  }
  warn(f: LogFields): void {
    this.calls.push({ ...f, level: 'warn' });
  }
  error(f: LogFields): void {
    this.calls.push({ ...f, level: 'error' });
  }
}

/** 早于测试内所有时钟值, 保证任务必然过期。 */
const PAST = '2026-01-01T00:00:00.000Z';
const INPUT_SHA = createHash('sha256').update('audio bytes').digest('hex');

let tempDir: string;
let clockValue: string;
let repo: FileJobRepository;
let files: LocalFileStore;
let logger: FakeLogger;
let cleanup: CleanupExpired;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'blog-helper-cleanup-'));
  clockValue = '2026-08-12T08:00:00.000Z';
  const clock: Clock = { now: () => clockValue };
  repo = new FileJobRepository(tempDir, clock, systemIdGenerator);
  files = new LocalFileStore(tempDir);
  logger = new FakeLogger();
  cleanup = new CleanupExpired({ jobs: repo, files, clock, logger, tombstoneRetentionDays: 30 });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** 创建指定状态的任务并落盘对应文件(uploads/ + 终态任务的 outputs/)。 */
async function createJobWithFiles(opts: {
  id: string;
  status?: 'queued' | 'transcribing' | 'succeeded' | 'failed';
  idempotencyKey?: string;
}): Promise<BlogJob> {
  const { id } = opts;
  const { job } = await repo.createOrGetByIdempotencyKey({
    requestId: `req-${id}`,
    input: {
      path: `/tmp/in/${id}.mp3`,
      originalName: 'demo.mp3',
      mimeType: 'audio/mpeg',
      bytes: 11,
      sha256: INPUT_SHA,
    },
    expiresAt: PAST,
    id,
    idempotencyKey: opts.idempotencyKey,
  });
  await files.saveInput({
    jobId: id,
    originalName: 'demo.mp3',
    mimeType: 'audio/mpeg',
    bytes: Buffer.from('audio bytes'),
  });
  if (opts.status === 'transcribing') {
    await repo.update(id, (j) => ({ ...j, status: 'transcribing' }));
  }
  if (opts.status === 'succeeded') {
    await files.saveOutput({ jobId: id, kind: 'transcript', content: 'transcript text' });
    await files.saveOutput({ jobId: id, kind: 'summary', content: 'summary text' });
    await repo.update(id, (j) => ({
      ...j,
      status: 'succeeded',
      result: {
        transcriptPath: `/tmp/o/${id}/transcript.txt`,
        summary: 'summary text',
        model: 'whisper-1',
      },
    }));
  }
  if (opts.status === 'failed') {
    await repo.update(id, (j) => ({
      ...j,
      status: 'failed',
      failure: { code: 'INTERNAL_ERROR', safeMessage: 'Processing failed' },
    }));
  }
  return job;
}

function sha256Of(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

describe('CleanupExpired 集成(架构文档 §4.2/§5/§9)', () => {
  it('终态(succeeded)过期: 输入/输出文件删除, tombstone 最小化(无 input/result/failure/idempotencyKey)', async () => {
    await createJobWithFiles({ id: 'done-1', status: 'succeeded' });
    expect(existsSync(join(tempDir, 'uploads', 'done-1'))).toBe(true);
    expect(existsSync(join(tempDir, 'outputs', 'done-1'))).toBe(true);

    const result = await cleanup.run();

    expect(result).toEqual({ expiredCount: 1, removedTombstones: 0 });
    expect(existsSync(join(tempDir, 'uploads', 'done-1'))).toBe(false);
    expect(existsSync(join(tempDir, 'outputs', 'done-1'))).toBe(false);
    const tombstone = await repo.get('done-1');
    expect(tombstone).not.toBeNull();
    // tombstone 最小化(§4.2): 只保留核心字段
    expect(tombstone?.status).toBe('expired');
    expect(tombstone?.id).toBe('done-1');
    expect(tombstone?.requestId).toBe('req-done-1');
    expect(tombstone?.createdAt).toBe('2026-08-12T08:00:00.000Z');
    expect(tombstone?.expiresAt).toBe(PAST);
    expect(tombstone?.input).toBeUndefined();
    expect(tombstone?.result).toBeUndefined();
    expect(tombstone?.failure).toBeUndefined();
    expect(tombstone?.idempotencyKey).toBeUndefined();
    expect(logger.calls.some((c) => c.event === 'cleanup.done' && c.level === 'info')).toBe(true);
  });

  it('终态(failed)过期: 同样删除文件并转 tombstone, failure 清空', async () => {
    await createJobWithFiles({ id: 'fail-1', status: 'failed' });
    expect(existsSync(join(tempDir, 'uploads', 'fail-1'))).toBe(true);

    const result = await cleanup.run();

    expect(result).toEqual({ expiredCount: 1, removedTombstones: 0 });
    expect(existsSync(join(tempDir, 'uploads', 'fail-1'))).toBe(false);
    const tombstone = await repo.get('fail-1');
    expect(tombstone?.status).toBe('expired');
    expect(tombstone?.failure).toBeUndefined();
  });

  it('queued/transcribing 过期: 跳过(不删文件不迁移), 记录 debug', async () => {
    await createJobWithFiles({ id: 'q-1', status: 'queued' });
    await createJobWithFiles({ id: 't-1', status: 'transcribing' });

    const result = await cleanup.run();

    expect(result).toEqual({ expiredCount: 0, removedTombstones: 0 });
    expect((await repo.get('q-1'))?.status).toBe('queued');
    expect((await repo.get('t-1'))?.status).toBe('transcribing');
    expect(existsSync(join(tempDir, 'uploads', 'q-1'))).toBe(true);
    expect(existsSync(join(tempDir, 'uploads', 't-1'))).toBe(true);
    expect(logger.calls.some((c) => c.event === 'cleanup.skip' && c.level === 'debug')).toBe(true);
  });

  it('tombstone 超过保留期 → remove(元数据与幂等占位消失); 未超过 → 保留', async () => {
    await createJobWithFiles({ id: 'old-1', status: 'succeeded', idempotencyKey: 'cleanup-key-1' });
    const keyPath = join(tempDir, 'jobs', 'by-key', `${sha256Of('cleanup-key-1')}.json`);
    await cleanup.run(); // → tombstone(updatedAt = 2026-08-12T08:00:00.000Z)
    expect((await repo.get('old-1'))?.status).toBe('expired');
    expect(existsSync(keyPath)).toBe(true); // 二次清理前幂等占位保留(§5)

    // 未超过保留期(30 天) → 保留
    clockValue = '2026-08-17T08:00:00.000Z';
    let result = await cleanup.run();
    expect(result).toEqual({ expiredCount: 0, removedTombstones: 0 });
    expect((await repo.get('old-1'))?.status).toBe('expired');

    // 混入损坏占位: 清理扫描需容忍, 不中断
    await writeFile(join(tempDir, 'jobs', 'by-key', 'deadbeef.json'), '{broken', 'utf8');

    // 超过保留期 → 元数据与占位一并删除(§5: key 随 tombstone 清理)
    clockValue = '2026-09-13T08:00:00.000Z';
    result = await cleanup.run();
    expect(result).toEqual({ expiredCount: 0, removedTombstones: 1 });
    expect(await repo.get('old-1')).toBeNull();
    expect(existsSync(keyPath)).toBe(false);
  });

  it('清理幂等: 连续两次 run 第二次只处理二次清理, 不报错', async () => {
    await createJobWithFiles({ id: 'idem-1', status: 'succeeded' });

    const first = await cleanup.run();
    expect(first).toEqual({ expiredCount: 1, removedTombstones: 0 });

    const second = await cleanup.run();
    expect(second).toEqual({ expiredCount: 0, removedTombstones: 0 });
    expect((await repo.get('idem-1'))?.status).toBe('expired');
  });
});
