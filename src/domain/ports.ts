/**
 * 端口定义(架构文档 §7.1):领域层只依赖这些接口,不导入任何 SDK。
 * 实现位于 infrastructure/,可替换(fake / OpenAI / 本地 Whisper / GLM 等)。
 */
import type { BlogJob, JobInput, JobResult } from './job.js';

export interface Transcript {
  text: string;
}

export interface Summary {
  text: string;
}

export interface Weather {
  location: string;
  tempC: number;
  description: string;
}

export interface TranscribeParams {
  /** 输入文件绝对路径(由 FileStore 落盘后提供)。 */
  path: string;
  mimeType: string;
}

export interface Transcriber {
  transcribe(params: TranscribeParams): Promise<Transcript>;
}

export interface Summarizer {
  summarize(text: string): Promise<Summary>;
}

export interface WeatherProvider {
  current(location: string): Promise<Weather>;
}

export interface CreateJobParams {
  requestId: string;
  input: JobInput;
  expiresAt: string;
  idempotencyKey?: string;
}

export type CreateOrGetOutcome =
  | { outcome: 'created'; job: BlogJob }
  | { outcome: 'replayed'; job: BlogJob }
  | { outcome: 'conflict'; job: BlogJob };

export interface JobRepository {
  /** 无幂等 key 时的普通创建。 */
  create(params: CreateJobParams): Promise<BlogJob>;
  /**
   * 幂等创建(架构文档 §5):以 O_EXCL 原子占位互斥,
   * created=新任务;replayed=同 key 同 sha256 返回既有;conflict=同 key 不同文件。
   */
  createOrGetByIdempotencyKey(params: CreateJobParams): Promise<CreateOrGetOutcome>;
  get(id: string): Promise<BlogJob | null>;
  /** 读-改-写;由实现保证原子性(文件仓储:临时文件 + rename)。 */
  update(id: string, mutator: (job: BlogJob) => BlogJob): Promise<BlogJob>;
  /** 启动恢复:返回 queued 任务(重入队)。 */
  listRecoverable(): Promise<BlogJob[]>;
  /** 清理:返回 expiresAt 已过的任务(输入/输出文件由 FileStore 删除,元数据留 tombstone)。 */
  listExpired(now: string): Promise<BlogJob[]>;
}

export interface SaveInputParams {
  jobId: string;
  originalName: string;
  mimeType: string;
  bytes: Buffer;
}

export interface SaveOutputParams {
  jobId: string;
  kind: 'transcript' | 'summary';
  content: string;
}

export interface FileStore {
  saveInput(params: SaveInputParams): Promise<{ path: string; sha256: string }>;
  saveOutput(params: SaveOutputParams): Promise<{ path: string }>;
  read(path: string): Promise<Buffer>;
  /** 删除过期任务的输入/输出目录;返回删除数。 */
  deleteJobFiles(jobId: string): Promise<number>;
}

/** 内存任务队列(架构文档 §6.2): 有界; 同步入队使容量检查与入队原子(单线程下无异步插入点)。 */
export interface JobQueue {
  /** 同步入队; 队列满(pending+processing >= maxLength)抛 DomainError('QUEUE_FULL', ...)。 */
  enqueue(jobId: string): void;
  /** 订阅消费处理器; handler 并发受 workerConcurrency 限制。 */
  subscribe(handler: (jobId: string) => Promise<void>): void;
  /** 当前排队中的任务数(不含处理中)。 */
  size(): number;
}

/** 用例层的 Job 查询结果聚合(避免领域层依赖 HTTP DTO)。 */
export type { JobResult };
