import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../src/domain/errors.js';
import { WttrWeatherProvider } from '../../src/infrastructure/weather/wttr-weather-provider.js';

const payload = {
  current_condition: [{ temp_C: '27.5', weatherDesc: [{ value: 'Partly cloudy' }] }],
  nearest_area: [{ areaName: [{ value: 'Shanghai' }] }],
};

describe('WttrWeatherProvider(ADR-0003)', () => {
  it('encodes location, fixes format=j1, and maps only the internal Weather DTO', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://wttr.in/Shanghai%20%26%20Pudong?format=j1');
      expect(init?.headers).toEqual({ Accept: 'application/json' });
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    const provider = new WttrWeatherProvider('https://wttr.in/', 1000, fetchMock);

    await expect(provider.current(' Shanghai & Pudong ')).resolves.toEqual({
      location: 'Shanghai',
      tempC: 27.5,
      description: 'Partly cloudy',
    });
  });

  it('uses the requested location when wttr has no nearest-area label', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ current_condition: payload.current_condition }), {
          status: 200,
        }),
    );
    const provider = new WttrWeatherProvider('https://wttr.in', 1000, fetchMock);

    await expect(provider.current('Shanghai')).resolves.toEqual({
      location: 'Shanghai',
      tempC: 27.5,
      description: 'Partly cloudy',
    });
  });

  it('rejects blank or oversized locations before calling upstream', async () => {
    const fetchMock = vi.fn();
    const provider = new WttrWeatherProvider('https://wttr.in', 1000, fetchMock);

    await expect(provider.current('  ')).rejects.toMatchObject({ code: 'INVALID_LOCATION' });
    await expect(provider.current('x'.repeat(201))).rejects.toMatchObject({
      code: 'INVALID_LOCATION',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['429', 429],
    ['500', 500],
    ['404', 404],
  ])('maps upstream HTTP %s to WEATHER_UNAVAILABLE', async (_label, status) => {
    const fetchMock = vi.fn(async () => new Response('upstream secret', { status }));
    const provider = new WttrWeatherProvider('https://wttr.in', 1000, fetchMock);

    const error = await provider.current('Shanghai').catch((err: unknown) => err);
    expect(error).toMatchObject({ code: 'WEATHER_UNAVAILABLE' });
    expect(error).toBeInstanceOf(DomainError);
    expect(String(error)).not.toContain('upstream secret');
  });

  it('maps wttr known non-JSON location-not-found response to INVALID_LOCATION', async () => {
    const fetchMock = vi.fn(
      async () => new Response('location not found: private detail', { status: 500 }),
    );
    const provider = new WttrWeatherProvider('https://wttr.in', 1000, fetchMock);

    const error = await provider.current('not-a-real-place').catch((err: unknown) => err);
    expect(error).toMatchObject({ code: 'INVALID_LOCATION' });
    expect(String(error)).not.toContain('private detail');
  });
  it('maps a clear wttr unknown-location JSON error to INVALID_LOCATION', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: [{ msg: 'Unknown location' }] }), { status: 200 }),
    );
    const provider = new WttrWeatherProvider('https://wttr.in', 1000, fetchMock);

    await expect(provider.current('not-a-real-place')).rejects.toMatchObject({
      code: 'INVALID_LOCATION',
    });
  });

  it.each([
    ['malformed JSON', async () => new Response('{', { status: 200 })],
    ['missing condition', async () => new Response(JSON.stringify({}), { status: 200 })],
    [
      'invalid temperature',
      async () =>
        new Response(
          JSON.stringify({
            current_condition: [{ temp_C: 'not-a-number', weatherDesc: [{ value: 'Clear' }] }],
          }),
          { status: 200 },
        ),
    ],
  ])('maps %s to WEATHER_UNAVAILABLE without upstream detail', async (_label, response) => {
    const fetchMock = vi.fn(response);
    const provider = new WttrWeatherProvider('https://wttr.in', 1000, fetchMock);

    await expect(provider.current('Shanghai')).rejects.toMatchObject({
      code: 'WEATHER_UNAVAILABLE',
    });
  });

  it('maps network rejection to WEATHER_UNAVAILABLE', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('DNS secret and https://private.example');
    });
    const provider = new WttrWeatherProvider('https://wttr.in', 1000, fetchMock);

    const error = await provider.current('Shanghai').catch((err: unknown) => err);
    expect(error).toMatchObject({ code: 'WEATHER_UNAVAILABLE' });
    expect(String(error)).not.toContain('private.example');
  });

  it('aborts a slow upstream call at the configured timeout', async () => {
    const fetchMock = vi.fn(
      (_input: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const provider = new WttrWeatherProvider('https://wttr.in', 5, fetchMock);

    await expect(provider.current('Shanghai')).rejects.toMatchObject({
      code: 'WEATHER_UNAVAILABLE',
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
