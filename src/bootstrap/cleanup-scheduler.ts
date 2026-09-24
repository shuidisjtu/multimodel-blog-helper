/**
 * 过期清理周期调度器(bootstrap 职责)。
 * - 周期执行 CleanupExpired.run; 单次异常仅记录日志(清理是后台任务, 失败不中断进程)
 * - 首次执行不在本调度器内, 由 server.ts 在启动序列中显式 await(让仓储不可用等致命错误在启动期暴露)
 * - timer.unref(): 后台定时器不阻塞进程退出
 */
import type { CleanupExpired } from '../application/cleanup-expired.js';
import type { Logger } from '../shared/logger.js';

export interface CleanupScheduler {
  stop(): void;
}

export function startCleanupScheduler(
  cleanup: CleanupExpired,
  deps: { intervalMs: number; logger: Logger },
): CleanupScheduler {
  const timer = setInterval(() => {
    void runSafely(cleanup, deps.logger);
  }, deps.intervalMs);
  timer.unref();
  return {
    stop: () => clearInterval(timer),
  };
}

/** 周期执行的兜底: cleanup.run 正常不抛错(listExpired 抛错除外), 此处防御未知异常不中断定时器。 */
async function runSafely(cleanup: CleanupExpired, logger: Logger): Promise<void> {
  try {
    await cleanup.run();
  } catch (err) {
    logger.error({ event: 'cleanup.scheduler_failed', error: err });
  }
}
