/**
 * isOpenAiRetryable: 判定 OpenAI SDK 错误是否可重试(架构文档 §6)。
 * 可重试: 连接错误/连接超时(网络层, SDK 内部会抛)、429 限流、5xx 服务端错误。
 * 不可重试: 4xx 参数/内容错误、用户中止及其他未知错误。
 */
import { APIConnectionError, APIError } from 'openai';

export function isOpenAiRetryable(err: unknown): boolean {
  if (err instanceof APIConnectionError) return true; // 含 APIConnectionTimeoutError 子类
  if (err instanceof APIError) {
    const status = err.status;
    return status !== undefined && (status === 429 || status >= 500);
  }
  return false;
}
