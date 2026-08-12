/**
 * ProcessJobWorker(架构文档 §6.3): 订阅任务队列并消费的 worker。
 * - 并发度由队列实例自身控制(workerConcurrency), 本类不做二次限制
 * - ProcessJob.run 契约不向外抛错(Task 3), 但 handler 仍兜底 try/catch, 未知错误仅记录, 不中断队列循环
 * - start 幂等: 重复调用无副作用(队列只允许一次订阅)
 */
import type { JobQueue } from '../domain/ports.js';
import type { ProcessJob } from './process-job.js';
import type { Logger } from '../shared/logger.js';

export class ProcessJobWorker {
  private started = false;

  constructor(
    private readonly deps: {
      queue: JobQueue;
      process: ProcessJob;
      logger: Logger;
    },
  ) {}

  /** 订阅队列并启动消费; 幂等(重复调用无副作用)。 */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.deps.queue.subscribe((jobId) => this.handle(jobId));
  }

  /** 单任务兜底: 正常路径 ProcessJob.run 不抛错, 此处仅防御未知异常(不中断队列消费)。 */
  private async handle(jobId: string): Promise<void> {
    try {
      await this.deps.process.run(jobId);
    } catch (err) {
      this.deps.logger.error({ event: 'worker.handler_error', jobId, error: err });
    }
  }
}
