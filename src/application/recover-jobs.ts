/**
 * RecoverJobs 用例(架构文档 §4.2 启动恢复): 服务启动时恢复未完成任务。
 * - queued 任务逐个重新入队; 队列满(QUEUE_FULL)记录 warn 并跳过(任务保持 queued, 下次恢复仍可处理)
 * - transcribing/summarizing 标记 failed: PROCESS_INTERRUPTED, 不自动重试(避免不确定的重复转录计费)
 * - 单任务异常仅记录日志继续; 列表查询失败(仓储不可用)则向外抛错, 让启动失败可感知
 * 纯编排: 仓储/队列/时间经端口注入, 不导入任何基础设施。
 */
import { DomainError } from '../domain/errors.js';
import type { JobQueue, JobRepository } from '../domain/ports.js';
import type { Clock } from '../shared/clock.js';
import type { Logger } from '../shared/logger.js';

export class RecoverJobs {
  constructor(
    private readonly deps: {
      jobs: JobRepository;
      queue: JobQueue;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  /** 返回处理的任务计数(重入队 + 标记中断)。 */
  async run(): Promise<{ requeued: number; interrupted: number }> {
    let requeued = 0;
    let interrupted = 0;
    // 1. queued 任务重新入队(§4.2): 队列满跳过不抛错, 任务保持 queued 等待下次恢复
    for (const job of await this.deps.jobs.listRecoverable()) {
      try {
        this.deps.queue.enqueue(job.id);
        requeued++;
        this.deps.logger.info({ event: 'job.requeued', jobId: job.id });
      } catch (err) {
        if (err instanceof DomainError && err.code === 'QUEUE_FULL') {
          this.deps.logger.warn({ event: 'recovery.queue_full', jobId: job.id });
          continue;
        }
        this.deps.logger.error({ event: 'recovery.requeue_failed', jobId: job.id, error: err });
      }
    }
    // 2. 进行中任务标记 PROCESS_INTERRUPTED, 不重试(§4.2: 避免不确定的重复转录计费)
    for (const job of await this.deps.jobs.listInProgress()) {
      try {
        await this.deps.jobs.update(job.id, (j) => ({
          ...j,
          status: 'failed',
          failure: { code: 'PROCESS_INTERRUPTED', safeMessage: 'Processing interrupted by restart' },
        }));
        interrupted++;
        this.deps.logger.error({ event: 'job.interrupted', jobId: job.id, errorCode: 'PROCESS_INTERRUPTED' });
      } catch (err) {
        this.deps.logger.error({ event: 'recovery.interrupt_failed', jobId: job.id, error: err });
      }
    }
    return { requeued, interrupted };
  }
}
