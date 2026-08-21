/**
 * ResponsesSummarizer:通过 Responses API 实现 Summarizer 端口(ADR-0001)。
 * 工具调用/对话统一走 responses.create。超时/重试策略经 options 注入(架构文档 §7.2)。
 */
import type OpenAI from 'openai';
import type { Summarizer, Summary } from '../../domain/ports.js';
import type { Logger } from '../../shared/logger.js';
import type { OpenAiAdapterOptions } from './options.js';

export class ResponsesSummarizer implements Summarizer {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly options: OpenAiAdapterOptions,
    private readonly logger: Logger,
  ) {}

  async summarize(params: { jobId: string; text: string }): Promise<Summary> {
    const response = await this.client.responses.create({
      model: this.model,
      input: `请为以下音频转录文本生成简洁的中文摘要,以要点列表呈现:\n\n${params.text}`,
    });
    return { text: response.output_text };
  }
}
