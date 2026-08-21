/**
 * ProcessJobWorker 测试(架构文档 §6.3): 真实 MemoryJobQueue + fake ProcessJob。
 * 覆盖: 订阅消费 / handler 抛错不影响后续任务 / start 幂等(重复订阅被 MemoryJobQueue 拒绝)。
 */
import { describe, expect, it } from 'vitest';
import type { ProcessJob } from '../../src/application/process-job.js';
import { ProcessJobWorker } from '../../src/application/process-job-worker.js';
import { MemoryJobQueue } from '../../src/infrastructure/queue/memory-job-queue.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

/** 记录型 fake 日志: 每个调用打上 level 便于断言。 */
class FakeLogger implements Logger {
  readonly calls: LogFields[] = [];
  debug(f: LogFields): void {
    this.calls.push({ ...f, level: 'debug' });
  }
  info(f: LogFields): void {
    this.calls.push({ ...f, level: 'info' });
  }
  warn(f: LogFields): void {
    this.calls.push({ ...f, level: 'warn' });
  }
  error(f: LogFields): void {
    this.calls.push({ ...f, level: 'error' });
  }
}

/** 记录调用并可按 jobId 注入错误的 fake ProcessJob。 */
class FakeProcess {
  readonly calls: string[] = [];
  readonly errors = new Set<string>();

  async run(jobId: string): Promise<void> {
    this.calls.push(jobId);
    if (this.errors.has(jobId)) throw new Error(`boom: ${jobId}`);
  }
}

/** 轮询等待条件成立,避免测试依赖精确的微任务时序。 */
async function waitUntil(cond: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timeout');
    await new Promise((r) => setTimeout(r, 1));
  }
}

function setup(queue = new MemoryJobQueue(10, 1)) {
  const process = new FakeProcess();
  const logger = new FakeLogger();
  // ProcessJob 含私有字段, fake 仅结构兼容 run(), 需要双重断言转换
  const worker = new ProcessJobWorker({ queue, process: process as unknown as ProcessJob, logger });
  return { queue, process, logger, worker };
}

describe('ProcessJobWorker(架构文档 §6.3)', () => {
  it('start 后订阅队列并消费任务', async () => {
    const { queue, process, worker } = setup();

    worker.start();
    queue.enqueue('job-1');

    await waitUntil(() => process.calls.length === 1);
    expect(process.calls).toEqual(['job-1']);
  });

  it('handler 抛错(未知错误)不影响后续任务消费, 仅记录日志', async () => {
    const { queue, process, logger, worker } = setup();
    process.errors.add('bad');

    worker.start();
    queue.enqueue('bad');
    queue.enqueue('good');

    await waitUntil(() => process.calls.length === 2);
    expect(process.calls).toEqual(['bad', 'good']); // 队列继续消费
    expect(
      logger.calls.some(
        (c) => c.event === 'worker.handler_error' && c.jobId === 'bad' && c.level === 'error',
      ),
    ).toBe(true);
  });

  it('start 幂等: 重复调用无副作用(不重复订阅, 任务只消费一次)', async () => {
    const { queue, process, worker } = setup();

    worker.start();
    expect(() => worker.start()).not.toThrow(); // 若未幂等, MemoryJobQueue 会拒绝重复 subscribe
    queue.enqueue('job-1');

    await waitUntil(() => process.calls.length === 1);
    expect(process.calls).toEqual(['job-1']);
  });
});
