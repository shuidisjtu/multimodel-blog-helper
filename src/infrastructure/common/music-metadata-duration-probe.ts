/**
 * MusicMetadataDurationProbe: 用 music-metadata(纯 JS, 零系统依赖)解析音频时长。
 * 降级语义(架构文档 §5): 解析失败(损坏/非音频/无时长字段)返回 null 并记录原因, 不拒绝文件 —— 不得误杀合法音频。
 */
import { parseFile } from 'music-metadata';
import type { AudioDurationProbe } from '../../domain/ports.js';
import type { Logger } from '../../shared/logger.js';

export class MusicMetadataDurationProbe implements AudioDurationProbe {
  constructor(private readonly logger: Logger) {}

  async probe(filePath: string): Promise<number | null> {
    try {
      const metadata = await parseFile(filePath, { duration: true });
      const duration = metadata.format.duration;
      if (duration === undefined || Number.isNaN(duration)) {
        this.logger.warn({
          event: 'audio.duration_probe.degraded',
          filePath,
          reason: 'duration_unavailable',
        });
        return null;
      }
      return duration;
    } catch (err) {
      this.logger.warn({
        event: 'audio.duration_probe.degraded',
        filePath,
        reason: 'parse_failed',
        error: err,
      });
      return null;
    }
  }
}
