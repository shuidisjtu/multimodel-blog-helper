import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAITranscriber } from '../../src/infrastructure/openai/transcriber.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

/** 记录型 fake 日志: 每个调用打上 level 便于断言。 */
class FakeLogger implements Logger {
  readonly calls: LogFields[] = [];
  debug(f: LogFields): void {
    this.calls.push({ ...f, level: 'debug' });
  }
  info(f: LogFields): void {
    this.calls.push({ ...f, level: 'info' });
  }
  warn(f: LogFields): void {
    this.calls.push({ ...f, level: 'warn' });
  }
  error(f: LogFields): void {
    this.calls.push({ ...f, level: 'error' });
  }
}

/** 结构类型兼容的 fake client,不发起真实网络请求。 */
function fakeClient() {
  const create = vi.fn().mockResolvedValue({ text: 'transcript text' });
  return {
    audio: { transcriptions: { create } },
    create,
  };
}

describe('OpenAITranscriber', () => {
  it('调用转录 API 并返回文本(使用真实 fixture 文件流式读取)', async () => {
    const client = fakeClient();
    const fakeLogger = new FakeLogger();
    const transcriber = new OpenAITranscriber(
      client as unknown as OpenAI,
      'whisper-1',
      { timeoutMs: 60000, maxRetries: 2 },
      fakeLogger,
    );

    const result = await transcriber.transcribe({
      jobId: 'job-1',
      path: 'fixtures/audio-sample.mp3',
      mimeType: 'audio/mpeg',
    });

    expect(result.text).toBe('transcript text');
    const [args, opts] = client.create.mock.calls[0]!;
    expect(args).toMatchObject({ model: 'whisper-1' });
    expect(args.file).toBeInstanceOf(Blob);
    expect(opts).toMatchObject({ timeout: 60000 });
  });

  it('上游失败时向上抛错,由错误边界处理(不伪造结果)', async () => {
    const client = fakeClient();
    const fakeLogger = new FakeLogger();
    client.create.mockRejectedValueOnce(new Error('upstream 429'));
    const transcriber = new OpenAITranscriber(
      client as unknown as OpenAI,
      'whisper-1',
      { timeoutMs: 60000, maxRetries: 2 },
      fakeLogger,
    );

    await expect(
      transcriber.transcribe({ jobId: 'job-1', path: 'fixtures/audio-sample.mp3', mimeType: 'audio/mpeg' }),
    ).rejects.toThrow('upstream 429');
  });
});
