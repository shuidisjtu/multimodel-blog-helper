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

function config(corsAllowedOrigins: string[]): AppConfig {
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
    security: { trustProxy: false, corsAllowedOrigins },
    metrics: { port: 9100 },
    logLevel: 'error',
  };
}

interface Context {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startApp(corsAllowedOrigins: string[]): Promise<Context> {
  const appConfig = config(corsAllowedOrigins);
  const logger = new FakeLogger();
  const deps = buildContainer(appConfig);
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
    maxUploadBytes: appConfig.storage.maxUploadBytes,
    trustProxy: appConfig.security.trustProxy,
    corsAllowedOrigins: appConfig.security.corsAllowedOrigins,
    // 本测试聚焦 CORS, 限流阈值放大避免干扰
    rateLimitUploadPerMinute: 1000,
    rateLimitWeatherPerMinute: 1000,
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

function postWeather(origin: string | undefined): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin === undefined ? {} : { Origin: origin }),
    },
    body: JSON.stringify({ location: 'Shanghai' }),
  };
}

function preflight(origin: string): RequestInit {
  return {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type, idempotency-key',
    },
  };
}

const WHITELIST = ['https://app.example.com', 'https://admin.example.com'] as const;
const [APP_ORIGIN, ADMIN_ORIGIN] = WHITELIST;

describe('白名单 CORS(B6: 默认同源; 仅白名单 Origin 获允许头; 不配通配符 *)', () => {
  let ctx: Context;

  beforeAll(async () => {
    ctx = await startApp([...WHITELIST]);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('白名单 Origin 普通请求: 返回对应 Access-Control-Allow-Origin', async () => {
    const response = await fetch(
      `${ctx.baseUrl}/api/v1/assistant/weather`,
      postWeather(APP_ORIGIN),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('白名单 Origin 预检成功: 204 且带允许方法/请求头', async () => {
    const response = await fetch(
      `${ctx.baseUrl}/api/v1/assistant/weather`,
      preflight(ADMIN_ORIGIN),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ADMIN_ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'content-type',
    );
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('非白名单 Origin: 业务请求照常处理但不返回 CORS 允许头', async () => {
    const response = await fetch(
      `${ctx.baseUrl}/api/v1/assistant/weather`,
      postWeather('https://evil.example.com'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('非白名单 Origin 预检: 不返回 CORS 允许头', async () => {
    const response = await fetch(
      `${ctx.baseUrl}/api/v1/assistant/weather`,
      preflight('https://evil.example.com'),
    );
    // 预检未被 CORS 中间件承办(Express 自动 OPTIONS 响应), 不提供任何跨域允许头
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-methods')).toBeNull();
    expect(response.status).not.toBe(204);
  });

  it('无 Origin 头(同源): 正常处理且无 CORS 允许头', async () => {
    const response = await fetch(`${ctx.baseUrl}/api/v1/assistant/weather`, postWeather(undefined));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('默认同源(B6: CORS_ALLOWED_ORIGINS 为空时不返回任何允许头)', () => {
  let ctx: Context;

  beforeAll(async () => {
    ctx = await startApp([]);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('任何 Origin 均不获得 CORS 允许头, 业务请求正常', async () => {
    const response = await fetch(
      `${ctx.baseUrl}/api/v1/assistant/weather`,
      postWeather('https://app.example.com'),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
