/**
 * ResponsesSummarizer:通过 Responses API 实现 Summarizer 端口(ADR-0001)。
 * 工具调用/对话统一走 responses.create。重试策略(架构文档 §6)与转录一致:
 * withRetry 仅重试网络错误/429/5xx, SDK 内置重试关闭(maxRetries: 0)。
 */
import type OpenAI from 'openai';
import type { Summarizer, Summary } from '../../domain/ports.js';
import type { Logger } from '../../shared/logger.js';
import { withRetry } from '../common/retry.js';
import type { OpenAiAdapterOptions } from './options.js';
import { isOpenAiRetryable } from './retryable.js';

export class ResponsesSummarizer implements Summarizer {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly options: OpenAiAdapterOptions,
    private readonly logger: Logger,
  ) {}

  async summarize(params: { jobId: string; text: string }): Promise<Summary> {
    const started = Date.now();
    const { value, retryCount } = await withRetry(
      () =>
        this.client.responses.create(
          {
            model: this.model,
            input: `请为以下音频转录文本生成简洁的中文摘要,以要点列表呈现:\n\n${params.text}`,
          },
          { timeout: this.options.timeoutMs, maxRetries: 0 },
        ),
      {
        maxAttempts: this.options.maxRetries + 1,
        isRetryable: isOpenAiRetryable,
        logger: this.logger,
        context: { jobId: params.jobId },
      },
    );
    this.logger.info({
      event: 'openai.summarized',
      jobId: params.jobId,
      model: this.model,
      durationMs: Date.now() - started,
      retryCount,
    });
    return { text: value.output_text };
  }
}
