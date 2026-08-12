import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { ResponsesSummarizer } from '../../src/infrastructure/openai/summarizer.js';

describe('ResponsesSummarizer', () => {
  it('通过 responses.create 生成摘要,输入包含转录文本', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: '摘要要点' });
    const client = { responses: { create } } as unknown as OpenAI;

    const summarizer = new ResponsesSummarizer(client, 'gpt-4o');
    const result = await summarizer.summarize('这是一段转录文本。');

    expect(result.text).toBe('摘要要点');
    const [args] = create.mock.calls[0]!;
    expect(args).toMatchObject({ model: 'gpt-4o' });
    expect(args.input).toContain('这是一段转录文本。');
  });
});
