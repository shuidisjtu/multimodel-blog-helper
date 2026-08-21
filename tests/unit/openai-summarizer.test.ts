import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
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
    const [args] = create.mock.calls[0]!;
    expect(args).toMatchObject({ model: 'gpt-4o' });
    expect(args.input).toContain('这是一段转录文本。');
  });
});
