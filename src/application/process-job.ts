/**
 * ProcessJob 用例:推进单个任务的状态机直至完成。
 * 迁移顺序: queued→transcribing→summarizing→succeeded; 每一步以 assertCanTransition 校验
 * 并持久化; 任一处理错误转 failed(保留安全错误码), 本方法不向外抛错(worker 不需要 catch)。
 */
import { DomainError } from '../domain/errors.js';
import type { JobFailure, JobStatus } from '../domain/job.js';
import { assertCanTransition, isTerminal } from '../domain/job.js';
import type {
  FileStore,
  JobRepository,
  MetricsRecorder,
  Summarizer,
  Summary,
  Transcriber,
  Transcript,
  UsageMetric,
} from '../domain/ports.js';
import type { LogFields, Logger } from '../shared/logger.js';
import { formatTimestampedTranscript } from './transcript-text.js';

export class ProcessJob {
  constructor(
    private readonly deps: {
      jobs: JobRepository;
      files: FileStore;
      transcriber: Transcriber;
      summarizer: Summarizer;
      metrics: MetricsRecorder;
      logger: Logger;
      transcribeModel: string;
      summaryModel: string;
    },
  ) {}

  /** 处理一个任务; 本方法不抛错(内部错误转 failed 并记录)。 */
  async run(jobId: string): Promise<void> {
    const job = await this.deps.jobs.get(jobId);
    if (job === null) {
      this.deps.logger.warn({ event: 'job.missing', jobId });
      return;
    }
    if (isTerminal(job.status)) {
      // 终态保护: 不重复处理
      this.deps.logger.warn({
        event: 'job.skipped',
        jobId,
        status: job.status,
        reason: 'terminal',
      });
      return;
    }
    const input = job.input;
    if (input === undefined) {
      // tombstone 最小化后无 input; 非终态任务在仓储校验下必有 input, 此处仅防御端口违约
      this.deps.logger.warn({
        event: 'job.skipped',
        jobId,
        status: job.status,
        reason: 'missing-input',
      });
      return;
    }
    try {
      const totalStarted = Date.now();
      await this.transition(jobId, 'queued', 'transcribing');
      const { transcript, durationMs: transcribeDurationMs } = await this.transcribe(
        jobId,
        input.path,
        input.mimeType,
      );
      await this.transition(jobId, 'transcribing', 'summarizing');
      const summarizeStarted = Date.now();
      const summary = await this.deps.summarizer.summarize({ jobId, text: transcript.text });
      const summaryDurationMs = Date.now() - summarizeStarted;
      this.deps.logger.info({
        event: 'job.summarized',
        jobId,
        durationMs: summaryDurationMs,
        model: this.deps.summaryModel,
      });
      // 中间产物落盘(转录 + 可选的时间戳转录 + 摘要)
      const transcriptOut = await this.deps.files.saveOutput({
        jobId,
        kind: 'transcript',
        content: transcript.text,
      });
      // 仅在确有时间戳时产出该文件: 上游未返回词级数据时不得落空文件冒充"已支持"
      const segments = transcript.segments;
      const timedOut =
        segments === undefined || segments.length === 0
          ? null
          : await this.deps.files.saveOutput({
              jobId,
              kind: 'transcript-timed',
              content: formatTimestampedTranscript(segments),
            });
      await this.deps.files.saveOutput({
        jobId,
        kind: 'summary',
        content: summary.text,
      });
      await this.deps.jobs.update(jobId, (j) => ({
        ...j,
        status: 'succeeded',
        result: {
          transcriptPath: transcriptOut.path,
          ...(timedOut !== null ? { timedTranscriptPath: timedOut.path } : {}),
          summary: summary.text,
          model: this.deps.transcribeModel,
        },
      }));
      this.deps.logger.info({ event: 'job.status', jobId, from: 'summarizing', to: 'succeeded' });
      await this.recordMetric(
        jobId,
        transcript,
        transcribeDurationMs,
        summary,
        summaryDurationMs,
        totalStarted,
      );
    } catch (err) {
      await this.markFailed(jobId, err);
    }
  }

  /** 读-改-写迁移(assertCanTransition 以仓储当前状态为准)并记录迁移日志。 */
  private async transition(jobId: string, from: JobStatus, to: JobStatus): Promise<void> {
    await this.deps.jobs.update(jobId, (j) => {
      assertCanTransition(j.status, to);
      return { ...j, status: to };
    });
    this.deps.logger.info({ event: 'job.status', jobId, from, to });
  }

  /** 转录并记录模型与耗时(转录请求携带 jobId 并记录模型/耗时)。 */
  private async transcribe(
    jobId: string,
    path: string,
    mimeType: string,
  ): Promise<{ transcript: Transcript; durationMs: number }> {
    const started = Date.now();
    const transcript = await this.deps.transcriber.transcribe({ jobId, path, mimeType });
    const durationMs = Date.now() - started;
    this.deps.logger.info({
      event: 'job.transcribed',
      jobId,
      durationMs,
      model: this.deps.transcribeModel,
    });
    return { transcript, durationMs };
  }

  /** 成功后落盘用量指标; 落盘失败仅记日志(指标不影响主流程)。 */
  private async recordMetric(
    jobId: string,
    transcript: Transcript,
    transcribeDurationMs: number,
    summary: Summary,
    summaryDurationMs: number,
    totalStarted: number,
  ): Promise<void> {
    const metric: UsageMetric = {
      jobId,
      completedAt: new Date().toISOString(),
      transcribeModel: this.deps.transcribeModel,
      transcribeCharacterCount: transcript.characterCount,
      transcribeDurationSeconds: transcript.durationSeconds,
      transcribeDurationMs,
      summaryModel: this.deps.summaryModel,
      summaryInputTokens: summary.usage?.inputTokens,
      summaryOutputTokens: summary.usage?.outputTokens,
      summaryDurationMs,
      totalDurationMs: Date.now() - totalStarted,
    };
    try {
      await this.deps.metrics.record(metric);
    } catch (err) {
      this.deps.logger.warn({ event: 'metrics.record_failed', jobId, error: err });
    }
  }

  /** 处理错误转 failed: 仅当前状态非终态时应用; 未知错误保留安全文案, 原始错误仅记录。 */
  private async markFailed(jobId: string, err: unknown): Promise<void> {
    const failure: JobFailure =
      err instanceof DomainError
        ? { code: err.code, safeMessage: err.message }
        : { code: 'INTERNAL_ERROR', safeMessage: 'Processing failed' };
    try {
      await this.deps.jobs.update(jobId, (j) =>
        isTerminal(j.status) ? j : { ...j, status: 'failed', failure },
      );
    } catch (updateErr) {
      // 竞态兜底(任务已被外部移除等): 不向外抛错(方法契约), 仅记录
      this.deps.logger.warn({
        event: 'job.failed',
        jobId,
        errorCode: failure.code,
        error: updateErr,
      });
      return;
    }
    // 迁移到 failed 后记录; reason 取已中性化的 safeMessage——只记 errorCode 时
    // 根因不可见(无法区分超限/上游异常/解析失败), 排查只能靠猜。未知错误另附原始 error。
    const fields: LogFields = {
      event: 'job.failed',
      jobId,
      errorCode: failure.code,
      reason: failure.safeMessage,
    };
    if (!(err instanceof DomainError)) fields.error = err;
    this.deps.logger.error(fields);
  }
}
