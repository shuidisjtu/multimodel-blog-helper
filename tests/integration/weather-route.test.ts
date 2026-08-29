import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AskWeather } from '../../src/application/ask-weather.js';
import type { AppConfig } from '../../src/bootstrap/config.js';
import { buildContainer } from '../../src/bootstrap/container.js';
import { DomainError } from '../../src/domain/errors.js';
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

async function post(baseUrl: string, body: string): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${baseUrl}/api/v1/assistant/weather`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  return { response, body: await response.json() };
}

describe('POST /api/v1/assistant/weather(openapi.yaml getWeather)', () => {
  let ctx: Context;

  beforeAll(async () => {
    ctx = await startApp({
      current: async (location) => ({ location, tempC: 27.5, description: 'Partly cloudy' }),
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('valid location → 200 Weather envelope and matching request id header', async () => {
    const { response, body } = await post(ctx.baseUrl, JSON.stringify({ location: ' Shanghai ' }));
    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: { location: 'Shanghai', tempC: 27.5, description: 'Partly cloudy' },
      requestId: response.headers.get('x-request-id'),
    });
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it.each([
    ['missing location', '{}'],
    ['blank location', JSON.stringify({ location: '  ' })],
    ['non-string location', JSON.stringify({ location: 42 })],
    ['oversized location', JSON.stringify({ location: 'x'.repeat(201) })],
    ['additional property', JSON.stringify({ location: 'Shanghai', extra: true })],
  ])('%s → 422 INVALID_LOCATION', async (_name, body) => {
    const { response, body: result } = await post(ctx.baseUrl, body);
    expect(response.status).toBe(422);
    expect(result).toEqual({
      error: { code: 'INVALID_LOCATION', message: 'Invalid location' },
      requestId: response.headers.get('x-request-id'),
    });
  });

  it('malformed JSON → 422 INVALID_LOCATION', async () => {
    const { response, body } = await post(ctx.baseUrl, '{"location":');
    expect(response.status).toBe(422);
    expect(body).toMatchObject({ error: { code: 'INVALID_LOCATION' } });
  });

  it('provider INVALID_LOCATION → 422 with stable message and no detail', async () => {
    const blocked = await startApp({
      current: async () => {
        throw new DomainError('INVALID_LOCATION', 'wttr raw body: secret');
      },
    });
    try {
      const { response, body } = await post(blocked.baseUrl, JSON.stringify({ location: 'Nope' }));
      expect(response.status).toBe(422);
      expect(body).toEqual({
        error: { code: 'INVALID_LOCATION', message: 'Invalid location' },
        requestId: response.headers.get('x-request-id'),
      });
      expect(JSON.stringify(body)).not.toContain('secret');
    } finally {
      await blocked.close();
    }
  });

  it('provider WEATHER_UNAVAILABLE → 503 with stable message and no detail', async () => {
    const blocked = await startApp({
      current: async () => {
        throw new DomainError('WEATHER_UNAVAILABLE', 'wttr raw body: secret');
      },
    });
    try {
      const { response, body } = await post(
        blocked.baseUrl,
        JSON.stringify({ location: 'Shanghai' }),
      );
      expect(response.status).toBe(503);
      expect(body).toEqual({
        error: { code: 'WEATHER_UNAVAILABLE', message: 'Weather service is unavailable' },
        requestId: response.headers.get('x-request-id'),
      });
      expect(JSON.stringify(body)).not.toContain('secret');
    } finally {
      await blocked.close();
    }
  });
});
