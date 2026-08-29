import { describe, expect, it } from 'vitest';
import { AskWeather } from '../../src/application/ask-weather.js';
import { DomainError } from '../../src/domain/errors.js';
import type { WeatherProvider } from '../../src/domain/ports.js';
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

const result = { location: 'Shanghai', tempC: 27.5, description: 'Clear' };

function useCase(
  weather: WeatherProvider,
  logger = new FakeLogger(),
): { ask: AskWeather; logger: FakeLogger } {
  return { ask: new AskWeather({ weather, logger }), logger };
}

describe('AskWeather', () => {
  it('delegates to WeatherProvider and logs request-safe success', async () => {
    let received = '';
    const { ask, logger } = useCase({
      current: async (location) => {
        received = location;
        return result;
      },
    });

    await expect(ask.run({ location: 'Shanghai', requestId: 'req-1' })).resolves.toEqual(result);
    expect(received).toBe('Shanghai');
    expect(logger.calls).toContainEqual(
      expect.objectContaining({ event: 'weather.current.succeeded', requestId: 'req-1' }),
    );
  });

  it.each(['INVALID_LOCATION', 'WEATHER_UNAVAILABLE'] as const)(
    'propagates %s without changing stable error',
    async (code) => {
      const { ask } = useCase({
        current: async () => {
          throw new DomainError(code, 'raw upstream detail');
        },
      });
      await expect(ask.run({ location: 'Shanghai', requestId: 'req-2' })).rejects.toMatchObject({
        code,
      });
    },
  );

  it('maps unknown provider errors to WEATHER_UNAVAILABLE', async () => {
    const { ask, logger } = useCase({
      current: async () => {
        throw new Error('upstream private detail');
      },
    });
    const error = await ask
      .run({ location: 'Shanghai', requestId: 'req-3' })
      .catch((err: unknown) => err);

    expect(error).toMatchObject({ code: 'WEATHER_UNAVAILABLE' });
    expect(String(error)).not.toContain('private detail');
    expect(logger.calls).toContainEqual(
      expect.objectContaining({
        event: 'weather.current.failed',
        errorCode: 'WEATHER_UNAVAILABLE',
      }),
    );
  });
});
