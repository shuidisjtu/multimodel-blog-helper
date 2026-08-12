/**
 * CleanupExpired 用例单元测试(架构文档 §4.2/§5): fake 端口。
 * 覆盖集成测试难以构造的错误路径与竞态: 列表失败抛错 / 单任务删除/更新/移除失败继续 /
 * update 竞态(以仓储最终状态为准) / tombstone 二次清理的保留期判定。
 */
import { describe, expect, it } from 'vitest';
import { CleanupExpired } from '../../src/application/cleanup-expired.js';
import { DomainError } from '../../src/domain/errors.js';
import type { BlogJob } from '../../src/domain/job.js';
import type { CreateOrGetOutcome, FileStore, JobRepository } from '../../src/domain/ports.js';
import type { Clock } from '../../src/shared/clock.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

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

/** 内存 fake 仓储: listExpired 可编程返回列表; update/remove 可按任务注入失败。 */
class FakeRepo implements JobRepository {
  readonly jobs = new Map<string, BlogJob>();
  expiredList: BlogJob[] = [];
  listExpiredError: unknown = null;
  updateErrorFor = new Set<string>();
  removeErrorFor = new Set<string>();
  readonly removedIds: string[] = [];

  async create(): Promise<BlogJob> {
    throw new Error('not used in CleanupExpired tests');
  }

  async createOrGetByIdempotencyKey(): Promise<CreateOrGetOutcome> {
    throw new Error('not used in CleanupExpired tests');
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
    return [];
  }

  async listInProgress(): Promise<BlogJob[]> {
    return [];
  }

  async listExpired(): Promise<BlogJob[]> {
    if (this.listExpiredError !== null) throw this.listExpiredError;
    return this.expiredList;
  }

  async remove(id: string): Promise<void> {
    if (this.removeErrorFor.has(id)) throw new Error(`remove boom: ${id}`);
    this.removedIds.push(id);
    this.jobs.delete(id);
  }
}

/** 记录删除调用并可按 jobId 注入失败的 fake 文件仓。 */
class FakeFiles implements FileStore {
  readonly deletedJobIds: string[] = [];
  deleteErrorFor = new Set<string>();

  async saveInput(): Promise<{ path: string; sha256: string }> {
    throw new Error('not used in CleanupExpired tests');
  }

  async saveOutput(): Promise<{ path: string }> {
    throw new Error('not used in CleanupExpired tests');
  }

  async read(): Promise<Buffer> {
    return Buffer.alloc(0);
  }

  async deleteJobFiles(jobId: string): Promise<number> {
    if (this.deleteErrorFor.has(jobId)) throw new Error(`delete boom: ${jobId}`);
    this.deletedJobIds.push(jobId);
    return 1;
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
    expiresAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function setup() {
  const repo = new FakeRepo();
  const files = new FakeFiles();
  const logger = new FakeLogger();
  const clock: Clock = { now: () => FIXED_NOW };
  const useCase = new CleanupExpired({ jobs: repo, files, clock, logger, tombstoneRetentionDays: 30 });
  return { repo, files, logger, useCase };
}

describe('CleanupExpired 单元(架构文档 §4.2/§5)', () => {
  it('listExpired 失败(仓储不可用): 向外抛错, 调度方应感知', async () => {
    const { repo, useCase } = setup();
    repo.listExpiredError = new Error('repo down');

    await expect(useCase.run()).rejects.toThrow('repo down');
  });

  it('单任务删除文件失败: 记录日志继续处理其余任务, 计数只含成功项', async () => {
    const { repo, files, logger, useCase } = setup();
    repo.jobs.set('a', makeJob({ id: 'a', status: 'succeeded', result: { transcriptPath: '/t', summary: 's', model: 'm' } }));
    repo.jobs.set('b', makeJob({ id: 'b', status: 'succeeded', result: { transcriptPath: '/t', summary: 's', model: 'm' } }));
    repo.expiredList = [repo.jobs.get('a')!, repo.jobs.get('b')!];
    files.deleteErrorFor.add('a');

    const result = await useCase.run();

    expect(result).toEqual({ expiredCount: 1, removedTombstones: 0 });
    expect(repo.jobs.get('a')!.status).toBe('succeeded'); // 失败任务保持原状态
    expect(repo.jobs.get('b')!.status).toBe('expired');
    expect(logger.calls.some((c) => c.event === 'cleanup.job_failed' && c.jobId === 'a' && c.level === 'error')).toBe(true);
    expect(logger.calls.some((c) => c.event === 'cleanup.done' && c.expiredCount === 1 && c.level === 'info')).toBe(true);
  });

  it('单任务 update 失败: 记录日志继续处理其余任务', async () => {
    const { repo, files, logger, useCase } = setup();
    repo.jobs.set('a', makeJob({ id: 'a', status: 'succeeded', result: { transcriptPath: '/t', summary: 's', model: 'm' } }));
    repo.jobs.set('b', makeJob({ id: 'b', status: 'succeeded', result: { transcriptPath: '/t', summary: 's', model: 'm' } }));
    repo.expiredList = [repo.jobs.get('a')!, repo.jobs.get('b')!];
    repo.updateErrorFor.add('a');

    const result = await useCase.run();

    expect(result).toEqual({ expiredCount: 1, removedTombstones: 0 });
    // 删除先于 update 执行(§4.2 顺序), 但任务未被迁移为 expired
    expect(files.deletedJobIds).toContain('a');
    expect(repo.jobs.get('a')!.status).toBe('succeeded');
    expect(repo.jobs.get('b')!.status).toBe('expired');
    expect(logger.calls.some((c) => c.event === 'cleanup.job_failed' && c.jobId === 'a' && c.level === 'error')).toBe(true);
  });

  it('update 竞态: 列表时终态、更新时已被外部迁移 → 跳过, 以仓储最终状态为准', async () => {
    const { repo, files, useCase } = setup();
    // listExpired 返回的仍是 succeeded 快照, 但仓储当前已是 queued(如被恢复逻辑处理)
    repo.expiredList = [makeJob({ id: 'x', status: 'succeeded', result: { transcriptPath: '/t', summary: 's', model: 'm' } })];
    repo.jobs.set('x', makeJob({ id: 'x', status: 'queued' }));

    const result = await useCase.run();

    expect(result).toEqual({ expiredCount: 0, removedTombstones: 0 }); // 未实际置 tombstone 不计数
    expect(repo.jobs.get('x')!.status).toBe('queued'); // 终态以仓储为准
    // 按 §4.2 顺序删除先于 update, 竞态窗口内的文件已删(任务元数据未被破坏)
    expect(files.deletedJobIds).toEqual(['x']);
  });

  it('tombstone 超过保留期(updatedAt < now - retention): remove 并计数', async () => {
    const { repo, useCase } = setup();
    const old = makeJob({ id: 'old-1', status: 'expired', updatedAt: '2026-07-01T00:00:00.000Z', input: undefined });
    repo.expiredList = [old];

    const result = await useCase.run();

    expect(result).toEqual({ expiredCount: 0, removedTombstones: 1 });
    expect(repo.removedIds).toEqual(['old-1']);
  });

  it('未传 tombstoneRetentionDays 时使用默认 30 天(§4.2 建议)', async () => {
    const repo = new FakeRepo();
    const files = new FakeFiles();
    const logger = new FakeLogger();
    const clock: Clock = { now: () => FIXED_NOW };
    const useCase = new CleanupExpired({ jobs: repo, files, clock, logger });
    repo.expiredList = [makeJob({ id: 'old-1', status: 'expired', updatedAt: '2026-07-01T00:00:00.000Z', input: undefined })];

    const result = await useCase.run();

    expect(result).toEqual({ expiredCount: 0, removedTombstones: 1 }); // 31 天前 → 超过默认 30 天
    expect(repo.removedIds).toEqual(['old-1']);
  });

  it('tombstone 未超过保留期: 保留不删', async () => {
    const { repo, useCase } = setup();
    const fresh = makeJob({ id: 'fresh-1', status: 'expired', updatedAt: '2026-08-01T00:00:00.000Z', input: undefined });
    repo.expiredList = [fresh];
    repo.jobs.set('fresh-1', fresh);

    const result = await useCase.run();

    expect(result).toEqual({ expiredCount: 0, removedTombstones: 0 });
    expect(repo.removedIds).toEqual([]);
    expect(repo.jobs.get('fresh-1')).toBe(fresh); // 原样保留, remove 未被调用
  });

  it('tombstone 单个移除失败: 记录日志继续处理其余 tombstone', async () => {
    const { repo, logger, useCase } = setup();
    repo.expiredList = [
      makeJob({ id: 'x', status: 'expired', updatedAt: '2026-07-01T00:00:00.000Z', input: undefined }),
      makeJob({ id: 'y', status: 'expired', updatedAt: '2026-07-01T00:00:00.000Z', input: undefined }),
    ];
    repo.removeErrorFor.add('x');

    const result = await useCase.run();

    expect(result).toEqual({ expiredCount: 0, removedTombstones: 1 });
    expect(repo.removedIds).toEqual(['y']);
    expect(logger.calls.some((c) => c.event === 'cleanup.job_failed' && c.jobId === 'x' && c.level === 'error')).toBe(true);
  });
});
