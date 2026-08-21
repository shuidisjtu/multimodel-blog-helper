/**
 * OpenAITranscriber:通过 OpenAI 转录 API(whisper-1)实现 Transcriber 端口。
 * 重试策略(架构文档 §6): withRetry 仅重试网络错误/429/5xx, 共 maxRetries+1 次尝试, 4xx 不重试;
 * SDK 内置重试关闭(maxRetries: 0)避免双重叠加。
 */
import { openAsBlob } from 'node:fs';
import type OpenAI from 'openai';
import type { Transcriber, Transcript } from '../../domain/ports.js';
import type { Logger } from '../../shared/logger.js';
import { withRetry } from '../common/retry.js';
import type { OpenAiAdapterOptions } from './options.js';
import { isOpenAiRetryable } from './retryable.js';

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
    const started = Date.now();
    const { value, retryCount } = await withRetry(
      () =>
        this.client.audio.transcriptions.create(
          { file, model: this.model },
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
      event: 'openai.transcribed',
      jobId: params.jobId,
      model: this.model,
      durationMs: Date.now() - started,
      retryCount,
    });
    return { text: value.text };
  }
}
