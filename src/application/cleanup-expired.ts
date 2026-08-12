/**
 * CleanupExpired 用例(架构文档 §4.2/§5): 过期任务清理编排。
 * - 终态(succeeded/failed)过期: 删除输入/输出文件 → tombstone 最小化(只保留 id/requestId/status/createdAt/updatedAt/expiresAt,
 *   清空 input/result/failure/idempotencyKey), 供查询返回 410 JOB_EXPIRED
 * - 非终态(queued/transcribing/summarizing)过期: 跳过(可能正被恢复逻辑或 worker 处理, 不可删文件)
 * - tombstone 二次清理: 超过 tombstoneRetentionDays(默认 30 天)后 remove(元数据与幂等占位, §5: key 随 tombstone 清理)
 * - 单任务异常记录日志继续, 清理不可因单任务失败中断; listExpired 失败(仓储不可用)则向外抛错
 */
import { isTerminal } from '../domain/job.js';
import type { BlogJob } from '../domain/job.js';
import type { FileStore, JobRepository } from '../domain/ports.js';
import type { Clock } from '../shared/clock.js';
import type { Logger } from '../shared/logger.js';

/** tombstone 二次清理期限(架构文档 §4.2 建议 30 天)。 */
const DEFAULT_TOMBSTONE_RETENTION_DAYS = 30;

export interface CleanupResult {
  expiredCount: number; // 本轮从终态转为 tombstone 的任务数
  removedTombstones: number; // 本轮删除的二次清理 tombstone 数
}

export class CleanupExpired {
  constructor(
    private readonly deps: {
      jobs: JobRepository;
      files: FileStore;
      clock: Clock;
      logger: Logger;
      tombstoneRetentionDays?: number; // 二次清理期限, 默认 30(§4.2 建议)
    },
  ) {}

  async run(): Promise<CleanupResult> {
    const now = this.deps.clock.now();
    const retentionDays = this.deps.tombstoneRetentionDays ?? DEFAULT_TOMBSTONE_RETENTION_DAYS;
    const cutoff = subtractDays(now, retentionDays);
    let expiredCount = 0;
    let removedTombstones = 0;
    // 仓储不可用(如磁盘故障)时向外抛错, 让调度方感知(清理是后台任务, 静默失败不可接受)
    const expired = await this.deps.jobs.listExpired(now);
    for (const job of expired) {
      try {
        if (job.status === 'expired') {
          // 已是 tombstone: 二次清理(§4.2: 保留期后移除元数据与幂等占位)
          if (job.updatedAt < cutoff) {
            await this.deps.jobs.remove(job.id);
            removedTombstones++;
          }
          continue;
        }
        if (!isTerminal(job.status)) {
          // 进行中任务可能正被恢复逻辑或 worker 处理, 不可删除其文件(§4.2)
          this.deps.logger.debug({ event: 'cleanup.skip', jobId: job.id, status: job.status, reason: 'in-progress' });
          continue;
        }
        // 终态: 先删文件, 再置 tombstone(update mutator 内以仓储最终状态为准, 竞态下跳过)
        await this.deps.files.deleteJobFiles(job.id);
        const updated = await this.deps.jobs.update(job.id, (j) =>
          isTerminal(j.status) ? tombstoneOf(j) : j,
        );
        // 仅在实际置为 tombstone 时计数(update 竞态跳过时不计数)
        if (updated.status === 'expired') expiredCount++;
      } catch (err) {
        // 单任务失败不中断整体清理(§4.2: 清理幂等且记录数量)
        this.deps.logger.error({ event: 'cleanup.job_failed', jobId: job.id, error: err });
      }
    }
    this.deps.logger.info({ event: 'cleanup.done', expiredCount, removedTombstones });
    return { expiredCount, removedTombstones };
  }
}

/** tombstone 最小化(§4.2): 只保留核心字段, 清空 input/result/failure/idempotencyKey。 */
function tombstoneOf(j: BlogJob): BlogJob {
  return {
    id: j.id,
    requestId: j.requestId,
    status: 'expired',
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    expiresAt: j.expiresAt,
  };
}

/** now 减去 days 天(ISO 8601), 作为 tombstone 二次清理的截止线。 */
function subtractDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) - days * 86_400_000).toISOString();
}
