import { describe, expect, it } from 'vitest';
import { APIError, APIConnectionError, APIConnectionTimeoutError } from 'openai';
import { isOpenAiRetryable } from '../../src/infrastructure/openai/retryable.js';

function apiError(status: number): APIError {
  return new APIError(status, {}, `upstream ${status}`, undefined);
}

describe('isOpenAiRetryable(架构文档 §6)', () => {
  it('429 与 5xx 可重试', () => {
    expect(isOpenAiRetryable(apiError(429))).toBe(true);
    expect(isOpenAiRetryable(apiError(500))).toBe(true);
    expect(isOpenAiRetryable(apiError(503))).toBe(true);
  });

  it('4xx 参数/内容错误不可重试', () => {
    expect(isOpenAiRetryable(apiError(400))).toBe(false);
    expect(isOpenAiRetryable(apiError(404))).toBe(false);
    expect(isOpenAiRetryable(apiError(422))).toBe(false);
  });

  it('连接错误与连接超时可重试(网络层)', () => {
    expect(isOpenAiRetryable(new APIConnectionError({ message: 'conn' }))).toBe(true);
    expect(
      isOpenAiRetryable(new APIConnectionTimeoutError({ message: 'conn timeout' })),
    ).toBe(true);
  });

  it('非 SDK 错误不可重试', () => {
    expect(isOpenAiRetryable(new Error('plain'))).toBe(false);
    expect(isOpenAiRetryable('string error')).toBe(false);
    expect(isOpenAiRetryable(undefined)).toBe(false);
  });
});
