import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AskWeather } from '../../src/application/ask-weather.js';
import type { AppConfig } from '../../src/bootstrap/config.js';
import { buildContainer } from '../../src/bootstrap/container.js';
import { createApp } from '../../src/interfaces/http/app.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

class FakeLogger implements Logger {
  readonly calls: LogFields[] = [];
  debug(fields: LogFields): void {
    this.calls.push({ ...fields, level: 'debug' });
  }
  info(fields: LogFields): void {
    this.calls.push({ ...fields, level: 'info' });
  }
  warn(fields: LogFields): void {
    this.calls.push({ ...fields, level: 'warn' });
  }
  error(fields: LogFields): void {
    this.calls.push({ ...fields, level: 'error' });
  }
}

function config(): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    openai: {
      apiKey: 'test',
      baseUrl: 'https://mock.local/v1',
      transcribeModel: 'whisper-1',
      summaryModel: 'gpt-4o',
      transcribeTimeoutMs: 1000,
      summaryTimeoutMs: 1000,
      maxRetries: 0,
    },
    storage: { tempDir: 'temp', maxUploadBytes: 1024, jobTtlHours: 24 },
    weather: { baseUrl: 'https://wttr.in', timeoutMs: 1000 },
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

interface Context {
  baseUrl: string;
  close: () => Promise<void>;
  logger: FakeLogger;
}

async function startApp(provider: {
  current(location: string): Promise<{ location: string; tempC: number; description: string }>;
}): Promise<Context> {
  const logger = new FakeLogger();
  const deps = buildContainer(config());
  const askWeather = new AskWeather({ weather: provider, logger });
  const app = createApp({
    ...deps,
    askWeather,
    logger,
    maxUploadBytes: config().storage.maxUploadBytes,
    // 本测试不测限流(B6 语义见 rate-limit.test.ts), 阈值放大避免干扰
    trustProxy: false,
    corsAllowedOrigins: [],
    rateLimitUploadPerMinute: 1000,
    rateLimitWeatherPerMinute: 1000,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    logger,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

/** access 日志行(每次请求产生一条 http.access)。 */
function accessLines(logger: FakeLogger): Array<LogFields & { level: string }> {
  return logger.calls.filter((c) => c.event === 'http.access') as Array<
    LogFields & { level: string }
  >;
}

describe('访问日志(架构文档 §8.2 / B6a: http.access 记录方法/脱敏路径/状态/耗时/requestId)', () => {
  let ctx: Context;

  beforeAll(async () => {
    ctx = await startApp({
      current: async (location) => ({ location, tempC: 27.5, description: 'Partly cloudy' }),
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('成功请求: 记录路由模式路径、方法、状态、耗时与响应中相同的 requestId', async () => {
    const response = await fetch(`${ctx.baseUrl}/api/v1/assistant/weather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: 'Shanghai' }),
    });
    expect(response.status).toBe(200);
    const requestIdHeader = response.headers.get('x-request-id');
    const line = accessLines(ctx.logger).at(-1);
    expect(line).toBeTruthy();
    expect(line?.method).toBe('POST');
    expect(line?.route).toBe('/api/v1/assistant/weather');
    expect(line?.status).toBe(200);
    expect(line?.requestId).toBe(requestIdHeader);
    expect(typeof line?.durationMs).toBe('number');
    expect(line?.durationMs).toBeGreaterThanOrEqual(0);
    // 天气地点/请求体不得出现在任何日志行(嵌套脱敏兜底)
    expect(JSON.stringify(ctx.logger.calls)).not.toContain('Shanghai');
  });

  it('DomainError 请求(查询不存在 → 404): 仍记录路由模式路径', async () => {
    const response = await fetch(
      `${ctx.baseUrl}/api/v1/audio-jobs/00000000-1111-2222-3333-444444444444`,
    );
    expect(response.status).toBe(404);
    const line = accessLines(ctx.logger).at(-1);
    expect(line?.method).toBe('GET');
    expect(line?.route).toBe('/api/v1/audio-jobs/:id');
    expect(line?.status).toBe(404);
    expect(line?.requestId).toBe(response.headers.get('x-request-id'));
  });

  it('未匹配路由(404): 记录原始路径与请求方法', async () => {
    const response = await fetch(`${ctx.baseUrl}/no/such/path`);
    expect(response.status).toBe(404);
    const line = accessLines(ctx.logger).at(-1);
    expect(line?.method).toBe('GET');
    expect(line?.route).toBe('/no/such/path');
    expect(line?.status).toBe(404);
    expect(line?.requestId).toBe(response.headers.get('x-request-id'));
  });
});
