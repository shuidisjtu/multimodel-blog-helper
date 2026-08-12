/**
 * ResponsesSummarizer:通过 Responses API 实现 Summarizer 端口。
 * 工具调用/对话统一走 responses.create(ADR-0001)。
 */
import type OpenAI from 'openai';
import type { Summarizer, Summary } from '../../domain/ports.js';

export class ResponsesSummarizer implements Summarizer {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async summarize(text: string): Promise<Summary> {
    const response = await this.client.responses.create({
      model: this.model,
      input: `请为以下音频转录文本生成简洁的中文摘要,以要点列表呈现:\n\n${text}`,
    });
    return { text: response.output_text };
  }
}
