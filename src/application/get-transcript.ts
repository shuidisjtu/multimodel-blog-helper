/**
 * GetTranscript 用例(架构文档 §5):下载纯文本转录。
 * 不存在 → JOB_NOT_FOUND(404); tombstone(expired)→ JOB_EXPIRED(410);
 * 任务未成功或产物文件缺失(清理窗口/未落盘)→ JOB_NOT_READY(409);
 * 其他错误 → INTERNAL_ERROR(500)。日志只记稳定错误码, 不记 err.message(可能含路径, §8.2)。
 */
import { DomainError } from '../domain/errors.js';
import type { FileStore, JobRepository } from '../domain/ports.js';
import type { Logger } from '../shared/logger.js';

/** 取系统错误码(ENOENT 等); 非 errno 错误返回 undefined。 */
function ioErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export class GetTranscript {
  constructor(
    private readonly deps: {
      jobs: JobRepository;
      files: FileStore;
      logger: Logger;
    },
  ) {}

  /** 返回转录文本(UTF-8); 不可用状态抛 DomainError(与 QueryJob 相同的 404/410 语义)。 */
  async run(id: string): Promise<string> {
    try {
      const job = await this.deps.jobs.get(id);
      if (job === null) {
        throw new DomainError('JOB_NOT_FOUND', 'Job not found');
      }
      if (job.status === 'expired') {
        throw new DomainError('JOB_EXPIRED', 'Job has expired');
      }
      if (job.status !== 'succeeded' || job.result === undefined) {
        throw new DomainError('JOB_NOT_READY', 'Transcript is not ready');
      }
      const buffer = await this.deps.files.read(job.result.transcriptPath);
      return buffer.toString('utf8');
    } catch (err) {
      if (err instanceof DomainError) throw err;
      // 产物缺失(未落盘/已清理)→ JOB_NOT_READY 由客户端稍后重试; 其他 IO/未知错误 → INTERNAL_ERROR
      const code = ioErrorCode(err);
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        this.deps.logger.warn({
          event: 'job.transcript.missing',
          jobId: id,
          errorCode: 'JOB_NOT_READY',
          ioError: code,
        });
        throw new DomainError('JOB_NOT_READY', 'Transcript is not ready');
      }
      this.deps.logger.error({
        event: 'job.transcript.failed',
        jobId: id,
        errorCode: 'INTERNAL_ERROR',
        ioError: code ?? 'unknown',
      });
      throw new DomainError('INTERNAL_ERROR', 'Internal error');
    }
  }
}
