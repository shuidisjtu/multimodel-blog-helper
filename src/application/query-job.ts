/**
 * QueryJob 用例(架构文档 §5):查询任务与摘要。
 * 不存在 → JOB_NOT_FOUND(404); tombstone(expired)→ JOB_EXPIRED(410);
 * failed 任务保留 failure 字段, 保证"失败可查询"。
 * 纯编排: 仓储/时间经端口注入; 未知错误转换为 INTERNAL_ERROR 传播(§6.4/§8.1)。
 */
import { DomainError } from '../domain/errors.js';
import type { BlogJob } from '../domain/job.js';
import type { JobRepository } from '../domain/ports.js';
import type { Clock } from '../shared/clock.js';
import type { Logger } from '../shared/logger.js';

export class QueryJob {
  constructor(
    private readonly deps: {
      jobs: JobRepository;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  /** 不存在 → JOB_NOT_FOUND; tombstone(expired)→ JOB_EXPIRED。 */
  async run(id: string): Promise<BlogJob> {
    try {
      const job = await this.deps.jobs.get(id);
      if (job === null) {
        throw new DomainError('JOB_NOT_FOUND', 'Job not found');
      }
      if (job.status === 'expired') {
        throw new DomainError('JOB_EXPIRED', 'Job has expired');
      }
      return job;
    } catch (err) {
      if (err instanceof DomainError) throw err;
      // 未知错误: 不向客户端泄漏原始报错(§8.1), 仅记录
      this.deps.logger.error({
        event: 'job.query.failed',
        errorCode: 'INTERNAL_ERROR',
        error: err,
      });
      throw new DomainError('INTERNAL_ERROR', 'Internal error');
    }
  }
}
