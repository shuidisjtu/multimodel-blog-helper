/** OpenAI 适配器上游调用配置(架构文档 §7.2): 超时与重试策略。 */
export interface OpenAiAdapterOptions {
  /** 单次上游请求超时(毫秒)。 */
  timeoutMs: number;
  /** 可恢复错误的最大重试次数(0 = 不重试; 总尝试次数 = maxRetries + 1)。 */
  maxRetries: number;
}
