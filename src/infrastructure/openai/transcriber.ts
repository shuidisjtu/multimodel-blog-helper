/**
 * OpenAITranscriber:通过 OpenAI 转录 API(whisper-1)实现 Transcriber 端口。
 * 超时/重试策略经 options 注入(架构文档 §7.2), 重试行为在 Task 4 接入 withRetry。
 */
import { openAsBlob } from 'node:fs';
import type OpenAI from 'openai';
import type { Transcriber, Transcript } from '../../domain/ports.js';
import type { Logger } from '../../shared/logger.js';
import type { OpenAiAdapterOptions } from './options.js';

export class OpenAITranscriber implements Transcriber {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly options: OpenAiAdapterOptions,
    private readonly logger: Logger,
  ) {}

  async transcribe(params: { jobId: string; path: string; mimeType: string }): Promise<Transcript> {
    // openAsBlob 流式读取,避免整文件进内存(与 25MB 上限配合)
    const file = await openAsBlob(params.path, { type: params.mimeType });
    const response = await this.client.audio.transcriptions.create(
      { file, model: this.model },
      { timeout: this.options.timeoutMs },
    );
    return { text: response.text };
  }
}
