/**
 * MemoryJobQueue:有界 FIFO 内存任务队列(架构文档 §6 流程 2/3)。
 * - 同步入队: 容量检查与入队在同一同步临界区, 满则 QUEUE_FULL(容量满时根本不写 Job, 磁盘不残留可恢复任务)。
 * - drain 消费循环: 并发受 workerConcurrency 限制; 单个 handler 失败只经 finally 回收槽位, 不阻塞其他任务。
 * - 错误不在此吞掉也不扩散: 由订阅方(worker 层)负责处理。
 */
import type { JobQueue } from '../../domain/ports.js';
import { DomainError } from '../../domain/errors.js';

export class MemoryJobQueue implements JobQueue {
  private readonly pending: string[] = [];
  private readonly maxLength: number;
  private readonly workerConcurrency: number;
  private processingCount = 0;
  private handler: ((jobId: string) => Promise<void>) | null = null;

  constructor(maxLength: number, workerConcurrency: number) {
    this.maxLength = maxLength;
    this.workerConcurrency = workerConcurrency;
  }

  enqueue(jobId: string): void {
    if (this.pending.length + this.processingCount >= this.maxLength) {
      throw new DomainError('QUEUE_FULL', 'Queue is full');
    }
    this.pending.push(jobId);
    this.drain();
  }

  subscribe(handler: (jobId: string) => Promise<void>): void {
    if (this.handler !== null) {
      throw new DomainError('INTERNAL_ERROR', 'Handler already subscribed');
    }
    this.handler = handler;
    this.drain();
  }

  size(): number {
    return this.pending.length;
  }

  /** 消费循环: 并发有空位且 pending 非空时 FIFO 取出并调度 handler。 */
  private drain(): void {
    if (this.handler === null) return;
    while (this.processingCount < this.workerConcurrency && this.pending.length > 0) {
      const jobId = this.pending.shift()!;
      this.processingCount++;
      const task = this.handler(jobId).finally(() => {
        this.processingCount--;
        this.drain();
      });
      // 不吞也不扩散: 业务错误由订阅方(worker 层)处理并落库; 这里仅兜底打印,
      // 防止 handler 未捕获的拒绝触发 unhandledRejection 使进程退出(Node 默认 throw)
      task.catch((err) => {
        console.error('job handler rejected:', err);
      });
    }
  }
}
