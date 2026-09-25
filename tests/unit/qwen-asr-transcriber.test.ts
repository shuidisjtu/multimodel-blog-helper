import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../src/domain/errors.js';
import {
  buildDataUrl,
  DATA_URI_MAX_BYTES,
  encodedByteLength,
  mapUpstreamError,
  type QwenAsrOptions,
  QwenAsrTranscriber,
} from '../../src/infrastructure/qwen/qwen-asr-transcriber.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

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

const OPTIONS: QwenAsrOptions = {
  apiKey: 'sk-test-key',
  endpoint: 'https://asr.example/generation',
  model: 'qwen-audio-3.1-asr-flash',
  timeoutMs: 5000,
  speakerDiarization: true,
  maxRetries: 2,
};

let dir: string;
let audioPath: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qwen-asr-'));
  audioPath = join(dir, 'input.mp3');
  await writeFile(audioPath, Buffer.from('ID3fake-audio-bytes'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 词级元素(上游 snake_case)。 */
function word(begin: number, end: number, text: string, punctuation = '', speakerId = 0) {
  return { begin_time: begin, end_time: end, text, punctuation, speaker_id: speakerId };
}

/** 仿真实响应: 顶层 text/usage/sentences/sentence + 冗余 output 副本(不含 usage)。 */
function responseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const sentences = [
    { begin_time: 0, end_time: 1000, speaker_id: 0, words: [word(0, 1000, '第一句', '。')] },
    { begin_time: 1000, end_time: 2500, speaker_id: 0, words: [word(1000, 2500, '第二句', '。')] },
  ];
  const sentence = {
    begin_time: 0,
    end_time: 2500,
    speaker_id: 0,
    words: [word(0, 2500, '整段一句', '。')],
  };
  return {
    text: '第一句。第二句。',
    sentence,
    sentences,
    usage: { duration: 15, input_tokens: 238, output_tokens: 80, total_tokens: 318 },
    request_id: 'req-1',
    output: { text: '第一句。第二句。', sentence, sentences, request_id: 'req-1' },
    ...overrides,
  };
}

function stubFetch(handler: (call: number) => Response | Promise<Response>) {
  let call = 0;
  const mock = vi.fn(async () => handler(++call));
  vi.stubGlobal('fetch', mock);
  return mock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeTranscriber(logger = new FakeLogger(), options: Partial<QwenAsrOptions> = {}) {
  return {
    logger,
    transcriber: new QwenAsrTranscriber({ ...OPTIONS, ...options }, logger),
  };
}

describe('QwenAsrTranscriber', () => {
  it('按 DashScope 同步接口发起一次调用: base64 Data URL + 必填 format + 说话人分离', async () => {
    const fetchMock = stubFetch(() => jsonResponse(responseBody()));
    const { transcriber } = makeTranscriber();

    const result = await transcriber.transcribe({
      jobId: 'job-1',
      path: audioPath,
      mimeType: 'audio/mpeg',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://asr.example/generation');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test-key');
    expect(headers['X-DashScope-SSE']).toBe('disable');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      parameters: Record<string, unknown>;
      input: { messages: { content: { input_audio: { data: string } }[] }[] };
    };
    expect(body.model).toBe('qwen-audio-3.1-asr-flash');
    expect(body.parameters).toEqual({ format: 'mp3', speaker_diarization_enabled: true });
    expect(body.input.messages[0]?.content[0]?.input_audio.data).toBe(
      `data:audio/mpeg;base64,${Buffer.from('ID3fake-audio-bytes').toString('base64')}`,
    );

    expect(result.text).toBe('第一句。第二句。');
    expect(result.characterCount).toBe([...'第一句。第二句。'].length);
    expect(result.durationSeconds).toBe(15); // 取自顶层 usage
  });

  it('分段取 sentences[](VAD 段), 不取覆盖整段音频的 sentence', async () => {
    stubFetch(() => jsonResponse(responseBody()));
    const { transcriber } = makeTranscriber();

    const result = await transcriber.transcribe({
      jobId: 'job-1',
      path: audioPath,
      mimeType: 'audio/mpeg',
    });

    // sentence 是 0→2500 的整段一句; 取错会让分段退化成"整段一句"
    expect(result.segments?.map((s) => [s.beginMs, s.endMs, s.text])).toEqual([
      [0, 1000, '第一句。'],
      [1000, 2500, '第二句。'],
    ]);
  });

  it('usage 只在顶层: output 内的 usage 不读, durationSeconds 回落到片段末值', async () => {
    stubFetch(() =>
      jsonResponse(
        responseBody({
          usage: undefined,
          output: { usage: { duration: 999 } }, // 故意把 usage 放错层
        }),
      ),
    );
    const { transcriber } = makeTranscriber();

    const result = await transcriber.transcribe({
      jobId: 'job-1',
      path: audioPath,
      mimeType: 'audio/mpeg',
    });

    expect(result.durationSeconds).toBe(2.5); // 末段 endMs 2500 / 1000, 而不是 999
  });

  it('无词级数据: segments 为 undefined, 不落空数组冒充已支持', async () => {
    stubFetch(() => jsonResponse({ text: '只有文本', usage: { duration: 7 } }));
    const { transcriber } = makeTranscriber();

    const result = await transcriber.transcribe({
      jobId: 'job-1',
      path: audioPath,
      mimeType: 'audio/mpeg',
    });

    expect(result.segments).toBeUndefined();
    expect(result.durationSeconds).toBe(7);
  });

  it('关闭说话人分离时不带 speaker_diarization_enabled 参数', async () => {
    const fetchMock = stubFetch(() => jsonResponse(responseBody()));
    const { transcriber } = makeTranscriber(new FakeLogger(), { speakerDiarization: false });

    await transcriber.transcribe({ jobId: 'job-1', path: audioPath, mimeType: 'audio/x-m4a' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { parameters: Record<string, unknown> };
    expect(body.parameters).toEqual({ format: 'm4a' });
  });

  it('200 但无文本: 抛 INTERNAL_ERROR(不静默产出空转录)', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ usage: { duration: 3 } }));
    const { transcriber } = makeTranscriber();

    await expect(
      transcriber.transcribe({ jobId: 'job-1', path: audioPath, mimeType: 'audio/mpeg' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // 业务错误不重试
  });

  it('响应非 JSON: 抛 INTERNAL_ERROR', async () => {
    stubFetch(() => new Response('<html>gateway</html>', { status: 200 }));
    const { transcriber } = makeTranscriber();

    await expect(
      transcriber.transcribe({ jobId: 'job-1', path: audioPath, mimeType: 'audio/mpeg' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('上游超时长: 映射为 AUDIO_TOO_LONG 业务错误且不重试', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ code: 'AUDIO_DURATION_TOO_LONG', message: 'over 300s' }, 400),
    );
    const { transcriber } = makeTranscriber();

    await expect(
      transcriber.transcribe({ jobId: 'job-1', path: audioPath, mimeType: 'audio/mpeg' }),
    ).rejects.toMatchObject({ code: 'AUDIO_TOO_LONG' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('上游体积超限: 映射为 FILE_TOO_LARGE', async () => {
    stubFetch(() => jsonResponse({ code: 'BadRequest.TooLarge', message: 'too large' }, 400));
    const { transcriber } = makeTranscriber();

    await expect(
      transcriber.transcribe({ jobId: 'job-1', path: audioPath, mimeType: 'audio/mpeg' }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('无语音内容: 映射为 INVALID_FILE', async () => {
    stubFetch(() => jsonResponse({ code: 'ASR_RESPONSE_HAVE_NO_WORDS' }, 400));
    const { transcriber } = makeTranscriber();

    await expect(
      transcriber.transcribe({ jobId: 'job-1', path: audioPath, mimeType: 'audio/mpeg' }),
    ).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });

  it('429 后重试成功: 重试 1 次, 日志含 jobId 与 retryCount', async () => {
    const fetchMock = stubFetch((call) =>
      call === 1
        ? jsonResponse({ code: 'Throttling', message: 'rate limited' }, 429)
        : jsonResponse(responseBody()),
    );
    const { transcriber, logger } = makeTranscriber();

    const result = await transcriber.transcribe({
      jobId: 'job-1',
      path: audioPath,
      mimeType: 'audio/mpeg',
    });

    expect(result.text).toBe('第一句。第二句。');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.calls.find((c) => c.event === 'upstream.retry')).toMatchObject({
      level: 'warn',
      jobId: 'job-1',
      attempt: 1,
    });
    expect(logger.calls.find((c) => c.event === 'qwen.transcribed')).toMatchObject({
      jobId: 'job-1',
      model: 'qwen-audio-3.1-asr-flash',
      retryCount: 1,
      segmentCount: 2,
    });
  });

  it('5xx 重试, 4xx(非 429)不重试', async () => {
    const serverError = stubFetch(() => jsonResponse({ code: 'InternalError' }, 503));
    await expect(
      makeTranscriber().transcriber.transcribe({
        jobId: 'job-1',
        path: audioPath,
        mimeType: 'audio/mpeg',
      }),
    ).rejects.toThrow();
    expect(serverError).toHaveBeenCalledTimes(3); // maxRetries 2 -> 共 3 次尝试

    vi.unstubAllGlobals();
    const clientError = stubFetch(() => jsonResponse({ code: 'InvalidParameter' }, 400));
    await expect(
      makeTranscriber().transcriber.transcribe({
        jobId: 'job-1',
        path: audioPath,
        mimeType: 'audio/mpeg',
      }),
    ).rejects.toThrow();
    expect(clientError).toHaveBeenCalledTimes(1);
  });

  it('网络错误重试', async () => {
    const fetchMock = stubFetch((call) => {
      if (call === 1) throw new TypeError('fetch failed');
      return jsonResponse(responseBody());
    });

    const result = await makeTranscriber().transcriber.transcribe({
      jobId: 'job-1',
      path: audioPath,
      mimeType: 'audio/mpeg',
    });

    expect(result.text).toBe('第一句。第二句。');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('不支持的 MIME 直接抛 UNSUPPORTED_MEDIA_TYPE, 不发起请求', async () => {
    const fetchMock = stubFetch(() => jsonResponse(responseBody()));

    await expect(
      makeTranscriber().transcriber.transcribe({
        jobId: 'job-1',
        path: audioPath,
        mimeType: 'audio/flac',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('日志不含密钥与音频/转录内容', async () => {
    stubFetch(() => jsonResponse(responseBody()));
    const { transcriber, logger } = makeTranscriber();

    await transcriber.transcribe({ jobId: 'job-1', path: audioPath, mimeType: 'audio/mpeg' });

    const serialized = JSON.stringify(logger.calls);
    expect(serialized).not.toContain('sk-test-key');
    expect(serialized).not.toContain('ID3fake-audio-bytes');
    expect(serialized).not.toContain('第一句');
  });
});

describe('buildDataUrl', () => {
  it('构造 data:<mime>;base64,<data>', () => {
    expect(buildDataUrl('audio/wav', Buffer.from('abc'))).toBe('data:audio/wav;base64,YWJj');
  });

  it(`编码后超过上限 ${DATA_URI_MAX_BYTES} 字节即抛 FILE_TOO_LARGE(不发请求)`, () => {
    // 15 MiB 是恰好等于上限的原始大小: ceil(15728640/3)*4 === 20971520
    expect(() => buildDataUrl('audio/mpeg', Buffer.alloc(15728641))).toThrow(DomainError);
  });
});

describe('encodedByteLength', () => {
  it('base64 膨胀 4/3, 边界恰落在实测 data-uri 上限', () => {
    expect(encodedByteLength(3)).toBe(4);
    expect(encodedByteLength(1)).toBe(4);
    expect(encodedByteLength(15728640)).toBe(DATA_URI_MAX_BYTES); // 不超过 -> 放行
    expect(encodedByteLength(15728641)).toBeGreaterThan(DATA_URI_MAX_BYTES); // 超过 -> 拒绝
  });
});

describe('mapUpstreamError', () => {
  it('已知错误码映射为业务错误, 未知返回 null', () => {
    expect(mapUpstreamError('AUDIO_DURATION_TOO_LONG', undefined)?.code).toBe('AUDIO_TOO_LONG');
    expect(mapUpstreamError('BadRequest.TooLarge', undefined)?.code).toBe('FILE_TOO_LARGE');
    expect(mapUpstreamError('ASR_RESPONSE_HAVE_NO_WORDS', undefined)?.code).toBe('INVALID_FILE');
    expect(
      mapUpstreamError('InvalidParameter', 'string length exceeds the maximum allowed')?.code,
    ).toBe('FILE_TOO_LARGE');
    expect(mapUpstreamError('InvalidParameter', 'something else')).toBeNull();
    expect(mapUpstreamError('Unknown.Code', 'whatever')).toBeNull();
  });
});
