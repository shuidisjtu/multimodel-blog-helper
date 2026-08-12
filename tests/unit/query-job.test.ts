import { describe, expect, it } from 'vitest';
import { QueryJob } from '../../src/application/query-job.js';
import { DomainError } from '../../src/domain/errors.js';
import type { BlogJob } from '../../src/domain/job.js';
import type { JobRepository } from '../../src/domain/ports.js';
import type { Clock } from '../../src/shared/clock.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

const FIXED_NOW = '2026-08-12T00:00:00.000Z';
const clock: Clock = { now: () => FIXED_NOW };

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

/** 内存 fake 仓储: get 结果来自 Map; 可编程注入 get 错误。 */
class InMemoryJobRepo implements JobRepository {
  readonly jobs = new Map<string, BlogJob>();
  getError: unknown;

  async create(): Promise<BlogJob> {
    throw new Error('not used in QueryJob tests');
  }

  async createOrGetByIdempotencyKey(): Promise<never> {
    throw new Error('not used in QueryJob tests');
  }

  async get(id: string): Promise<BlogJob | null> {
    if (this.getError !== undefined) throw this.getError;
    return this.jobs.get(id) ?? null;
  }

  async update(): Promise<BlogJob> {
    throw new Error('not used in QueryJob tests');
  }

  async listRecoverable(): Promise<BlogJob[]> {
    return [];
  }

  async listInProgress(): Promise<BlogJob[]> {
    return [];
  }

  async listExpired(): Promise<BlogJob[]> {
    return [];
  }

  async remove(): Promise<void> {
    throw new Error('not used in QueryJob tests');
  }
}

function makeJob(overrides: Partial<BlogJob> = {}): BlogJob {
  return {
    id: 'job-1',
    requestId: 'req-1',
    status: 'queued',
    input: {
      path: '/tmp/uploads/job-1/input.bin',
      originalName: 'demo.mp3',
      mimeType: 'audio/mpeg',
      bytes: 1024,
      sha256: 'abc123',
    },
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    expiresAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

function setup() {
  const repo = new InMemoryJobRepo();
  const logger = new FakeLogger();
  const useCase = new QueryJob({ jobs: repo, clock, logger });
  return { repo, logger, useCase };
}

describe('QueryJob(架构文档 §5)', () => {
  it('返回 queued/transcribing/succeeded/failed 任务', async () => {
    const { repo, useCase } = setup();
    const jobs: BlogJob[] = [
      makeJob({ id: 'q1', status: 'queued' }),
      makeJob({ id: 't1', status: 'transcribing' }),
      makeJob({
        id: 's1',
        status: 'succeeded',
        result: { transcriptPath: '/tmp/outputs/s1/transcript.txt', summary: 's', model: 'm' },
      }),
      makeJob({ id: 'f1', status: 'failed', failure: { code: 'WEATHER_UNAVAILABLE', safeMessage: 'up' } }),
    ];
    for (const job of jobs) repo.jobs.set(job.id, job);

    for (const job of jobs) {
      await expect(useCase.run(job.id)).resolves.toEqual(job);
    }
  });

  it('不存在 → JOB_NOT_FOUND', async () => {
    const { useCase } = setup();

    let thrown: unknown;
    try {
      await useCase.run('nope');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('JOB_NOT_FOUND');
    expect((thrown as DomainError).message).toBe('Job not found');
  });

  it('expired(tombstone) → JOB_EXPIRED', async () => {
    const { repo, useCase } = setup();
    repo.jobs.set('e1', makeJob({ id: 'e1', status: 'expired' }));

    let thrown: unknown;
    try {
      await useCase.run('e1');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('JOB_EXPIRED');
    expect((thrown as DomainError).message).toBe('Job has expired');
  });

  it('failed 任务的 failure 字段可读(失败可查询)', async () => {
    const { repo, useCase } = setup();
    repo.jobs.set(
      'f1',
      makeJob({ id: 'f1', status: 'failed', failure: { code: 'INTERNAL_ERROR', safeMessage: 'Processing failed' } }),
    );

    const job = await useCase.run('f1');

    expect(job.status).toBe('failed');
    expect(job.failure).toEqual({ code: 'INTERNAL_ERROR', safeMessage: 'Processing failed' });
  });

  it('get 抛未知错误: 转换为 INTERNAL_ERROR 传播, 原始错误仅记录日志', async () => {
    const { repo, logger, useCase } = setup();
    repo.getError = new Error('disk on fire');

    let thrown: unknown;
    try {
      await useCase.run('x');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('INTERNAL_ERROR');
    expect((thrown as DomainError).message).toBe('Internal error');
    expect(
      logger.calls.some(
        (c) => c.event === 'job.query.failed' && c.errorCode === 'INTERNAL_ERROR' && c.error !== undefined,
      ),
    ).toBe(true);
  });
});
