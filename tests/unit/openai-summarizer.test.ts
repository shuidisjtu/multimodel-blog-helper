import type OpenAI from 'openai';
import { APIError } from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { ResponsesSummarizer } from '../../src/infrastructure/openai/summarizer.js';
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

describe('ResponsesSummarizer', () => {
  it('通过 responses.create 生成摘要,输入包含转录文本', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: '摘要要点' });
    const client = { responses: { create } } as unknown as OpenAI;
    const fakeLogger = new FakeLogger();

    const summarizer = new ResponsesSummarizer(
      client as unknown as OpenAI,
      'gpt-4o',
      { timeoutMs: 60000, maxRetries: 2 },
      fakeLogger,
    );
    const result = await summarizer.summarize({ jobId: 'job-1', text: '这是一段转录文本。' });

    expect(result.text).toBe('摘要要点');
    const [args] = create.mock.calls[0] as NonNullable<(typeof create.mock.calls)[0]>;
    expect(args).toMatchObject({ model: 'gpt-4o' });
    expect(args.input).toContain('这是一段转录文本。');
  });

  it('上游 503 后重试成功: 重试 1 次, 成功日志含 retryCount', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new APIError(503, {}, 'service unavailable', undefined))
      .mockResolvedValueOnce({ output_text: '摘要要点' });
    const client = { responses: { create } } as unknown as OpenAI;
    const logger = new FakeLogger();
    const summarizer = new ResponsesSummarizer(
      client,
      'gpt-4o',
      { timeoutMs: 60000, maxRetries: 2 },
      logger,
    );

    const result = await summarizer.summarize({ jobId: 'job-1', text: '这是一段转录文本。' });

    expect(result.text).toBe('摘要要点');
    expect(create).toHaveBeenCalledTimes(2);
    expect(logger.calls.some((c) => c.event === 'upstream.retry' && c.jobId === 'job-1')).toBe(
      true,
    );
    const done = logger.calls.find((c) => c.event === 'openai.summarized') as LogFields;
    expect(done).toMatchObject({ jobId: 'job-1', model: 'gpt-4o', retryCount: 1 });
  });

  it('请求选项携带 timeout 且关闭 SDK 内置重试', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: '摘要要点' });
    const client = { responses: { create } } as unknown as OpenAI;
    const summarizer = new ResponsesSummarizer(
      client,
      'gpt-4o',
      { timeoutMs: 45000, maxRetries: 0 },
      new FakeLogger(),
    );

    await summarizer.summarize({ jobId: 'job-1', text: '文本' });

    const [, opts] = create.mock.calls[0] as NonNullable<(typeof create.mock.calls)[0]>;
    expect(opts).toMatchObject({ timeout: 45000, maxRetries: 0 });
  });

  it('4xx 参数错误: 立即抛, 不重试', async () => {
    const bad = new APIError(400, {}, 'bad request', undefined);
    const create = vi.fn().mockRejectedValueOnce(bad);
    const client = { responses: { create } } as unknown as OpenAI;
    const logger = new FakeLogger();
    const summarizer = new ResponsesSummarizer(
      client,
      'gpt-4o',
      { timeoutMs: 60000, maxRetries: 2 },
      logger,
    );

    await expect(summarizer.summarize({ jobId: 'job-1', text: '文本' })).rejects.toBe(bad);
    expect(create).toHaveBeenCalledTimes(1);
    expect(logger.calls.some((c) => c.event === 'upstream.retry')).toBe(false);
  });
});
