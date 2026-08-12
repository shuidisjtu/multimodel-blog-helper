/**
 * SubmitAudio 用例(架构文档 §5/§6.1-§6.2):受理上传并创建 queued 任务。
 * - 队列预检: 容量满直接 QUEUE_FULL, 不落盘任何数据(§6.2)
 * - 幂等: createOrGetByIdempotencyKey 三态, replayed/conflict 落败者清理本次上传文件(§5)
 * - 创建回滚: 输入落盘后 create/createOrGet 异常同样清理输入文件, 不留孤儿目录(§6.2)
 * - 入队回滚: 持久化后入队异常删除 Job 记录与输入文件(§6.2)
 * 纯编排: 文件系统/外部 API 全部经端口注入; 未知错误转换为 INTERNAL_ERROR 传播(§6.4/§8.1)。
 */
import { DomainError } from '../domain/errors.js';
import type { BlogJob } from '../domain/job.js';
import type { CreateJobParams, FileStore, JobQueue, JobRepository } from '../domain/ports.js';
import type { Clock } from '../shared/clock.js';
import type { IdGenerator } from '../shared/ids.js';
import type { Logger } from '../shared/logger.js';

export interface SubmitAudioParams {
  requestId: string;
  originalName: string;
  mimeType: string;
  bytes: Buffer;
  idempotencyKey?: string;
}

export type SubmitAudioOutcome =
  | { outcome: 'created' | 'replayed' | 'conflict'; job: BlogJob };

export class SubmitAudio {
  constructor(
    private readonly deps: {
      jobs: JobRepository;
      files: FileStore;
      queue: JobQueue;
      clock: Clock;
      ids: IdGenerator;
      logger: Logger;
      jobTtlHours: number;
      /** 与队列实例的 maxLength 一致; 预检用 size 判断, 真满员由 enqueue 兜底(§6.2)。 */
      queueMaxLength: number;
    },
  ) {}

  async run(params: SubmitAudioParams): Promise<SubmitAudioOutcome> {
    try {
      return await this.createJob(params);
    } catch (err) {
      if (err instanceof DomainError) throw err;
      // 未知错误: 不向客户端泄漏原始报错(§8.1), 仅记录
      this.deps.logger.error({ event: 'job.submit.failed', errorCode: 'INTERNAL_ERROR', error: err });
      throw new DomainError('INTERNAL_ERROR', 'Internal error');
    }
  }

  private async createJob(params: SubmitAudioParams): Promise<SubmitAudioOutcome> {
    // 1. 队列预检(同步): 容量满根本不写 Job, 磁盘不残留可恢复任务(§6.2)
    if (this.deps.queue.size() >= this.deps.queueMaxLength) {
      throw new DomainError('QUEUE_FULL', 'Queue is full, retry later');
    }
    // 2. jobId 唯一生成点: 任务 id 与文件目录一致
    const jobId = this.deps.ids.nextId();
    // 3. 过期时间 = now + jobTtlHours 小时(ISO 8601)
    const nowMs = Date.parse(this.deps.clock.now());
    const expiresAt = new Date(nowMs + this.deps.jobTtlHours * 3_600_000).toISOString();
    // 4. 输入落盘
    const { path, sha256 } = await this.deps.files.saveInput({
      jobId,
      originalName: params.originalName,
      mimeType: params.mimeType,
      bytes: params.bytes,
    });
    const createParams: CreateJobParams = {
      requestId: params.requestId,
      input: {
        path,
        originalName: params.originalName,
        mimeType: params.mimeType,
        bytes: params.bytes.length,
        sha256,
      },
      expiresAt,
      id: jobId,
    };
    // 5. 创建任务: 有幂等 key 走三态创建, 无 key 走普通创建
    let job: BlogJob;
    try {
      if (params.idempotencyKey !== undefined) {
        const outcome = await this.deps.jobs.createOrGetByIdempotencyKey({
          ...createParams,
          idempotencyKey: params.idempotencyKey,
        });
        if (outcome.outcome !== 'created') {
          // 落败者清理其本次上传的临时文件, 不再入队(§5)
          await this.deps.files.deleteJobFiles(jobId);
          return { outcome: outcome.outcome, job: outcome.job };
        }
        job = outcome.job;
      } else {
        job = await this.deps.jobs.create(createParams);
      }
    } catch (err) {
      // 创建失败: 清理本次已上传文件后重抛原始错误(§6.2); 清理失败不掩盖原始错误, 仅记录
      await this.deps.files.deleteJobFiles(jobId).catch((cleanupErr) => {
        this.deps.logger.error({ event: 'job.submit.cleanup_failed', jobId, error: cleanupErr });
      });
      throw err;
    }
    // 6. 入队(同步临界区); 异常回滚刚创建的 Job 记录与输入文件(§6.2)
    try {
      this.deps.queue.enqueue(job.id);
    } catch (err) {
      await this.deps.jobs.remove(job.id);
      await this.deps.files.deleteJobFiles(jobId);
      throw err;
    }
    this.deps.logger.info({ event: 'job.enqueued', jobId, requestId: params.requestId });
    return { outcome: 'created', job };
  }
}
