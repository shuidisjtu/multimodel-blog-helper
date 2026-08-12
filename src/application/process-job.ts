/**
 * ProcessJob 用例(架构文档 §4.1/§6.3-§6.4):推进单个任务的状态机直至完成。
 * 迁移顺序: queued→transcribing→summarizing→succeeded; 每一步以 assertCanTransition 校验
 * 并持久化; 任一处理错误转 failed(保留安全错误码), 本方法不向外抛错(worker 不需要 catch)。
 */
import { DomainError } from '../domain/errors.js';
import { assertCanTransition, isTerminal } from '../domain/job.js';
import type { BlogJob, JobFailure, JobStatus } from '../domain/job.js';
import type { FileStore, JobRepository, Summarizer, Transcriber, Transcript } from '../domain/ports.js';
import type { LogFields, Logger } from '../shared/logger.js';

export class ProcessJob {
  constructor(
    private readonly deps: {
      jobs: JobRepository;
      files: FileStore;
      transcriber: Transcriber;
      summarizer: Summarizer;
      logger: Logger;
      transcribeModel: string;
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
      // 终态保护: 不重复处理(§4.1)
      this.deps.logger.warn({ event: 'job.skipped', jobId, status: job.status, reason: 'terminal' });
      return;
    }
    try {
      await this.transition(jobId, 'queued', 'transcribing');
      const transcript = await this.transcribe(jobId, job.input.path, job.input.mimeType);
      await this.transition(jobId, 'transcribing', 'summarizing');
      const summarizeStarted = Date.now();
      const summary = await this.deps.summarizer.summarize(transcript.text);
      this.deps.logger.info({
        event: 'job.summarized',
        jobId,
        durationMs: Date.now() - summarizeStarted,
      });
      // 中间产物落盘(转录 + 摘要)
      const transcriptOut = await this.deps.files.saveOutput({
        jobId,
        kind: 'transcript',
        content: transcript.text,
      });
      const summaryOut = await this.deps.files.saveOutput({
        jobId,
        kind: 'summary',
        content: summary.text,
      });
      await this.deps.jobs.update(jobId, (j) => ({
        ...j,
        status: 'succeeded',
        result: {
          transcriptPath: transcriptOut.path,
          summary: summary.text,
          model: this.deps.transcribeModel,
        },
      }));
      this.deps.logger.info({ event: 'job.status', jobId, from: 'summarizing', to: 'succeeded' });
    } catch (err) {
      await this.markFailed(jobId, err);
    }
  }

  /** 读-改-写迁移(assertCanTransition 以仓储当前状态为准)并记录迁移日志(§4.1)。 */
  private async transition(jobId: string, from: JobStatus, to: JobStatus): Promise<void> {
    await this.deps.jobs.update(jobId, (j) => {
      assertCanTransition(j.status, to);
      return { ...j, status: to };
    });
    this.deps.logger.info({ event: 'job.status', jobId, from, to });
  }

  /** 转录并记录模型与耗时(§6: 转录请求携带 jobId 并记录模型/耗时)。 */
  private async transcribe(jobId: string, path: string, mimeType: string): Promise<Transcript> {
    const started = Date.now();
    const transcript = await this.deps.transcriber.transcribe({ path, mimeType });
    this.deps.logger.info({
      event: 'job.transcribed',
      jobId,
      durationMs: Date.now() - started,
      model: this.deps.transcribeModel,
    });
    return transcript;
  }

  /** 处理错误转 failed(§6.4): 仅当前状态非终态时应用; 未知错误保留安全文案, 原始错误仅记录。 */
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
      this.deps.logger.warn({ event: 'job.failed', jobId, errorCode: failure.code, error: updateErr });
      return;
    }
    // 迁移到 failed 后记录(含 errorCode); 未知错误附带原始 error 字段
    const fields: LogFields = { event: 'job.failed', jobId, errorCode: failure.code };
    if (!(err instanceof DomainError)) fields.error = err;
    this.deps.logger.error(fields);
  }
}
