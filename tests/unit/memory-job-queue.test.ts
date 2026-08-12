import { describe, expect, it, vi } from 'vitest';
import { MemoryJobQueue } from '../../src/infrastructure/queue/memory-job-queue.js';
import { DomainError } from '../../src/domain/errors.js';

/** resolve 时机可控的 Promise(用于验证并发上限与消费顺序)。 */
interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 轮询等待条件成立,避免测试依赖精确的微任务时序。 */
async function waitUntil(cond: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timeout');
    await new Promise((r) => setTimeout(r, 1));
  }
}

describe('MemoryJobQueue(架构文档 §6 流程 2/3)', () => {
  it('FIFO:按入队顺序消费', async () => {
    const queue = new MemoryJobQueue(10, 1);
    const consumed: string[] = [];
    const done = deferred<void>();
    queue.subscribe(async (jobId) => {
      consumed.push(jobId);
      if (consumed.length === 3) done.resolve();
    });
    queue.enqueue('a');
    queue.enqueue('b');
    queue.enqueue('c');
    await done.promise;
    expect(consumed).toEqual(['a', 'b', 'c']);
  });

  it('满员:pending+processing 达 maxLength 后 enqueue 抛 DomainError(QUEUE_FULL)', async () => {
    const queue = new MemoryJobQueue(2, 1);
    const gate = deferred<void>();
    queue.subscribe(async () => gate.promise); // 占用唯一 worker
    queue.enqueue('a'); // processing=1
    queue.enqueue('b'); // pending=1
    expect(() => queue.enqueue('c')).toThrowError(DomainError);
    let thrown: unknown;
    try {
      queue.enqueue('d');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('QUEUE_FULL');
    expect((thrown as DomainError).message).toBe('Queue is full');
    gate.resolve();
    await waitUntil(() => queue.size() === 0);
  });

  it('并发限制:处理中任务数不超过 workerConcurrency', async () => {
    const queue = new MemoryJobQueue(10, 2);
    const gates: Deferred[] = [];
    let active = 0;
    let maxActive = 0;
    const secondStarted = deferred<void>();
    queue.subscribe(async () => {
      const gate = deferred<void>();
      gates.push(gate);
      active++;
      maxActive = Math.max(maxActive, active);
      if (active === 2) secondStarted.resolve();
      await gate.promise;
      active--;
    });
    queue.enqueue('a');
    queue.enqueue('b');
    queue.enqueue('c');
    await secondStarted.promise;
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(queue.size()).toBe(1); // 'c' 仍在排队
    gates[0]!.resolve();
    await waitUntil(() => gates.length === 3); // 'c' 开始处理
    expect(queue.size()).toBe(0);
    expect(maxActive).toBeLessThanOrEqual(2);
    gates[1]!.resolve();
    gates[2]!.resolve();
    await waitUntil(() => active === 0);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('subscribe 之前的入队任务在 subscribe 后立即开始消费', async () => {
    const queue = new MemoryJobQueue(10, 1);
    queue.enqueue('a');
    queue.enqueue('b');
    expect(queue.size()).toBe(2);
    const consumed: string[] = [];
    const done = deferred<void>();
    queue.subscribe(async (jobId) => {
      consumed.push(jobId);
      if (consumed.length === 2) done.resolve();
    });
    await done.promise;
    expect(consumed).toEqual(['a', 'b']);
    expect(queue.size()).toBe(0);
  });

  it('handler 抛错不影响后续任务消费,错误被打印而非静默吞掉', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const queue = new MemoryJobQueue(10, 1);
    const consumed: string[] = [];
    const done = deferred<void>();
    queue.subscribe(async (jobId) => {
      consumed.push(jobId);
      if (jobId === 'bad') throw new Error('boom');
      done.resolve();
    });
    queue.enqueue('bad');
    queue.enqueue('good');
    await done.promise;
    // 等一个宏任务: 兜底打印挂在 finally 结果的 catch 上, 其微任务晚于 done.resolve()
    await new Promise((r) => setTimeout(r, 0));
    expect(consumed).toEqual(['bad', 'good']);
    // 不吞: 拒绝被兜底打印, 而非 unhandledRejection
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![1]).toBeInstanceOf(Error);
    errorSpy.mockRestore();
  });

  it('重复 subscribe 抛 DomainError(INTERNAL_ERROR)', () => {
    const queue = new MemoryJobQueue(10, 1);
    queue.subscribe(async () => {});
    let thrown: unknown;
    try {
      queue.subscribe(async () => {});
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe('INTERNAL_ERROR');
  });

  it('workerConcurrency > maxLength 时全部任务正常消费,无死锁', async () => {
    const queue = new MemoryJobQueue(2, 5);
    const consumed: string[] = [];
    const done = deferred<void>();
    queue.subscribe(async (jobId) => {
      consumed.push(jobId);
      if (consumed.length === 2) done.resolve();
    });
    queue.enqueue('a');
    queue.enqueue('b');
    expect(() => queue.enqueue('c')).toThrowError(DomainError);
    await done.promise;
    expect(consumed).toEqual(['a', 'b']);
  });
});
