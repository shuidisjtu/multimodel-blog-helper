import { describe, expect, it } from 'vitest';
import { formatTimestampedTranscript } from '../../src/application/transcript-text.js';

describe('formatTimestampedTranscript', () => {
  it('每行一句, 时间戳为 mm:ss.xx', () => {
    const text = formatTimestampedTranscript([
      { beginMs: 0, endMs: 4160, text: '第一句。' },
      { beginMs: 4480, endMs: 9680, text: '第二句。' },
    ]);

    expect(text).toBe('[00:00.00 → 00:04.16] 第一句。\n[00:04.48 → 00:09.68] 第二句。');
  });

  it('超过一分钟用分钟位, 不足两位补零', () => {
    expect(formatTimestampedTranscript([{ beginMs: 65000, endMs: 125500, text: '长音频。' }])).toBe(
      '[01:05.00 → 02:05.50] 长音频。',
    );
  });

  it('空片段返回空字符串(调用方不应落盘该产物)', () => {
    expect(formatTimestampedTranscript([])).toBe('');
  });
});
