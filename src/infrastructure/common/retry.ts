/**
 * withRetry: 可恢复错误的指数退避重试(架构文档 §6)。
 * 语义: 仅对 isRetryable 判定的错误重试; 达到 maxAttempts 或不可重试错误立即抛出(不吞错、不改写类型);
 * 重试耗尽抛最后一次错误。退避: 基值 1000ms 翻倍 + 可选抖动; sleep/jitterMs 可注入以便测试。
 */
import type { Logger } from '../../shared/logger.js';

export interface WithRetryOptions {
  /** 总尝试次数(第 1 次 + 最多 maxAttempts-1 次重试)。 */
  maxAttempts: number;
  /** 判定错误是否可重试(由调用方按其依赖的错误类型实现)。 */
  isRetryable: (err: unknown) => boolean;
  /** 等待注入(默认 setTimeout promise); 测试可传 fake 断言退避序列。 */
  sleep?: (ms: number) => Promise<void>;
  /** 抖动上限(毫秒), 默认 100; 测试传 0 获得确定性退避。 */
  jitterMs?: number;
  logger?: Logger;
  /** 附加到重试日志的结构化字段(如 { jobId }); 敏感键会被 logger 脱敏。 */
  context?: Record<string, unknown>;
}

export interface RetryResult<T> {
  value: T;
  /** 实际重试次数(0 = 首次即成功)。 */
  retryCount: number;
}

const BASE_DELAY_MS = 1000;

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: WithRetryOptions,
): Promise<RetryResult<T>> {
  const {
    maxAttempts,
    isRetryable,
    sleep = defaultSleep,
    jitterMs = 100,
    logger,
    context = {},
  } = opts;
  let retryCount = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      return { value: await fn(), retryCount };
    } catch (err) {
      const last = attempt >= maxAttempts;
      if (last || !isRetryable(err)) throw err;
      retryCount++;
      logger?.warn({
        event: 'upstream.retry',
        attempt,
        errorName: err instanceof Error ? err.name : typeof err,
        ...context,
      });
      const delay =
        BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * jitterMs);
      await sleep(delay);
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
