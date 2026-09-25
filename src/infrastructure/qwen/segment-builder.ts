/**
 * 词级时间戳 → 句级片段的重组器。
 *
 * 为什么必须重组: 上游返回的分段是**按静音切分的 VAD 片段**, 不是语言学句子。
 * 实测 171s 样本(VAD 10 段)里最长一段 57.0s、含 12 个完整句子; 用词级标点重组后为 31 句、
 * 时长中位 4.5s。二者不是"谁更准"而是不同粒度: VAD 片段适合作段落, 标点重组才适合作句子。
 * 实测依据见 docs/evidence/a6-1-qwen-asr-feasibility/。
 *
 * 这是**启发式**, 三处已知边界(均为实测结论, 不是想象):
 * 1. **标点稀疏**: 实测 528 个词中仅 28 个带句号、480 个标点为空。切分完全依赖"恰好带标点的词",
 *    无标点处**有意不切**——没有切分依据时不臆造边界, 宁可给出一段长片段。
 * 2. **中英文标点集不同**: 句末标点取中英文并集(`。！？!?…` 与 `.`)。
 *    已知代价: 英文缩写(如 "Dr.")会被误切; 该场景在本项目的音频样本中未出现, 暂不引入词表规避。
 * 3. **会产生极短片段**: 实测最短 1.2s, 更短的碎片在时间轴上无法被人眼或前端有效呈现,
 *    故低于 MIN_SEGMENT_MS 的片段并入相邻**同说话人**片段(不跨说话人合并, 否则会粘成一句)。
 *
 * 另: 说话人切换处**强制断开**——把一句归给两个说话人比多切一刀更糟。
 */
import type { TranscriptSegment } from '../../domain/ports.js';

/** 上游词级元素。字段全部按 `unknown` 可选解析: 上游契约不保证齐全, 缺失即跳过该词。 */
export interface AsrWord {
  begin_time?: unknown;
  end_time?: unknown;
  text?: unknown;
  punctuation?: unknown;
  speaker_id?: unknown;
}

export interface BuildSegmentsOptions {
  /** 低于该时长的片段并入相邻同说话人片段(毫秒); 默认 MIN_SEGMENT_MS。 */
  minSegmentMs?: number;
}

/**
 * 片段最小时长(毫秒)。取 1000 的理由: 实测重组后的**自然**最短值为 1.2s,
 * 故该阈值只会命中真正退化的碎片(标点稀疏时切出的 1~2 词残段), 不会误并正常短句。
 */
export const MIN_SEGMENT_MS = 1000;

/** 句末标点(中英文并集)。 */
const SENTENCE_END = /[.。！？!?…]/;

/**
 * 把按时间顺序排列的词重组成句级片段。
 * 无可用词(空数组, 或全部缺时间戳)→ 返回 undefined, 表示"无法给出时间戳"。
 */
export function buildSegments(
  words: readonly AsrWord[],
  options: BuildSegmentsOptions = {},
): TranscriptSegment[] | undefined {
  const minSegmentMs = options.minSegmentMs ?? MIN_SEGMENT_MS;
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  for (const word of words) {
    const beginMs = toNonNegativeNumber(word.begin_time);
    const endMs = toNonNegativeNumber(word.end_time);
    // 无时间戳的词无处安放: 跳过而非伪造 0(伪造会污染时间轴且无从察觉)
    if (beginMs === null || endMs === null) continue;
    const speakerId = toNumber(word.speaker_id);

    if (current !== null && current.speakerId !== speakerId) {
      segments.push(current);
      current = null;
    }
    if (current === null) {
      current = { beginMs, endMs, text: '', speakerId };
    } else {
      current.endMs = Math.max(current.endMs, endMs);
    }

    current.text += asText(word.text) + asText(word.punctuation);
    if (SENTENCE_END.test(asText(word.punctuation))) {
      segments.push(current);
      current = null;
    }
  }
  if (current !== null) segments.push(current);

  const merged = mergeFragments(segments, minSegmentMs);
  return merged.length === 0 ? undefined : merged.map((s) => ({ ...s, text: s.text.trim() }));
}

/** 过短片段并入相邻同说话人片段; 首段过短时前面没有可并对象, 改为并入后一段。 */
function mergeFragments(
  segments: readonly TranscriptSegment[],
  minSegmentMs: number,
): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];
  for (const segment of segments) {
    const previous = result[result.length - 1];
    if (
      isFragment(segment, minSegmentMs) &&
      previous !== undefined &&
      previous.speakerId === segment.speakerId
    ) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      previous.text += segment.text;
      continue;
    }
    result.push({ ...segment });
  }

  const first = result[0];
  const second = result[1];
  if (
    first !== undefined &&
    second !== undefined &&
    isFragment(first, minSegmentMs) &&
    first.speakerId === second.speakerId
  ) {
    second.beginMs = first.beginMs;
    second.text = first.text + second.text;
    result.shift();
  }
  return result;
}

function isFragment(segment: TranscriptSegment, minSegmentMs: number): boolean {
  return segment.endMs - segment.beginMs < minSegmentMs;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toNonNegativeNumber(value: unknown): number | null {
  const parsed = toNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
