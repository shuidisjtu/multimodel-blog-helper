import { describe, expect, it } from 'vitest';
import type { AsrWord } from '../../src/infrastructure/qwen/segment-builder.js';
import { buildSegments, MIN_SEGMENT_MS } from '../../src/infrastructure/qwen/segment-builder.js';

/** 构造上游词级元素(字段名用上游的 snake_case)。 */
function w(
  begin: number,
  end: number,
  text: string,
  punctuation = '',
  speakerId?: number,
): AsrWord {
  return {
    begin_time: begin,
    end_time: end,
    text,
    punctuation,
    ...(speakerId !== undefined ? { speaker_id: speakerId } : {}),
  };
}

describe('buildSegments', () => {
  it('按句末标点切成句级片段, 文本保留标点', () => {
    const segments = buildSegments([w(0, 1000, '第一句', '。'), w(1000, 2500, '第二句', '。')]);

    expect(segments).toEqual([
      { beginMs: 0, endMs: 1000, text: '第一句。', speakerId: undefined },
      { beginMs: 1000, endMs: 2500, text: '第二句。', speakerId: undefined },
    ]);
  });

  it('中英文标点集都能切分', () => {
    const segments = buildSegments([
      w(0, 1000, 'Hello', '.'),
      w(1000, 2000, '你好', '。'),
      w(2000, 3000, '真的吗', '？'),
      w(3000, 4000, '是的', '!'),
    ]);

    expect(segments?.map((s) => s.text)).toEqual(['Hello.', '你好。', '真的吗？', '是的!']);
  });

  it('标点为空时有意不切: 没有切分依据时不臆造边界', () => {
    // 实测 528 个词中 480 个标点为空, 这类输入只能给出一段长片段
    const segments = buildSegments([w(0, 1000, '甲'), w(1000, 2500, '乙'), w(2500, 4000, '丙')]);

    expect(segments).toEqual([{ beginMs: 0, endMs: 4000, text: '甲乙丙', speakerId: undefined }]);
  });

  it('句末无标点的尾部照常结段', () => {
    const segments = buildSegments([w(0, 1000, '第一句', '。'), w(1000, 2500, '没标点的尾巴')]);

    expect(segments?.map((s) => s.text)).toEqual(['第一句。', '没标点的尾巴']);
  });

  it('说话人切换处强制断开(即使句子尚未结束)', () => {
    const segments = buildSegments([
      w(0, 1000, '前半句', '', 0),
      w(1000, 2000, '被另一个人接下', '。', 1),
    ]);

    expect(segments).toEqual([
      { beginMs: 0, endMs: 1000, text: '前半句', speakerId: 0 },
      { beginMs: 1000, endMs: 2000, text: '被另一个人接下。', speakerId: 1 },
    ]);
  });

  it(`低于 ${MIN_SEGMENT_MS}ms 的碎片并入前一段(同说话人)`, () => {
    const segments = buildSegments([
      w(0, 2000, '第一句', '。'),
      w(2000, 2400, '嗯', '。'),
      w(2400, 4000, '第三句', '。'),
    ]);

    expect(segments).toEqual([
      { beginMs: 0, endMs: 2400, text: '第一句。嗯。', speakerId: undefined },
      { beginMs: 2400, endMs: 4000, text: '第三句。', speakerId: undefined },
    ]);
  });

  it('首段过短时前面没有可并对象, 改为并入后一段', () => {
    const segments = buildSegments([w(0, 400, '嗯', '。'), w(400, 3000, '第二句', '。')]);

    expect(segments).toEqual([
      { beginMs: 0, endMs: 3000, text: '嗯。第二句。', speakerId: undefined },
    ]);
  });

  it('碎片不跨说话人合并(否则会把两个人的话粘成一句)', () => {
    const segments = buildSegments([
      w(0, 2000, '第一句', '。', 0),
      w(2000, 2400, '嗯', '。', 1),
      w(2400, 4000, '第三句', '。', 1),
    ]);

    expect(segments?.map((s) => [s.text, s.speakerId])).toEqual([
      ['第一句。', 0],
      ['嗯。', 1],
      ['第三句。', 1],
    ]);
  });

  it('缺时间戳的词被跳过, 不伪造为 0', () => {
    const segments = buildSegments([
      { text: '无时间戳', punctuation: '。' },
      w(1000, 2000, '有时间戳', '。'),
    ]);

    expect(segments).toEqual([
      { beginMs: 1000, endMs: 2000, text: '有时间戳。', speakerId: undefined },
    ]);
  });

  it('无可用词时返回 undefined(而不是空数组冒充已支持)', () => {
    expect(buildSegments([])).toBeUndefined();
    expect(buildSegments([{ text: 'no timing' }])).toBeUndefined();
  });

  it('结果时间单调递增且互不重叠', () => {
    // 每段均长于 MIN_SEGMENT_MS, 避免被碎片合并规则影响
    const segments = buildSegments([
      w(0, 1200, '一', '。'),
      w(1200, 2600, '二', '。'),
      w(2600, 4100, '三', '。'),
      w(4100, 6000, '四', '。'),
    ]);

    expect(segments).toHaveLength(4);
    for (let i = 1; i < (segments?.length ?? 0); i++) {
      const previous = segments?.[i - 1];
      const current = segments?.[i];
      expect(current?.beginMs).toBeGreaterThanOrEqual(previous?.endMs ?? 0);
      expect(current?.endMs).toBeGreaterThan(current?.beginMs ?? 0);
    }
  });
});
