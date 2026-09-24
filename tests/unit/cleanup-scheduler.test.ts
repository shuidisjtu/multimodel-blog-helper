/**
 * cleanup-scheduler 单元测试: fake timers。
 * 覆盖: 周期触发 / 单次抛错后继续(记录日志不崩溃) / stop 后不再触发。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CleanupExpired } from '../../src/application/cleanup-expired.js';
import { startCleanupScheduler } from '../../src/bootstrap/cleanup-scheduler.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

/** fake cleanup: 记录 run 调用次数, 可编程抛错。 */
class FakeCleanup {
  runCalls = 0;
  error: unknown = null;

  async run(): Promise<{ expiredCount: number; removedTombstones: number }> {
    this.runCalls++;
    if (this.error !== null) throw this.error;
    return { expiredCount: 0, removedTombstones: 0 };
  }
}

/** 记录型 fake 日志: 只关心 error。 */
class FakeLogger implements Logger {
  readonly errors: LogFields[] = [];
  debug(_f: LogFields): void {}
  info(_f: LogFields): void {}
  warn(_f: LogFields): void {}
  error(f: LogFields): void {
    this.errors.push(f);
  }
}

describe('startCleanupScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('周期触发 run', async () => {
    vi.useFakeTimers();
    const cleanup = new FakeCleanup();
    const scheduler = startCleanupScheduler(cleanup as unknown as CleanupExpired, {
      intervalMs: 1000,
      logger: new FakeLogger(),
    });

    expect(cleanup.runCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(cleanup.runCalls).toBe(3);

    scheduler.stop();
  });

  it('单次抛错后继续, 记录日志不崩溃', async () => {
    vi.useFakeTimers();
    const cleanup = new FakeCleanup();
    cleanup.error = new Error('boom');
    const logger = new FakeLogger();
    const scheduler = startCleanupScheduler(cleanup as unknown as CleanupExpired, {
      intervalMs: 1000,
      logger,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(cleanup.runCalls).toBe(1);
    expect(logger.errors.some((e) => e.event === 'cleanup.scheduler_failed')).toBe(true);

    // 恢复后继续触发
    cleanup.error = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect(cleanup.runCalls).toBe(2);

    scheduler.stop();
  });

  it('stop 后不再触发', async () => {
    vi.useFakeTimers();
    const cleanup = new FakeCleanup();
    const scheduler = startCleanupScheduler(cleanup as unknown as CleanupExpired, {
      intervalMs: 1000,
      logger: new FakeLogger(),
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(cleanup.runCalls).toBe(1);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(cleanup.runCalls).toBe(1);
  });
});
