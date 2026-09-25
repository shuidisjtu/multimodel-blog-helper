import { describe, expect, it } from 'vitest';
import { GetTranscript } from '../../src/application/get-transcript.js';
import { DomainError } from '../../src/domain/errors.js';
import type { BlogJob } from '../../src/domain/job.js';
import type { FileStore, JobRepository } from '../../src/domain/ports.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

const FIXED_NOW = '2026-08-24T08:00:00.000Z';

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

class InMemoryJobRepo implements JobRepository {
  readonly jobs = new Map<string, BlogJob>();
  getError: unknown;
  async get(id: string): Promise<BlogJob | null> {
    if (this.getError !== undefined) throw this.getError;
    return this.jobs.get(id) ?? null;
  }
  async create(): Promise<BlogJob> {
    throw new Error('not used in GetTranscript tests');
  }
  async createOrGetByIdempotencyKey(): Promise<never> {
    throw new Error('not used');
  }
  async update(): Promise<BlogJob> {
    throw new Error('not used');
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
    throw new Error('not used');
  }
}

class StubFiles implements FileStore {
  readError: unknown;
  readonly readPaths: string[] = [];
  async read(path: string): Promise<Buffer> {
    this.readPaths.push(path);
    if (this.readError !== undefined) throw this.readError;
    return Buffer.from('transcript text', 'utf8');
  }
  async saveInput(): Promise<{ path: string; sha256: string }> {
    throw new Error('not used');
  }
  async saveOutput(): Promise<{ path: string }> {
    throw new Error('not used');
  }
  async deleteJobFiles(): Promise<number> {
    throw new Error('not used');
  }
}

function makeJob(overrides: Partial<BlogJob> = {}): BlogJob {
  return {
    id: 'job-1',
    requestId: 'req-1',
    status: 'queued',
    input: {
      path: '/tmp/uploads/job-1/input.mp3',
      originalName: 'demo.mp3',
      mimeType: 'audio/mpeg',
      bytes: 1024,
      sha256: 'abc',
    },
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    expiresAt: '2026-08-25T08:00:00.000Z',
    ...overrides,
  };
}

function setup() {
  const repo = new InMemoryJobRepo();
  const files = new StubFiles();
  const logger = new FakeLogger();
  const useCase = new GetTranscript({ jobs: repo, files, logger });
  return { repo, files, logger, useCase };
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  const thrown = await p.catch((e: unknown) => e);
  expect(thrown).toBeInstanceOf(DomainError);
  expect((thrown as DomainError).code).toBe(code);
}

describe('GetTranscript(openapi downloadTranscript)', () => {
  it('succeeded 任务 → 返回 UTF-8 转录文本', async () => {
    const { repo, useCase } = setup();
    repo.jobs.set(
      's1',
      makeJob({
        id: 's1',
        status: 'succeeded',
        result: { transcriptPath: '/tmp/outputs/s1/transcript.txt', summary: 's', model: 'm' },
      }),
    );
    await expect(useCase.run('s1')).resolves.toBe('transcript text');
  });

  it('不存在 → JOB_NOT_FOUND', async () => {
    const { useCase } = setup();
    await expectCode(useCase.run('nope'), 'JOB_NOT_FOUND');
  });

  it('expired(tombstone) → JOB_EXPIRED(410 语义)', async () => {
    const { repo, useCase } = setup();
    repo.jobs.set('e1', makeJob({ id: 'e1', status: 'expired' }));
    await expectCode(useCase.run('e1'), 'JOB_EXPIRED');
  });

  it('queued/transcribing/summarizing/failed → JOB_NOT_READY(409)', async () => {
    const { repo, useCase } = setup();
    const statuses = ['queued', 'transcribing', 'summarizing', 'failed'] as const;
    for (const status of statuses) {
      repo.jobs.set(`j-${status}`, makeJob({ id: `j-${status}`, status }));
      await expectCode(useCase.run(`j-${status}`), 'JOB_NOT_READY');
    }
    repo.jobs.set(
      'f1',
      makeJob({
        id: 'f1',
        status: 'failed',
        failure: { code: 'INTERNAL_ERROR', safeMessage: 'Processing failed' },
      }),
    );
    await expectCode(useCase.run('f1'), 'JOB_NOT_READY');
  });

  it('succeeded 但 result 缺失(领域不变量防御)→ JOB_NOT_READY', async () => {
    const { repo, useCase } = setup();
    repo.jobs.set('s1', makeJob({ id: 's1', status: 'succeeded' }));
    await expectCode(useCase.run('s1'), 'JOB_NOT_READY');
  });

  it('产物文件缺失(ENOENT)→ JOB_NOT_READY, 日志只记 ioError 不含路径', async () => {
    const { repo, files, logger, useCase } = setup();
    repo.jobs.set(
      's1',
      makeJob({
        id: 's1',
        status: 'succeeded',
        result: { transcriptPath: '/tmp/out/s1/transcript.txt', summary: 's', model: 'm' },
      }),
    );
    const err = new Error('ENOENT: no such file or directory, open');
    (err as NodeJS.ErrnoException).code = 'ENOENT';
    files.readError = err;

    await expectCode(useCase.run('s1'), 'JOB_NOT_READY');
    const warn = logger.calls.find((c) => c.event === 'job.transcript.missing');
    expect(warn).toBeDefined();
    expect(warn?.ioError).toBe('ENOENT');
    // 日志不得出现错误对象的 message(含路径)
    expect(JSON.stringify(logger.calls)).not.toContain('no such file');
  });

  it('其他读错误(EACCES)→ INTERNAL_ERROR 且日志只记 ioError', async () => {
    const { repo, files, logger, useCase } = setup();
    repo.jobs.set(
      's1',
      makeJob({
        id: 's1',
        status: 'succeeded',
        result: { transcriptPath: '/tmp/out/s1/transcript.txt', summary: 's', model: 'm' },
      }),
    );
    const err = new Error('EACCES: permission denied, open');
    (err as NodeJS.ErrnoException).code = 'EACCES';
    files.readError = err;

    await expectCode(useCase.run('s1'), 'INTERNAL_ERROR');
    const errorLog = logger.calls.find((c) => c.event === 'job.transcript.failed');
    expect(errorLog?.ioError).toBe('EACCES');
  });

  it('get 抛未知错误 → 转换为 INTERNAL_ERROR 传播(不泄漏原始报错)', async () => {
    const { repo, useCase } = setup();
    repo.getError = new Error('disk on fire');
    await expectCode(useCase.run('x'), 'INTERNAL_ERROR');
  });
});

describe('GetTranscript.runTimed(openapi downloadTimestampedTranscript)', () => {
  const timedResult = {
    transcriptPath: '/tmp/outputs/t1/transcript.txt',
    timedTranscriptPath: '/tmp/outputs/t1/transcript.timed.txt',
    summary: 's',
    model: 'm',
  };

  it('succeeded 且有时间戳产物 → 返回该产物内容(读的是 timed 路径)', async () => {
    const { repo, files, useCase } = setup();
    repo.jobs.set('t1', makeJob({ id: 't1', status: 'succeeded', result: timedResult }));

    await expect(useCase.runTimed('t1')).resolves.toBe('transcript text');
    expect(files.readPaths).toEqual(['/tmp/outputs/t1/transcript.timed.txt']);
  });

  it('succeeded 但没有时间戳产物(上游无词级数据)→ JOB_NOT_READY', async () => {
    const { repo, files, useCase } = setup();
    repo.jobs.set(
      't1',
      makeJob({
        id: 't1',
        status: 'succeeded',
        result: { transcriptPath: '/tmp/outputs/t1/transcript.txt', summary: 's', model: 'm' },
      }),
    );

    await expectCode(useCase.runTimed('t1'), 'JOB_NOT_READY');
    expect(files.readPaths).toEqual([]); // 不存在的产物不该去读
  });

  it('不存在 / expired / 未成功 → 与纯文本下载同语义', async () => {
    const { repo, useCase } = setup();
    await expectCode(useCase.runTimed('nope'), 'JOB_NOT_FOUND');

    repo.jobs.set('e1', makeJob({ id: 'e1', status: 'expired' }));
    await expectCode(useCase.runTimed('e1'), 'JOB_EXPIRED');

    repo.jobs.set('q1', makeJob({ id: 'q1', status: 'transcribing' }));
    await expectCode(useCase.runTimed('q1'), 'JOB_NOT_READY');
  });

  it('产物文件缺失(ENOENT)→ JOB_NOT_READY', async () => {
    const { repo, files, useCase } = setup();
    repo.jobs.set('t1', makeJob({ id: 't1', status: 'succeeded', result: timedResult }));
    const err = new Error('ENOENT: no such file or directory, open');
    (err as NodeJS.ErrnoException).code = 'ENOENT';
    files.readError = err;

    await expectCode(useCase.runTimed('t1'), 'JOB_NOT_READY');
  });
});
