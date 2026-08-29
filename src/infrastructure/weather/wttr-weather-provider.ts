/**
 * wttr.in 天气适配器(ADR-0003): 将上游 j1 响应收敛为领域 Weather DTO。
 * 上游失败不会携带正文/URL 穿透到领域错误或 HTTP 响应。
 */
import { DomainError } from '../../domain/errors.js';
import type { Weather, WeatherProvider } from '../../domain/ports.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type WttrCurrentCondition = {
  temp_C?: unknown;
  weatherDesc?: Array<{ value?: unknown }>;
};

type WttrNearestArea = {
  areaName?: Array<{ value?: unknown }>;
};

type WttrPayload = {
  current_condition?: WttrCurrentCondition[];
  nearest_area?: WttrNearestArea[];
  error?: Array<{ msg?: unknown }>;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function finiteTemperature(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isUnknownLocationMessage(message: string): boolean {
  return /unknown location|location not found|no matching location|invalid location/i.test(message);
}

function isUnknownLocation(payload: WttrPayload): boolean {
  const message = payload.error?.map((entry) => nonEmptyString(entry.msg) ?? '').join(' ');
  return message !== undefined && isUnknownLocationMessage(message);
}

function parseWeather(payload: unknown, requestedLocation: string): Weather {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new DomainError('WEATHER_UNAVAILABLE', 'Weather service returned an invalid response');
  }
  const data = payload as WttrPayload;
  if (isUnknownLocation(data)) {
    throw new DomainError('INVALID_LOCATION', 'Invalid location');
  }
  const condition = data.current_condition?.[0];
  const tempC = finiteTemperature(condition?.temp_C);
  const description = nonEmptyString(condition?.weatherDesc?.[0]?.value);
  const location =
    nonEmptyString(data.nearest_area?.[0]?.areaName?.[0]?.value) ?? requestedLocation;
  if (tempC === undefined || description === undefined || location.trim() === '') {
    throw new DomainError('WEATHER_UNAVAILABLE', 'Weather service returned an invalid response');
  }
  return { location, tempC, description };
}

/** 用原始地点组成单一路径段，且固定 query，禁止输入改写上游 URL 的其他部分。 */
function weatherUrl(baseUrl: string, location: string): URL {
  const base = new URL(baseUrl);
  base.pathname = `${base.pathname.replace(/\/$/, '')}/${encodeURIComponent(location)}`;
  base.search = 'format=j1';
  return base;
}

export class WttrWeatherProvider implements WeatherProvider {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    fetchImpl: FetchLike = fetch,
  ) {
    this.fetchImpl = fetchImpl;
  }

  async current(location: string): Promise<Weather> {
    const normalizedLocation = location.trim();
    if (normalizedLocation === '' || normalizedLocation.length > 200) {
      throw new DomainError('INVALID_LOCATION', 'Invalid location');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(weatherUrl(this.baseUrl, normalizedLocation), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        // wttr.in 已知以 5xx text/plain 返回“location not found”；只识别这一明确地点语义。
        const body = await response.text();
        if (isUnknownLocationMessage(body)) {
          throw new DomainError('INVALID_LOCATION', 'Invalid location');
        }
        throw new DomainError('WEATHER_UNAVAILABLE', 'Weather service is unavailable');
      }
      const payload: unknown = await response.json();
      return parseWeather(payload, normalizedLocation);
    } catch (err) {
      if (err instanceof DomainError) throw err;
      throw new DomainError('WEATHER_UNAVAILABLE', 'Weather service is unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}
