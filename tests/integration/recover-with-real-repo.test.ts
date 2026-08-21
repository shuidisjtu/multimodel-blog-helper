/**
 * RecoverJobs 集成测试(架构文档 §4.2/§9): 真实 FileJobRepository + MemoryJobQueue。
 * 验证启动恢复与真实仓储文件布局协同: queued 任务重入队, transcribing 标记 failed(PROCESS_INTERRUPTED)。
 */

import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecoverJobs } from '../../src/application/recover-jobs.js';
import { MemoryJobQueue } from '../../src/infrastructure/queue/memory-job-queue.js';
import { FileJobRepository } from '../../src/infrastructure/repository/file-job-repository.js';
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

const INPUT_SHA = createHash('sha256').update('audio bytes').digest('hex');

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'blog-helper-recover-'));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('RecoverJobs 集成(架构文档 §4.2/§9)', () => {
  it('真实仓储: queued 重入队, transcribing 标记 failed(PROCESS_INTERRUPTED)', async () => {
    const clockValue = '2026-08-12T08:00:00.000Z';
    const clock: Clock = { now: () => clockValue };
    const repo = new FileJobRepository(tempDir, clock, systemIdGenerator);
    const input = {
      path: '/tmp/in/rec-q.mp3',
      originalName: 'demo.mp3',
      mimeType: 'audio/mpeg',
      bytes: 11,
      sha256: INPUT_SHA,
    };
    await repo.create({
      requestId: 'req-q',
      input,
      expiresAt: '2026-08-13T08:00:00.000Z',
      id: 'rec-q',
    });
    await repo.create({
      requestId: 'req-t',
      input,
      expiresAt: '2026-08-13T08:00:00.000Z',
      id: 'rec-t',
    });
    await repo.update('rec-t', (j) => ({ ...j, status: 'transcribing' }));
    const queue = new MemoryJobQueue(10, 1);
    const logger = new FakeLogger();
    const useCase = new RecoverJobs({ jobs: repo, queue, clock, logger });

    const result = await useCase.run();

    expect(result).toEqual({ requeued: 1, interrupted: 1 });
    expect(queue.size()).toBe(1); // 无订阅者, queued 任务滞留队列
    expect(logger.calls.some((c) => c.event === 'job.requeued' && c.jobId === 'rec-q')).toBe(true);
    const interrupted = await repo.get('rec-t');
    expect(interrupted?.status).toBe('failed');
    expect(interrupted?.failure).toEqual({
      code: 'PROCESS_INTERRUPTED',
      safeMessage: 'Processing interrupted by restart',
    });
  });
});
