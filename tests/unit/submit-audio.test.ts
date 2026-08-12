import { describe, expect, it } from 'vitest';
import { SubmitAudio, type SubmitAudioParams } from '../../src/application/submit-audio.js';
import { DomainError } from '../../src/domain/errors.js';
import type { BlogJob } from '../../src/domain/job.js';
import type {
  CreateJobParams,
  CreateOrGetOutcome,
  FileStore,
  JobQueue,
  JobRepository,
  SaveInputParams,
  SaveOutputParams,
} from '../../src/domain/ports.js';
import type { Clock } from '../../src/shared/clock.js';
import type { IdGenerator } from '../../src/shared/ids.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';
import { MemoryJobQueue } from '../../src/infrastructure/queue/memory-job-queue.js';

/** 可控 fake: 固定时间。 */
const FIXED_NOW = '2026-08-12T00:00:00.000Z';
const clock: Clock = { now: () => FIXED_NOW };

/** 可控 fake: 顺序 id。 */
class SeqIds implements IdGenerator {
  private n = 0;
  nextId(): string {
    this.n++;
    return `job-${this.n}`;
  }
}

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

/** 内存 fake 仓储: 记录 create/createOrGet/remove 调用; createOrGet 结果可编程。 */
class InMemoryJobRepo implements JobRepository {
  readonly jobs = new Map<string, BlogJob>();
  readonly createCalls: CreateJobParams[] = [];
  readonly createOrGetCalls: CreateJobParams[] = [];
  readonly removeCalls: string[] = [];
  /** createOrGet 的编程结果; 'from-create' 表示内部走 create 返回 created。 */
  createOrGetResult: CreateOrGetOutcome | 'from-create' = 'from-create';
  /** 编程注入的 get 错误。 */
  getError: unknown;
  /** 编程注入的 create 错误(模拟仓储持久化失败)。 */
  createError: unknown;
  /** 编程注入的 createOrGet 错误(模拟占位损坏等幂等创建失败)。 */
  createOrGetError: unknown;

  async create(params: CreateJobParams): Promise<BlogJob> {
    this.createCalls.push(params);
    if (this.createError !== undefined) throw this.createError;
    return this.storeNewJob(params);
  }

  async createOrGetByIdempotencyKey(params: CreateJobParams): Promise<CreateOrGetOutcome> {
    this.createOrGetCalls.push(params);
    if (this.createOrGetError !== undefined) throw this.createOrGetError;
    if (this.createOrGetResult !== 'from-create') return this.createOrGetResult;
    return { outcome: 'created', job: await this.storeNewJob(params) };
  }

  /** 由 create/createOrGet 共用; 记录职责在各自方法上, 互不污染调用计数。 */
  private async storeNewJob(params: CreateJobParams): Promise<BlogJob> {
    const job = buildJob(params, params.id ?? `auto-${this.jobs.size + 1}`);
    this.jobs.set(job.id, job);
    return job;
  }

  async get(id: string): Promise<BlogJob | null> {
    if (this.getError !== undefined) throw this.getError;
    return this.jobs.get(id) ?? null;
  }

  async update(id: string, mutator: (job: BlogJob) => BlogJob): Promise<BlogJob> {
    const job = this.jobs.get(id);
    if (job === undefined) throw new DomainError('JOB_NOT_FOUND', `Job not found: ${id}`);
    const updated = mutator(job);
    this.jobs.set(id, updated);
    return updated;
  }

  async listRecoverable(): Promise<BlogJob[]> {
    return [...this.jobs.values()].filter((j) => j.status === 'queued');
  }

  async listInProgress(): Promise<BlogJob[]> {
    return [...this.jobs.values()].filter((j) => j.status === 'transcribing' || j.status === 'summarizing');
  }

  async listExpired(): Promise<BlogJob[]> {
    return [...this.jobs.values()].filter((j) => j.expiresAt < FIXED_NOW);
  }

  async remove(id: string): Promise<void> {
    this.removeCalls.push(id);
    this.jobs.delete(id);
  }
}

/** 记录型 fake 文件仓: saveInput/saveOutput 固定路径; saveInput 可编程抛错。 */
class FakeFileStore implements FileStore {
  readonly savedInputs: SaveInputParams[] = [];
  readonly savedOutputs: SaveOutputParams[] = [];
  readonly deletedJobIds: string[] = [];
  saveInputError: unknown;
  deleteJobFilesError: unknown;

  async saveInput(params: SaveInputParams): Promise<{ path: string; sha256: string }> {
    if (this.saveInputError !== undefined) throw this.saveInputError;
    this.savedInputs.push(params);
    return { path: `/tmp/uploads/${params.jobId}/input.bin`, sha256: 'abc123' };
  }

  async saveOutput(params: SaveOutputParams): Promise<{ path: string }> {
    this.savedOutputs.push(params);
    return { path: `/tmp/outputs/${params.jobId}/${params.kind}.txt` };
  }

  async read(): Promise<Buffer> {
    return Buffer.alloc(0);
  }

  async deleteJobFiles(jobId: string): Promise<number> {
    this.deletedJobIds.push(jobId);
    if (this.deleteJobFilesError !== undefined) throw this.deleteJobFilesError;
    return 1;
  }
}

function buildJob(params: CreateJobParams, id: string): BlogJob {
  return {
    id,
    requestId: params.requestId,
    status: 'queued',
    input: params.input,
    idempotencyKey: params.idempotencyKey,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    expiresAt: params.expiresAt,
  };
}

function makeParams(overrides: Partial<SubmitAudioParams> = {}): SubmitAudioParams {
  return {
    requestId: 'req-1',
    originalName: 'demo.mp3',
    mimeType: 'audio/mpeg',
    bytes: Buffer.from('fake audio bytes'),
    ...overrides,
  };
}

function setup(opts: { queue?: JobQueue; jobTtlHours?: number; queueMaxLength?: number } = {}) {
  const repo = new InMemoryJobRepo();
  const files = new FakeFileStore();
  const queue = opts.queue ?? new MemoryJobQueue(10, 1);
  const logger = new FakeLogger();
  const useCase = new SubmitAudio({
    jobs: repo,
    files,
    queue,
    clock,
    ids: new SeqIds(),
    logger,
    jobTtlHours: opts.jobTtlHours ?? 24,
    queueMaxLength: opts.queueMaxLength ?? 10,
  });
  return { repo, files, queue, logger, useCase };
}

describe('SubmitAudio(架构文档 §5/§6.1-§6.2)', () => {
  it('成功路径: created + queued + 文件已保存 + 入队 size=1', async () => {
    const { repo, files, queue, logger, useCase } = setup();
    const outcome = await useCase.run(makeParams());

    expect(outcome.outcome).toBe('created');
    expect(outcome.job.status).toBe('queued');
    expect(outcome.job.id).toBe('job-1');
    expect(outcome.job.requestId).toBe('req-1');
    // BlogJob.input 在 tombstone 最小化后为可选(§4.2), 新建任务必然存在
    const createdInput = outcome.job.input!;
    expect(createdInput.originalName).toBe('demo.mp3');
    expect(createdInput.mimeType).toBe('audio/mpeg');
    expect(createdInput.bytes).toBe(Buffer.byteLength('fake audio bytes'));
    expect(createdInput.sha256).toBe('abc123');
    expect(createdInput.path).toBe('/tmp/uploads/job-1/input.bin');

    expect(files.savedInputs).toHaveLength(1);
    const saved = files.savedInputs[0]!;
    expect(saved).toMatchObject({ jobId: 'job-1', originalName: 'demo.mp3', mimeType: 'audio/mpeg' });
    expect(saved.bytes.equals(Buffer.from('fake audio bytes'))).toBe(true);

    expect(queue.size()).toBe(1);
    expect(repo.createCalls).toHaveLength(1);
    expect(repo.createOrGetCalls).toHaveLength(0);
    expect(logger.calls.some((c) => c.event === 'job.enqueued' && c.jobId === 'job-1')).toBe(true);
  });

  it('无幂等 key 走 create(不调用 createOrGet)', async () => {
    const { repo, useCase } = setup();
    await useCase.run(makeParams());
    expect(repo.createCalls).toHaveLength(1);
    expect(repo.createOrGetCalls).toHaveLength(0);
  });

  it('有幂等 key 走 createOrGet(created)并入队, job 带 idempotencyKey', async () => {
    const { repo, queue, useCase } = setup();
    const outcome = await useCase.run(makeParams({ idempotencyKey: 'key-1' }));

    expect(outcome.outcome).toBe('created');
    expect(repo.createCalls).toHaveLength(0);
    expect(repo.createOrGetCalls).toHaveLength(1);
    expect(repo.createOrGetCalls[0]!.idempotencyKey).toBe('key-1');
    expect(outcome.job.idempotencyKey).toBe('key-1');
    expect(outcome.job.id).toBe('job-1');
    expect(queue.size()).toBe(1);
  });

  it('幂等重放(replayed): 不再入队, 已上传文件被清理(deleteJobFiles)', async () => {
    const { repo, files, queue, useCase } = setup();
    const existing: BlogJob = {
      id: 'existing-1',
      requestId: 'req-1',
      status: 'queued',
      input: {
        path: '/tmp/uploads/existing-1/input.bin',
        originalName: 'demo.mp3',
        mimeType: 'audio/mpeg',
        bytes: 15,
        sha256: 'abc123',
      },
      idempotencyKey: 'key-1',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      expiresAt: '2026-08-13T00:00:00.000Z',
    };
    repo.jobs.set('existing-1', existing);
    repo.createOrGetResult = { outcome: 'replayed', job: existing };

    const outcome = await useCase.run(makeParams({ idempotencyKey: 'key-1' }));

    expect(outcome.outcome).toBe('replayed');
    expect(outcome.job.id).toBe('existing-1');
    expect(queue.size()).toBe(0); // 不再入队
    expect(repo.createCalls).toHaveLength(0);
    expect(files.deletedJobIds).toEqual(['job-1']); // 落败者清理本次上传(新 jobId)
  });

  it('幂等冲突(conflict): 同上, 不再入队且清理已上传文件', async () => {
    const { repo, files, queue, useCase } = setup();
    const existing: BlogJob = {
      id: 'existing-1',
      requestId: 'req-1',
      status: 'queued',
      input: {
        path: '/tmp/uploads/existing-1/input.bin',
        originalName: 'demo.mp3',
        mimeType: 'audio/mpeg',
        bytes: 15,
        sha256: 'different-sha',
      },
      idempotencyKey: 'key-1',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      expiresAt: '2026-08-13T00:00:00.000Z',
    };
    repo.jobs.set('existing-1', existing);
    repo.createOrGetResult = { outcome: 'conflict', job: existing };

    const outcome = await useCase.run(makeParams({ idempotencyKey: 'key-1' }));

    expect(outcome.outcome).toBe('conflict');
    expect(outcome.job.id).toBe('existing-1');
    expect(queue.size()).toBe(0);
    expect(files.deletedJobIds).toEqual(['job-1']);
  });

  it('队列预检满(queueMaxLength=0): 抛 QUEUE_FULL 且不落盘(saveInput/create 均未调用)', async () => {
    const { repo, files, useCase } = setup({
      queue: new MemoryJobQueue(0, 1),
      queueMaxLength: 0,
    });

    let thrown: unknown;
    try {
      await useCase.run(makeParams());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('QUEUE_FULL');
    expect((thrown as DomainError).message).toBe('Queue is full, retry later');
    expect(files.savedInputs).toHaveLength(0);
    expect(repo.createCalls).toHaveLength(0);
    expect(repo.removeCalls).toHaveLength(0);
  });

  it('入队时 QUEUE_FULL: 回滚 remove + deleteJobFiles, 错误向上传播', async () => {
    const throwingQueue: JobQueue = {
      size: () => 0,
      enqueue: () => {
        throw new DomainError('QUEUE_FULL', 'Queue is full');
      },
      subscribe: () => {},
    };
    const { repo, files, useCase } = setup({ queue: throwingQueue, queueMaxLength: 10 });

    let thrown: unknown;
    try {
      await useCase.run(makeParams());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('QUEUE_FULL');
    expect(files.savedInputs).toHaveLength(1); // 先落盘
    expect(repo.createCalls).toHaveLength(1); // 后建任务
    expect(repo.removeCalls).toEqual(['job-1']); // 回滚: 删除 Job 记录
    expect(files.deletedJobIds).toEqual(['job-1']); // 回滚: 删除输入文件
  });

  it('create 抛错(如占位损坏 INTERNAL_ERROR): 清理已上传文件后原始错误向上传播', async () => {
    const { repo, files, useCase } = setup();
    repo.createError = new DomainError('INTERNAL_ERROR', 'Corrupt idempotency placeholder');

    let thrown: unknown;
    try {
      await useCase.run(makeParams());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('INTERNAL_ERROR');
    expect((thrown as DomainError).message).toBe('Corrupt idempotency placeholder'); // 原始错误不被掩盖
    expect(files.savedInputs).toHaveLength(1); // 先落盘
    expect(repo.createCalls).toHaveLength(1);
    expect(files.deletedJobIds).toEqual(['job-1']); // 回滚: 清理本次上传文件
    expect(repo.removeCalls).toHaveLength(0); // job 未创建成功, 无需 remove
  });

  it('createOrGet 抛错: 同样清理已上传文件后原始错误向上传播', async () => {
    const { repo, files, useCase } = setup();
    // 占位文件损坏(内容非 JSON)时仓储抛 INTERNAL_ERROR, 见 file-job-repository 测试
    repo.createOrGetError = new DomainError('INTERNAL_ERROR', 'Idempotency placeholder corrupt');

    let thrown: unknown;
    try {
      await useCase.run(makeParams({ idempotencyKey: 'key-1' }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('INTERNAL_ERROR');
    expect(files.savedInputs).toHaveLength(1);
    expect(repo.createOrGetCalls).toHaveLength(1);
    expect(files.deletedJobIds).toEqual(['job-1']);
  });

  it('create 抛错且清理文件也失败: 原始错误仍向上传播, 清理失败仅记录日志', async () => {
    const { repo, files, logger, useCase } = setup();
    repo.createError = new DomainError('INTERNAL_ERROR', 'Corrupt idempotency placeholder');
    files.deleteJobFilesError = new Error('disk on fire');

    let thrown: unknown;
    try {
      await useCase.run(makeParams());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('INTERNAL_ERROR');
    expect((thrown as DomainError).message).toBe('Corrupt idempotency placeholder'); // 不被清理错误掩盖
    expect(files.deletedJobIds).toEqual(['job-1']); // 清理仍被调用(只是失败了)
    expect(
      logger.calls.some((c) => c.event === 'job.submit.cleanup_failed' && c.jobId === 'job-1'),
    ).toBe(true);
  });

  it('expiresAt = now + jobTtlHours 小时(ISO 8601)', async () => {
    const { useCase } = setup({ jobTtlHours: 24 });
    const outcome = await useCase.run(makeParams());
    expect(outcome.job.expiresAt).toBe('2026-08-13T00:00:00.000Z');

    const { useCase: useCase1h } = setup({ jobTtlHours: 1 });
    const outcome1h = await useCase1h.run(makeParams());
    expect(outcome1h.job.expiresAt).toBe('2026-08-12T01:00:00.000Z');
  });

  it('saveInput 抛未知错误: 转换为 INTERNAL_ERROR 传播, 原始错误仅记录日志', async () => {
    const { files, logger, useCase } = setup();
    files.saveInputError = new Error('disk on fire');

    let thrown: unknown;
    try {
      await useCase.run(makeParams());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('INTERNAL_ERROR');
    expect((thrown as DomainError).message).toBe('Internal error');
    expect(
      logger.calls.some(
        (c) => c.event === 'job.submit.failed' && c.errorCode === 'INTERNAL_ERROR' && c.error !== undefined,
      ),
    ).toBe(true);
  });
});
