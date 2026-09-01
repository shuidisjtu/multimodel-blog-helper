import { type ApiSuccess, postJson } from './http';

export interface WeatherDto {
  location: string;
  tempC: number;
  description: string;
}

function isWeatherDto(value: unknown): value is WeatherDto {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const weather = value as Record<string, unknown>;
  return (
    typeof weather.location === 'string' &&
    typeof weather.tempC === 'number' &&
    Number.isFinite(weather.tempC) &&
    typeof weather.description === 'string'
  );
}

export function getWeather(location: string): Promise<ApiSuccess<WeatherDto>> {
  return postJson('/api/v1/assistant/weather', { location }, isWeatherDto);
}
