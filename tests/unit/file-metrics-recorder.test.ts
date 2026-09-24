/**
 * FileMetricsRecorder 单测: JSONL 追加落盘、可选字段省略、多次顺序追加。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UsageMetric } from '../../src/domain/ports.js';
import { FileMetricsRecorder } from '../../src/infrastructure/metrics/file-metrics-recorder.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'metrics-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function sampleMetric(overrides: Partial<UsageMetric> = {}): UsageMetric {
  return {
    jobId: 'job-1',
    completedAt: '2026-09-24T00:00:00.000Z',
    transcribeModel: 'whisper-1',
    transcribeDurationMs: 100,
    summaryModel: 'gpt-4o',
    summaryDurationMs: 200,
    totalDurationMs: 300,
    ...overrides,
  };
}

async function readLines(): Promise<string[]> {
  const content = await readFile(join(tempDir, 'metrics', 'usage.jsonl'), 'utf8');
  return content.trim().split('\n');
}

describe('FileMetricsRecorder', () => {
  it('追加 JSONL 到 metrics/usage.jsonl, 可选字段省略', async () => {
    const recorder = new FileMetricsRecorder(tempDir);
    await recorder.record(sampleMetric({ transcribeCharacterCount: 10, summaryInputTokens: 5 }));

    const lines = await readLines();
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string);
    expect(parsed).toMatchObject({
      jobId: 'job-1',
      transcribeCharacterCount: 10,
      summaryInputTokens: 5,
      totalDurationMs: 300,
    });
    expect(parsed.summaryOutputTokens).toBeUndefined(); // 可选字段省略
    expect(parsed.transcribeDurationSeconds).toBeUndefined();
  });

  it('多次 record 顺序追加, 互不覆盖', async () => {
    const recorder = new FileMetricsRecorder(tempDir);
    await recorder.record(sampleMetric({ jobId: 'a' }));
    await recorder.record(sampleMetric({ jobId: 'b' }));

    const lines = await readLines();
    expect(lines.map((l) => JSON.parse(l).jobId)).toEqual(['a', 'b']);
  });
});
