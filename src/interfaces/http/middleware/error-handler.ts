import type { ErrorRequestHandler, Response } from 'express';
import multer from 'multer';
import { DomainError, type ErrorCode } from '../../../domain/errors.js';
import type { Logger } from '../../../shared/logger.js';
import { errorEnvelope } from '../envelope.js';

/** HTTP 状态映射(openapi.yaml 为真相源; ErrorCode 全集合一次声明, B1-B6 共用, 契约先行)。 */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_FILE: 400,
  AUDIO_TOO_LONG: 400,
  IDEMPOTENCY_CONFLICT: 409,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  QUEUE_FULL: 503,
  RATE_LIMITED: 429,
  JOB_NOT_FOUND: 404,
  JOB_EXPIRED: 410,
  JOB_NOT_READY: 409,
  INVALID_LOCATION: 422,
  WEATHER_UNAVAILABLE: 503,
  PROCESS_INTERRUPTED: 500,
  INTERNAL_ERROR: 500,
};

/** 客户端可见稳定消息(openapi.yaml example 文案); 领域错误原始 message 只进日志(§8.1)。 */
const MESSAGE_BY_CODE: Record<ErrorCode, string> = {
  INVALID_FILE: 'Invalid audio file',
  AUDIO_TOO_LONG: 'Audio duration exceeds limit',
  IDEMPOTENCY_CONFLICT: 'Idempotency key conflict',
  FILE_TOO_LARGE: 'File is too large',
  UNSUPPORTED_MEDIA_TYPE: 'Unsupported media type',
  QUEUE_FULL: 'Queue is full, retry later',
  RATE_LIMITED: 'Too many requests',
  JOB_NOT_FOUND: 'Job not found',
  JOB_EXPIRED: 'Job has expired',
  JOB_NOT_READY: 'Transcript is not ready',
  INVALID_LOCATION: 'Invalid location',
  WEATHER_UNAVAILABLE: 'Weather service is unavailable',
  PROCESS_INTERRUPTED: 'Internal error',
  INTERNAL_ERROR: 'Internal error',
};

/** Retry-After(秒): 仅限流与队列满场景(openapi.yaml: 429/503 响应要求该头)。B1 只触发 QUEUE_FULL; 动态值属 B6。 */
const RETRY_AFTER_BY_CODE: Partial<Record<ErrorCode, number>> = {
  QUEUE_FULL: 1,
  RATE_LIMITED: 1,
};

function sendError(res: Response, code: ErrorCode, requestId: string): void {
  if (RETRY_AFTER_BY_CODE[code] !== undefined) {
    res.setHeader('Retry-After', String(RETRY_AFTER_BY_CODE[code]));
  }
  res.status(STATUS_BY_CODE[code]).json(errorEnvelope(code, MESSAGE_BY_CODE[code], requestId));
}

/**
 * 统一错误边界(架构文档 §8.1): 挂载在路由末尾。
 * Express 5 自动将 async handler 的 rejection 转发到本中间件, 无需逐路由包装器。
 * 未知错误以 500 INTERNAL_ERROR 兜底并记录(不向客户端泄漏堆栈/原始报错)。
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    const requestId = String(res.locals.requestId ?? '');
    if (err instanceof multer.MulterError) {
      const code: ErrorCode = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'INVALID_FILE';
      logger.warn({ event: 'http.multer_error', requestId, errorCode: code, multerCode: err.code });
      sendError(res, code, requestId);
      return;
    }
    if (err instanceof DomainError) {
      logger.warn({
        event: 'http.domain_error',
        requestId,
        errorCode: err.code,
        error: err.message,
      });
      sendError(res, err.code, requestId);
      return;
    }
    logger.error({
      event: 'http.unhandled_error',
      requestId,
      errorCode: 'INTERNAL_ERROR',
      error: err instanceof Error ? err.message : err,
    });
    sendError(res, 'INTERNAL_ERROR', requestId);
  };
}
