import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { OpenAITranscriber } from '../../src/infrastructure/openai/transcriber.js';

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
    const transcriber = new OpenAITranscriber(
      client as unknown as OpenAI,
      'whisper-1',
      60000,
    );

    const result = await transcriber.transcribe({
      path: 'fixtures/audio-sample.mp3',
      mimeType: 'audio/mpeg',
    });

    expect(result.text).toBe('transcript text');
    const [args, opts] = client.create.mock.calls[0]!;
    expect(args).toMatchObject({ model: 'whisper-1' });
    expect(args.file).toBeInstanceOf(Blob);
    expect(opts).toMatchObject({ timeout: 60000, maxRetries: 2 });
  });

  it('上游失败时向上抛错,由错误边界处理(不伪造结果)', async () => {
    const client = fakeClient();
    client.create.mockRejectedValueOnce(new Error('upstream 429'));
    const transcriber = new OpenAITranscriber(
      client as unknown as OpenAI,
      'whisper-1',
      60000,
    );

    await expect(
      transcriber.transcribe({ path: 'fixtures/audio-sample.mp3', mimeType: 'audio/mpeg' }),
    ).rejects.toThrow('upstream 429');
  });
});
