import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/bootstrap/config.js';
import { buildContainer } from '../../src/bootstrap/container.js';

let tempDir: string;

function fakeConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    openai: {
      apiKey: 'sk-test',
      baseUrl: 'https://mock.local/v1',
      transcribeModel: 'whisper-1',
      summaryModel: 'gpt-4o',
      transcribeTimeoutMs: 1000,
      summaryTimeoutMs: 1000,
      maxRetries: 0,
    },
    storage: { tempDir, maxUploadBytes: 1024, jobTtlHours: 24 },
    weather: { baseUrl: 'https://wttr.in', timeoutMs: 15000 },
    queue: { maxLength: 10, workerConcurrency: 1 },
    limits: {
      rateLimitUploadPerMinute: 10,
      rateLimitWeatherPerMinute: 30,
      maxAudioDurationSeconds: 3600,
    },
    security: { trustProxy: false, corsAllowedOrigins: [] },
    metrics: { port: 9100 },
    logLevel: 'error',
  };
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'b1-container-'));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('buildContainer(架构文档 §3.1 bootstrap 职责)', () => {
  it('组装全部用例与基础设施, 注入配置', () => {
    const deps = buildContainer(fakeConfig());
    expect(deps.submitAudio).toBeDefined();
    expect(deps.processJob).toBeDefined();
    expect(deps.worker).toBeDefined();
    expect(deps.recover).toBeDefined();
    expect(deps.queryJob).toBeDefined();
    expect(deps.getTranscript).toBeDefined();
    expect(deps.askWeather).toBeDefined();
    expect(deps.logger).toBeDefined();
    expect(deps.ids).toBeDefined();
    expect(deps.clock).toBeDefined();
  });
});
