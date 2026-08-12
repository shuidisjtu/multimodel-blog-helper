/**
 * OpenAITranscriber:通过 OpenAI 转录 API(whisper-1)实现 Transcriber 端口。
 * 重试策略(架构文档 §6):SDK 内置指数退避重试网络/429/5xx,最多 3 次尝试,4xx 不重试。
 */
import { openAsBlob } from 'node:fs';
import type OpenAI from 'openai';
import type { Transcriber, Transcript } from '../../domain/ports.js';

export class OpenAITranscriber implements Transcriber {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async transcribe(params: { path: string; mimeType: string }): Promise<Transcript> {
    // openAsBlob 流式读取,避免整文件进内存(与 25MB 上限配合)
    const file = await openAsBlob(params.path, { type: params.mimeType });
    const response = await this.client.audio.transcriptions.create(
      { file, model: this.model },
      { timeout: this.timeoutMs, maxRetries: 2 },
    );
    return { text: response.text };
  }
}
