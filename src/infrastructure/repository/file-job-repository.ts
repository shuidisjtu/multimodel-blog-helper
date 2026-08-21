/**
 * FileJobRepository:jobs/ 目录下的 JSON 文件仓储(架构文档 §4.2/§5/§7.1)。
 * - 原子写: 一律先写 <目标>.tmp 再 rename(§4.2)
 * - 幂等占位: jobs/by-key/<sha256(key)>.json, 以 fs.open(path, 'wx') O_EXCL 原子互斥(§5)
 * - 列表扫描容忍单文件损坏(记录后跳过), 保证启动恢复/清理整体可用
 * - 错误消息中性化: DomainError 的 message 不含路径等内部细节(§8.1), 细节入 details 供排障
 */
import { createHash } from 'node:crypto';
import { type Dirent, mkdirSync } from 'node:fs';
import { type FileHandle, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DomainError } from '../../domain/errors.js';
import type { BlogJob, JobStatus } from '../../domain/job.js';
import type { CreateJobParams, CreateOrGetOutcome, JobRepository } from '../../domain/ports.js';
import type { Clock } from '../../shared/clock.js';
import type { IdGenerator } from '../../shared/ids.js';

const JOB_STATUSES: readonly JobStatus[] = [
  'queued',
  'transcribing',
  'summarizing',
  'succeeded',
  'failed',
  'expired',
];

export class FileJobRepository implements JobRepository {
  private readonly jobsDir: string;
  private readonly keysDir: string;

  constructor(
    tempDir: string,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.jobsDir = join(tempDir, 'jobs');
    this.keysDir = join(this.jobsDir, 'by-key');
    // recursive 同时创建 jobs/ 与 jobs/by-key/
    mkdirSync(this.keysDir, { recursive: true });
  }

  async create(params: CreateJobParams): Promise<BlogJob> {
    const id = params.id ?? this.ids.nextId();
    const job = this.buildJob(params, id);
    await this.writeJobFile(job);
    if (params.idempotencyKey !== undefined) {
      // 与 createOrGet 保持一致性: 同一 key 后续幂等请求可命中占位
      await this.writePlaceholder(params.idempotencyKey, {
        jobId: id,
        sha256: params.input.sha256,
      });
    }
    return job;
  }

  async createOrGetByIdempotencyKey(params: CreateJobParams): Promise<CreateOrGetOutcome> {
    // 无 key 时语义等同普通创建
    if (params.idempotencyKey === undefined) {
      return { outcome: 'created', job: await this.create(params) };
    }
    const keyPath = this.placeholderPath(params.idempotencyKey);
    for (let attempt = 1; ; attempt++) {
      let fd: FileHandle | null = null;
      try {
        fd = await open(keyPath, 'wx');
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err;
        // key 已被占用: 回读占位决定 replayed / conflict / 孤儿清理后重试
        const placeholder = await this.readPlaceholder(keyPath);
        const job = await this.get(placeholder.jobId);
        if (job !== null) {
          if (job.input === undefined) {
            // 占位指向 tombstone(§4.2 最小化后无 input): 无法比对 sha256, 幂等命中直接重放原 Job(查询端返回 410)
            return { outcome: 'replayed', job };
          }
          if (job.input.sha256 === params.input.sha256) {
            return { outcome: 'replayed', job };
          }
          return { outcome: 'conflict', job };
        }
        // 占位孤儿(占位已写但任务已删除): 清除占位后重试一次完整创建(§5)
        await rm(keyPath, { force: true });
        if (attempt >= 2) {
          throw new DomainError('INTERNAL_ERROR', 'Idempotency placeholder orphan not resolvable', {
            idempotencyKey: params.idempotencyKey,
          });
        }
        continue;
      }
      // O_EXCL 成功: 拥有该 key
      const id = params.id ?? this.ids.nextId();
      const job = this.buildJob(params, id);
      try {
        await this.writeJobFile(job); // 先落 job 文件, 占位永远指向已存在的 job
        await fd.write(JSON.stringify({ jobId: id, sha256: params.input.sha256 }));
        await fd.close();
        return { outcome: 'created', job };
      } catch (err) {
        // 失败回滚: 关闭 fd、删除占位与 job 文件, 防止幂等键卡死与孤儿任务(§5)
        await fd.close().catch(() => undefined);
        await rm(keyPath, { force: true });
        await rm(this.jobFilePath(id), { force: true });
        throw err;
      }
    }
  }

  async get(id: string): Promise<BlogJob | null> {
    return this.readJobFile(this.jobFilePath(id));
  }

  async update(id: string, mutator: (job: BlogJob) => BlogJob): Promise<BlogJob> {
    const job = await this.get(id);
    if (job === null) {
      throw new DomainError('JOB_NOT_FOUND', 'Job not found', { id });
    }
    // 单线程内读-改-写天然原子(§4.2); updatedAt 一律强制刷新, 不信任 mutator
    const updated = { ...mutator(job), updatedAt: this.clock.now() };
    await this.writeJobFile(updated);
    return updated;
  }

  async listRecoverable(): Promise<BlogJob[]> {
    const jobs = await this.listAll();
    return jobs.filter((j) => j.status === 'queued');
  }

  async listInProgress(): Promise<BlogJob[]> {
    const jobs = await this.listAll();
    return jobs.filter((j) => j.status === 'transcribing' || j.status === 'summarizing');
  }

  async listExpired(now: string): Promise<BlogJob[]> {
    const jobs = await this.listAll();
    // ISO 8601 字典序等价时间序, 字符串比较即可(§4.2 清理)
    return jobs.filter((j) => j.expiresAt < now);
  }

  async remove(id: string): Promise<void> {
    // 占位清理: 任务元数据仍带 key 时按 key 删; tombstone 已清空 key, 再按 jobId 扫描兜底(§5: key 随 tombstone 清理)
    await this.removePlaceholders(id);
    await rm(this.jobFilePath(id), { force: true });
    await rm(`${this.jobFilePath(id)}.tmp`, { force: true });
  }

  /** 删除指向该 job 的幂等占位(快路径按 key; 扫描兜底覆盖已清空 key 的 tombstone)。 */
  private async removePlaceholders(id: string): Promise<void> {
    let job: BlogJob | null = null;
    try {
      job = await this.get(id);
    } catch (err) {
      // job 文件损坏也继续尽力清理(清理不可因单文件损坏中断, §4.2)
      console.error(`[FileJobRepository] remove: corrupt job file for ${id}`, err);
    }
    if (job !== null && job.idempotencyKey !== undefined) {
      const keyPath = this.placeholderPath(job.idempotencyKey);
      await rm(keyPath, { force: true });
      await rm(`${keyPath}.tmp`, { force: true });
    }
    // 扫描兜底: tombstone 已清空 idempotencyKey, 只能按占位内容匹配 jobId(§5)
    let entries: Dirent[];
    try {
      entries = await readdir(this.keysDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const placeholder = await this.readPlaceholder(join(this.keysDir, entry.name));
        if (placeholder.jobId !== id) continue;
        const p = join(this.keysDir, entry.name);
        await rm(p, { force: true });
        await rm(`${p}.tmp`, { force: true });
      } catch {
        // 空/损坏占位跳过(创建者写入中断窗口), 由 createOrGet 的孤儿自愈路径兜底(§5)
      }
    }
  }

  /** 新任务一律从 queued 起步(启动恢复按 queued 重入队)。 */
  private buildJob(params: CreateJobParams, id: string): BlogJob {
    const now = this.clock.now();
    return {
      id,
      requestId: params.requestId,
      status: 'queued',
      input: params.input,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
      updatedAt: now,
      expiresAt: params.expiresAt,
    };
  }

  /** 原子写: 先写 <目标>.tmp 再 rename(§4.2), pretty-print 2 空格便于排障。 */
  private async writeJobFile(job: BlogJob): Promise<void> {
    const filePath = this.jobFilePath(job.id);
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(job, null, 2), 'utf8');
    await rename(tmpPath, filePath);
  }

  /** 占位覆盖写(供 create 路径使用, 幂等创建互斥仍走 createOrGet 的 O_EXCL)。 */
  private async writePlaceholder(
    key: string,
    content: { jobId: string; sha256: string },
  ): Promise<void> {
    const filePath = this.placeholderPath(key);
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(content), 'utf8');
    await rename(tmpPath, filePath);
  }

  /** 读 job 文件: 不存在返回 null; 损坏/缺失必填字段抛 INTERNAL_ERROR, 不返回残缺对象。 */
  private async readJobFile(filePath: string): Promise<BlogJob | null> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw err;
    }
    try {
      const parsed: unknown = JSON.parse(content);
      if (!isBlogJob(parsed)) {
        throw new Error('missing required fields');
      }
      return parsed;
    } catch (err) {
      throw new DomainError('INTERNAL_ERROR', 'Corrupt job file', { path: filePath, cause: err });
    }
  }

  /** 读占位: 空内容或 JSON 损坏(创建者写入中断窗口)保守失败, 不猜不重试。 */
  private async readPlaceholder(keyPath: string): Promise<{ jobId: string; sha256: string }> {
    let content: string;
    try {
      content = await readFile(keyPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new DomainError('INTERNAL_ERROR', 'Idempotency placeholder disappeared', {
          path: keyPath,
        });
      }
      throw err;
    }
    if (content.length === 0) {
      throw new DomainError('INTERNAL_ERROR', 'Idempotency placeholder is empty', {
        path: keyPath,
      });
    }
    try {
      const parsed: unknown = JSON.parse(content);
      if (!isPlaceholder(parsed)) {
        throw new Error('invalid placeholder');
      }
      return parsed;
    } catch (err) {
      throw new DomainError('INTERNAL_ERROR', 'Idempotency placeholder corrupt', {
        path: keyPath,
        cause: err,
      });
    }
  }

  /** 扫描 jobs/*.json(排除 by-key/ 子目录与 .tmp 残留), 单文件损坏记录后跳过。 */
  private async listAll(): Promise<BlogJob[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.jobsDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
      throw err;
    }
    const jobs: BlogJob[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const job = await this.readJobFile(join(this.jobsDir, entry.name));
        if (job !== null) jobs.push(job);
      } catch (err) {
        console.error(`[FileJobRepository] skip corrupt job file: ${entry.name}`, err);
      }
    }
    return jobs;
  }

  private jobFilePath(id: string): string {
    return join(this.jobsDir, `${id}.json`);
  }

  /** 占位文件名 = sha256(key) 的十六进制, 防止 key 中的路径分隔符注入(§5)。 */
  private placeholderPath(key: string): string {
    const digest = createHash('sha256').update(key).digest('hex');
    return join(this.keysDir, `${digest}.json`);
  }
}

function isBlogJob(value: unknown): value is BlogJob {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== 'string' ||
    typeof v.requestId !== 'string' ||
    typeof v.status !== 'string' ||
    !JOB_STATUSES.includes(v.status as JobStatus) ||
    typeof v.createdAt !== 'string' ||
    typeof v.updatedAt !== 'string' ||
    typeof v.expiresAt !== 'string'
  ) {
    return false;
  }
  // tombstone(expired)最小化后无 input(§4.2); 其余状态必须带完整输入, 不返回残缺对象
  if (v.status !== 'expired') {
    const input = v.input;
    if (typeof input !== 'object' || input === null) return false;
    const i = input as Record<string, unknown>;
    if (
      typeof i.path !== 'string' ||
      typeof i.originalName !== 'string' ||
      typeof i.mimeType !== 'string' ||
      typeof i.bytes !== 'number' ||
      typeof i.sha256 !== 'string'
    ) {
      return false;
    }
  }
  return true;
}

function isPlaceholder(value: unknown): value is { jobId: string; sha256: string } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.jobId === 'string' && typeof v.sha256 === 'string';
}
