/**
 * 端口定义:领域层只依赖这些接口,不导入任何 SDK。
 * 实现位于 infrastructure/,可替换(fake / OpenAI / 本地 Whisper / GLM 等)。
 */
import type { BlogJob, JobInput, JobResult } from './job.js';

export interface Transcript {
  text: string;
  /** 转录文本字数(码点数), 由适配器填充; 缺省时为 undefined。 */
  characterCount?: number;
  /** 音频时长(秒), 上游返回时填充; whisper json 格式不返回, 为 undefined。 */
  durationSeconds?: number;
}

export interface Summary {
  text: string;
  /** 摘要生成 token 用量, 上游返回 usage 时填充。 */
  usage?: TokenUsage;
}

/** 一次模型调用的 token 用量(答辩可视化用)。 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface Weather {
  location: string;
  tempC: number;
  description: string;
}

export interface TranscribeParams {
  /** 任务 id: 适配器据此记录重试日志。 */
  jobId: string;
  /** 输入文件绝对路径(由 FileStore 落盘后提供)。 */
  path: string;
  mimeType: string;
}

export interface SummarizeParams {
  jobId: string;
  text: string;
}

export interface Transcriber {
  transcribe(params: TranscribeParams): Promise<Transcript>;
}

export interface Summarizer {
  summarize(params: SummarizeParams): Promise<Summary>;
}

export interface WeatherProvider {
  current(location: string): Promise<Weather>;
}

export interface CreateJobParams {
  requestId: string;
  input: JobInput;
  expiresAt: string;
  idempotencyKey?: string;
  /** 用例层预生成 jobId(对齐文件目录与任务 id);缺省由实现生成。 */
  id?: string;
}

export type CreateOrGetOutcome =
  | { outcome: 'created'; job: BlogJob }
  | { outcome: 'replayed'; job: BlogJob }
  | { outcome: 'conflict'; job: BlogJob };

export interface JobRepository {
  /** 无幂等 key 时的普通创建。 */
  create(params: CreateJobParams): Promise<BlogJob>;
  /**
   * 幂等创建:以 O_EXCL 原子占位互斥,
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
  /** 启动恢复:返回进行中任务(transcribing/summarizing),用于标记 PROCESS_INTERRUPTED。 */
  listInProgress(): Promise<BlogJob[]>;
  /** 删除任务元数据文件(含幂等占位),供 tombstone 二次清理;不存在则静默成功。 */
  remove(id: string): Promise<void>;
}

export interface SaveInputParams {
  jobId: string;
  /** 仅存元数据(展示用); 存储名由 extension 决定, 用户文件名不参与路径。 */
  originalName: string;
  mimeType: string;
  /** 服务端受信扩展名(由 domain 校验器按 MIME 推断, 存储名由服务生成)。 */
  extension: string;
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

/** 时长探测端口: 落盘后解析音频时长; 解析失败返回 null(降级, 调用方视为"未校验"放行, 不得误杀)。 */
export interface AudioDurationProbe {
  probe(filePath: string): Promise<number | null>;
}

/** 内存任务队列: 有界; 同步入队使容量检查与入队原子(单线程下无异步插入点)。 */
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

/** 单任务成功后的模型调用用量指标(JSONL 落盘, 用于答辩可视化)。 */
export interface UsageMetric {
  jobId: string;
  /** 完成时刻(ISO 8601)。 */
  completedAt: string;
  transcribeModel: string;
  transcribeCharacterCount?: number;
  transcribeDurationSeconds?: number;
  transcribeDurationMs: number;
  summaryModel: string;
  summaryInputTokens?: number;
  summaryOutputTokens?: number;
  summaryDurationMs: number;
  /** 端到端总耗时(queued→succeeded), 毫秒。 */
  totalDurationMs: number;
}

/** 指标落盘端口: 追加一条用量记录; 失败不应影响主流程。 */
export interface MetricsRecorder {
  record(metric: UsageMetric): Promise<void>;
}
