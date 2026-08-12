/**
 * RecoverJobs 用例测试(架构文档 §4.2 启动恢复): fake 仓储 + 真实 MemoryJobQueue。
 * 覆盖: queued 全部重入队 / 进行中标记 failed(PROCESS_INTERRUPTED)且不重入队 /
 * QUEUE_FULL 跳过不抛错 / 单任务异常记录日志继续 / 仓储不可用(列表失败)抛错。
 */
import { describe, expect, it } from 'vitest';
import { RecoverJobs } from '../../src/application/recover-jobs.js';
import { DomainError } from '../../src/domain/errors.js';
import type { BlogJob } from '../../src/domain/job.js';
import type { CreateOrGetOutcome, JobQueue, JobRepository } from '../../src/domain/ports.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';
import { MemoryJobQueue } from '../../src/infrastructure/queue/memory-job-queue.js';

const FIXED_NOW = '2026-08-12T00:00:00.000Z';

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

/** 内存 fake 仓储: 可对指定任务注入 update 失败。 */
class InMemoryJobRepo implements JobRepository {
  readonly jobs = new Map<string, BlogJob>();
  updateErrorFor = new Set<string>();
  listRecoverableError: unknown = null;

  async create(): Promise<BlogJob> {
    throw new Error('not used in RecoverJobs tests');
  }

  async createOrGetByIdempotencyKey(): Promise<CreateOrGetOutcome> {
    throw new Error('not used in RecoverJobs tests');
  }

  async get(id: string): Promise<BlogJob | null> {
    return this.jobs.get(id) ?? null;
  }

  async update(id: string, mutator: (job: BlogJob) => BlogJob): Promise<BlogJob> {
    if (this.updateErrorFor.has(id)) throw new Error(`update boom: ${id}`);
    const job = this.jobs.get(id);
    if (job === undefined) throw new DomainError('JOB_NOT_FOUND', `Job not found: ${id}`);
    const updated = mutator(job);
    this.jobs.set(id, updated);
    return updated;
  }

  async listRecoverable(): Promise<BlogJob[]> {
    if (this.listRecoverableError !== null) throw this.listRecoverableError;
    return [...this.jobs.values()].filter((j) => j.status === 'queued');
  }

  async listInProgress(): Promise<BlogJob[]> {
    return [...this.jobs.values()].filter((j) => j.status === 'transcribing' || j.status === 'summarizing');
  }

  async listExpired(): Promise<BlogJob[]> {
    return [];
  }

  async remove(): Promise<void> {
    throw new Error('not used in RecoverJobs tests');
  }
}

/** 指定 jobId 入队即抛普通错误的包装队列(验证非 QUEUE_FULL 异常不中断恢复)。 */
class FailingQueue implements JobQueue {
  constructor(
    private readonly inner: JobQueue,
    private readonly failIds: ReadonlySet<string>,
  ) {}

  enqueue(jobId: string): void {
    if (this.failIds.has(jobId)) throw new Error(`boom: ${jobId}`);
    this.inner.enqueue(jobId);
  }

  subscribe(handler: (jobId: string) => Promise<void>): void {
    this.inner.subscribe(handler);
  }

  size(): number {
    return this.inner.size();
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
      sha256: 'abc123',
    },
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    expiresAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

function setup(queue: JobQueue = new MemoryJobQueue(10, 1)) {
  const repo = new InMemoryJobRepo();
  const logger = new FakeLogger();
  const clock = { now: () => FIXED_NOW };
  const useCase = new RecoverJobs({ jobs: repo, queue, clock, logger });
  return { repo, queue, logger, useCase };
}

describe('RecoverJobs(架构文档 §4.2 启动恢复)', () => {
  it('queued 任务全部重新入队: 计数/队列 size/日志正确, 不触碰进行中任务', async () => {
    const { repo, queue, logger, useCase } = setup();
    for (const id of ['q-1', 'q-2', 'q-3']) repo.jobs.set(id, makeJob({ id }));

    const result = await useCase.run();

    expect(result).toEqual({ requeued: 3, interrupted: 0 });
    expect(queue.size()).toBe(3); // 无订阅者, pending 全部滞留
    const requeuedLogs = logger.calls.filter((c) => c.event === 'job.requeued' && c.level === 'info');
    expect(requeuedLogs.map((l) => l.jobId).sort()).toEqual(['q-1', 'q-2', 'q-3']);
    expect(logger.calls.every((c) => c.level !== 'error' && c.level !== 'warn')).toBe(true);
  });

  it('transcribing/summarizing → failed + PROCESS_INTERRUPTED, 不重入队', async () => {
    const { repo, queue, logger, useCase } = setup();
    repo.jobs.set('t-1', makeJob({ id: 't-1', status: 'transcribing' }));
    repo.jobs.set('s-1', makeJob({ id: 's-1', status: 'summarizing' }));

    const result = await useCase.run();

    expect(result).toEqual({ requeued: 0, interrupted: 2 });
    expect(queue.size()).toBe(0);
    const t1 = repo.jobs.get('t-1')!;
    const s1 = repo.jobs.get('s-1')!;
    expect(t1.status).toBe('failed');
    expect(t1.failure).toEqual({ code: 'PROCESS_INTERRUPTED', safeMessage: 'Processing interrupted by restart' });
    expect(s1.status).toBe('failed');
    expect(s1.failure).toEqual({ code: 'PROCESS_INTERRUPTED', safeMessage: 'Processing interrupted by restart' });
    const interruptLogs = logger.calls.filter((c) => c.event === 'job.interrupted' && c.level === 'error');
    expect(interruptLogs.map((l) => l.jobId).sort()).toEqual(['s-1', 't-1']);
    expect(interruptLogs.every((l) => l.errorCode === 'PROCESS_INTERRUPTED')).toBe(true);
  });

  it('重入队遇 QUEUE_FULL: warn 日志 + 跳过, 不抛错, 剩余任务继续', async () => {
    const { repo, queue, logger, useCase } = setup(new MemoryJobQueue(2, 1));
    for (const id of ['q-1', 'q-2', 'q-3']) repo.jobs.set(id, makeJob({ id }));

    const result = await useCase.run();

    expect(result).toEqual({ requeued: 2, interrupted: 0 });
    expect(queue.size()).toBe(2); // 前两个入队, 第三个因满员跳过
    const fullLogs = logger.calls.filter((c) => c.event === 'recovery.queue_full' && c.level === 'warn');
    expect(fullLogs.map((l) => l.jobId)).toEqual(['q-3']);
    // 该任务保持 queued, 下次启动或手动重试仍可恢复
    expect(repo.jobs.get('q-3')!.status).toBe('queued');
  });

  it('混合场景计数: 2 queued + 1 transcribing → { requeued: 2, interrupted: 1 }', async () => {
    const { repo, queue, useCase } = setup();
    repo.jobs.set('q-1', makeJob({ id: 'q-1' }));
    repo.jobs.set('q-2', makeJob({ id: 'q-2' }));
    repo.jobs.set('t-1', makeJob({ id: 't-1', status: 'transcribing' }));

    const result = await useCase.run();

    expect(result).toEqual({ requeued: 2, interrupted: 1 });
    expect(queue.size()).toBe(2);
    expect(repo.jobs.get('t-1')!.status).toBe('failed');
  });

  it('单任务 update 失败: 记录日志继续处理其余任务(整体不抛错)', async () => {
    const { repo, queue, logger, useCase } = setup();
    repo.jobs.set('t-1', makeJob({ id: 't-1', status: 'transcribing' }));
    repo.jobs.set('s-1', makeJob({ id: 's-1', status: 'summarizing' }));
    repo.updateErrorFor.add('t-1');

    await expect(useCase.run()).resolves.toEqual({ requeued: 0, interrupted: 1 });

    expect(repo.jobs.get('t-1')!.status).toBe('transcribing'); // 失败任务保持原状态
    expect(repo.jobs.get('s-1')!.status).toBe('failed'); // 其余任务继续
    expect(logger.calls.some((c) => c.event === 'recovery.interrupt_failed' && c.jobId === 't-1' && c.level === 'error')).toBe(true);
  });

  it('入队非 QUEUE_FULL 异常: 记录日志继续, 不中断整体恢复', async () => {
    const queue = new FailingQueue(new MemoryJobQueue(10, 1), new Set(['q-2']));
    const { repo, logger, useCase } = setup(queue);
    repo.jobs.set('q-1', makeJob({ id: 'q-1' }));
    repo.jobs.set('q-2', makeJob({ id: 'q-2' }));

    const result = await useCase.run();

    expect(result).toEqual({ requeued: 1, interrupted: 0 });
    expect(logger.calls.some((c) => c.event === 'recovery.requeue_failed' && c.jobId === 'q-2' && c.level === 'error')).toBe(true);
  });

  it('listRecoverable 失败(仓储不可用): 向外抛错, 让启动失败可感知', async () => {
    const { repo, useCase } = setup();
    repo.listRecoverableError = new Error('repo down');

    await expect(useCase.run()).rejects.toThrow('repo down');
  });
});
