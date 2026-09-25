/**
 * 带时间戳转录的文本渲染(下载端点 /transcript/timed 的产物格式)。
 */
import type { TranscriptSegment } from '../domain/ports.js';

/**
 * 渲染为每行一句的纯文本, 形如 `[00:00.00 → 00:04.16] 句子文本`。
 *
 * 时间戳用 mm:ss.xx: 音频时长上限为 300s(config 的 MAX_AUDIO_DURATION_SECONDS),
 * 分:秒已足够; 不引入小时位, 免得答辩演示时反而更难读。
 * 有意不输出说话人标识——该信息在 Transcript.segments 里保留, 需要时再作为独立产物呈现。
 */
export function formatTimestampedTranscript(segments: readonly TranscriptSegment[]): string {
  return segments
    .map(
      (segment) =>
        `[${formatMillis(segment.beginMs)} → ${formatMillis(segment.endMs)}] ${segment.text}`,
    )
    .join('\n');
}

function formatMillis(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
}
