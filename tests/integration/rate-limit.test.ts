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

interface Options {
  trustProxy?: boolean;
  uploadMax?: number;
  weatherMax?: number;
}

interface Context {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startApp(opts: Options = {}): Promise<Context> {
  const config: AppConfig = {
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
    security: { trustProxy: opts.trustProxy ?? false, corsAllowedOrigins: [] },
    metrics: { port: 9100 },
    logLevel: 'error',
  };
  const logger = new FakeLogger();
  const deps = buildContainer(config);
  const askWeather = new AskWeather({
    weather: {
      current: async (location) => ({ location, tempC: 27.5, description: 'Partly cloudy' }),
    },
    logger,
  });
  const app = createApp({
    ...deps,
    askWeather,
    logger,
    maxUploadBytes: config.storage.maxUploadBytes,
    trustProxy: config.security.trustProxy,
    corsAllowedOrigins: config.security.corsAllowedOrigins,
    rateLimitUploadPerMinute: opts.uploadMax ?? config.limits.rateLimitUploadPerMinute,
    rateLimitWeatherPerMinute: opts.weatherMax ?? config.limits.rateLimitWeatherPerMinute,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function postWeather(
  baseUrl: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/assistant/weather`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ location: 'Shanghai' }),
  });
}

/** 上传受理(无效请求: 不带 file 字段, 业务返回 400, 同样消耗限流额度)。 */
async function postUpload(
  baseUrl: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/audio-jobs`, { method: 'POST', headers, body: new FormData() });
}

function expectNoRateLimitHeaders(response: Response): void {
  for (const name of [
    'ratelimit',
    'ratelimit-limit',
    'ratelimit-remaining',
    'ratelimit-reset',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
  ]) {
    expect(response.headers.get(name), name).toBeNull();
  }
}

describe('IP 限流(B6: 统一 429 envelope, 动态 Retry-After, 无效请求计数, 默认不信任 XFF)', () => {
  let ctx: Context;

  beforeAll(async () => {
    ctx = await startApp(); // 默认 10/30 每 60 秒
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('天气接口: 30 次全部成功, 第 31 次返回统一 429 envelope', async () => {
    for (let i = 0; i < 30; i += 1) {
      const response = await postWeather(ctx.baseUrl);
      expect(response.status, `request #${i + 1}`).toBe(200);
    }
    const response = await postWeather(ctx.baseUrl);
    expect(response.status).toBe(429);
    expect(response.headers.get('x-request-id')).toBeTruthy();
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(response.headers.get('retry-after')).toMatch(/^\d+$/);
    expectNoRateLimitHeaders(response);
    const body = (await response.json()) as {
      error: { code: string; message: string };
      requestId: string;
    };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toBe('Too many requests');
    expect(body.requestId).toBe(response.headers.get('x-request-id'));
  });

  it('上传接口: 无效请求也计数 —— 10 次 400 后第 11 次 429', async () => {
    for (let i = 0; i < 10; i += 1) {
      const response = await postUpload(ctx.baseUrl);
      expect(response.status, `request #${i + 1}`).toBe(400);
    }
    const response = await postUpload(ctx.baseUrl);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toMatch(/^\d+$/);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'RATE_LIMITED' },
    });
  });

  it('查询接口不计入额度: 36 次 GET 均非 429', async () => {
    for (let i = 0; i < 36; i += 1) {
      const response = await fetch(
        `${ctx.baseUrl}/api/v1/audio-jobs/00000000-1111-2222-3333-444444444444`,
      );
      expect(response.status, `request #${i + 1}`).toBe(404); // 不存在 → 404, 而非 429
    }
  });

  it('默认不信任伪造 X-Forwarded-For: 打满后携带伪 XFF 仍 429', async () => {
    const response = await postWeather(ctx.baseUrl, { 'x-forwarded-for': '203.0.113.7' });
    expect(response.status).toBe(429);
  });

  it('XFF 头不带时走 socket 地址(IPv4-mapped 规范化后仍按同一客户端计数)', async () => {
    // 天气额度已被上一个用例打满并保持(同 ip 归一化), 此处直接确认持续 429
    const response = await fetch(`${ctx.baseUrl}/api/v1/assistant/weather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: 'Beijing' }),
    });
    expect(response.status).toBe(429);
  });
});

describe('TRUST_PROXY(B6: 显式配置限流按 X-Forwarded-For 首段计 IP)', () => {
  let ctx: Context;

  beforeAll(async () => {
    ctx = await startApp({ trustProxy: true, uploadMax: 10, weatherMax: 3 });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('同 XFF 客户端独立额度: 3 次成功后第 4 次 429', async () => {
    for (let i = 0; i < 3; i += 1) {
      const response = await postWeather(ctx.baseUrl, { 'x-forwarded-for': '203.0.113.9' });
      expect(response.status, `request #${i + 1}`).toBe(200);
    }
    const exceeded = await postWeather(ctx.baseUrl, { 'x-forwarded-for': '203.0.113.9' });
    expect(exceeded.status).toBe(429);
  });

  it('不同 XFF IP 互不影响: 其他客户端仍可用真实限额', async () => {
    const response = await postWeather(ctx.baseUrl, { 'x-forwarded-for': '203.0.113.10' });
    expect(response.status).toBe(200);
  });
});
