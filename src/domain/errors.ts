/**
 * 领域错误(架构文档 §5:统一错误码,不向客户端返回堆栈/上游原始报错)。
 * HTTP 层负责将 ErrorCode 映射为 HTTP 状态码(架构文档 §8.1)。
 */

export type ErrorCode =
  | 'INVALID_FILE'
  | 'AUDIO_TOO_LONG'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INVALID_IDEMPOTENCY_KEY'
  | 'IDEMPOTENCY_CONFLICT'
  | 'QUEUE_FULL'
  | 'RATE_LIMITED'
  | 'JOB_NOT_FOUND'
  | 'JOB_EXPIRED'
  | 'JOB_NOT_READY'
  | 'INVALID_LOCATION'
  | 'WEATHER_UNAVAILABLE'
  | 'PROCESS_INTERRUPTED'
  | 'INTERNAL_ERROR';

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 非法状态迁移(Job 状态机违约)。 */
export class JobStateError extends DomainError {
  constructor(
    message: string,
    readonly from: string,
    readonly to: string,
  ) {
    super('INTERNAL_ERROR', message);
  }
}
