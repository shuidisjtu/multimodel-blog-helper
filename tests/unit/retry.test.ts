import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../../src/infrastructure/common/retry.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

class FakeLogger implements Logger {
  readonly calls: LogFields[] = [];
  debug(f: LogFields): void { this.calls.push({ ...f, level: 'debug' }); }
  info(f: LogFields): void { this.calls.push({ ...f, level: 'info' }); }
  warn(f: LogFields): void { this.calls.push({ ...f, level: 'warn' }); }
  error(f: LogFields): void { this.calls.push({ ...f, level: 'error' }); }
}

/** 构造带 status 的 fake 错误(与 APIError 结构兼容)。 */
function statusError(status: number): Error {
  const err = new Error(`upstream ${status}`);
  Object.defineProperty(err, 'status', { value: status });
  return err;
}

/** 仅 429 可重试的判定器。 */
const isRetryable = (err: unknown): boolean =>
  err instanceof Error && (err as { status?: number }).status === 429;

describe('withRetry(架构文档 §6)', () => {
  function setup() {
    const sleep = vi.fn(async (_ms: number) => undefined);
    const logger = new FakeLogger();
    return { sleep, logger };
  }

  it('首次成功: 不重试, retryCount=0, sleep 不调用', async () => {
    const { sleep, logger } = setup();
    const fn = vi.fn().mockResolvedValue('ok');

    const { value, retryCount } = await withRetry(fn, {
      maxAttempts: 3,
      isRetryable,
      sleep,
      jitterMs: 0,
      logger,
      context: { jobId: 'job-1' },
    });

    expect(value).toBe('ok');
    expect(retryCount).toBe(0);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(logger.calls.some((c) => c.event === 'upstream.retry')).toBe(false);
  });

  it('429 后成功: 重试 1 次, 退避 1s, warn 日志含 jobId/attempt/errorName', async () => {
    const { sleep, logger } = setup();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(statusError(429))
      .mockResolvedValueOnce('ok');

    const { value, retryCount } = await withRetry(fn, {
      maxAttempts: 3,
      isRetryable,
      sleep,
      jitterMs: 0,
      logger,
      context: { jobId: 'job-1' },
    });

    expect(value).toBe('ok');
    expect(retryCount).toBe(1);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]![0]).toBe(1000);
    const warn = logger.calls.find((c) => c.event === 'upstream.retry')!;
    expect(warn).toMatchObject({ level: 'warn', attempt: 1, errorName: 'Error', jobId: 'job-1' });
  });

  it('429×2 后成功: 重试 2 次, 退避 1s/2s 递增', async () => {
    const { sleep } = setup();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(statusError(429))
      .mockRejectedValueOnce(statusError(429))
      .mockResolvedValueOnce('ok');

    const { retryCount } = await withRetry(fn, {
      maxAttempts: 3,
      isRetryable,
      sleep,
      jitterMs: 0,
    });

    expect(retryCount).toBe(2);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it('429×3 全败(maxAttempts=3): 正好 3 次尝试, 抛最后一次错误, 不吞错', async () => {
    const { sleep, logger } = setup();
    const last = statusError(429);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(statusError(429))
      .mockRejectedValueOnce(statusError(429))
      .mockRejectedValueOnce(last);

    await expect(
      withRetry(fn, { maxAttempts: 3, isRetryable, sleep, jitterMs: 0, logger }),
    ).rejects.toBe(last);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // 最后一次失败不再等待
    expect(logger.calls.filter((c) => c.event === 'upstream.retry')).toHaveLength(2);
  });

  it('4xx(不可重试): 立即抛, 不重试不等待', async () => {
    const { sleep, logger } = setup();
    const badRequest = statusError(400);
    const fn = vi.fn().mockRejectedValueOnce(badRequest);

    await expect(
      withRetry(fn, { maxAttempts: 3, isRetryable, sleep, jitterMs: 0, logger }),
    ).rejects.toBe(badRequest);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(logger.calls.some((c) => c.event === 'upstream.retry')).toBe(false);
  });

  it('maxAttempts=1 时不重试(配置 0 重试场景)', async () => {
    const { sleep } = setup();
    const fn = vi.fn().mockRejectedValueOnce(statusError(429));

    await expect(
      withRetry(fn, { maxAttempts: 1, isRetryable, sleep, jitterMs: 0 }),
    ).rejects.toThrow('upstream 429');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
