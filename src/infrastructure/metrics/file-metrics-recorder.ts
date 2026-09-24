/**
 * FileMetricsRecorder: 用量指标 JSONL 落盘(答辩可视化数据源)。
 * 每任务一行 JSON, 追加写入 <tempDir>/metrics/usage.jsonl; mkdir 幂等。
 * 落盘失败向上抛错, 由调用方(ProcessJob)捕获并仅记日志——指标失败不影响主流程。
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { MetricsRecorder, UsageMetric } from '../../domain/ports.js';

export class FileMetricsRecorder implements MetricsRecorder {
  private readonly filePath: string;

  constructor(tempDir: string) {
    this.filePath = join(resolve(tempDir), 'metrics', 'usage.jsonl');
  }

  async record(metric: UsageMetric): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(metric)}\n`, 'utf8');
  }
}
