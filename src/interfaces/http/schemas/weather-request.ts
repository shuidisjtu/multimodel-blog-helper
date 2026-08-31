import { DomainError } from '../../../domain/errors.js';

const MAX_LOCATION_LENGTH = 200;

/**
 * 解析天气 HTTP 请求。长度和非空白检查基于原始 wire 值，成功后才标准化首尾空白。
 */
export function parseWeatherRequest(body: unknown): { location: string } {
  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, 'location')
  ) {
    throw new DomainError('INVALID_LOCATION', 'Invalid location');
  }

  const location = (body as { location?: unknown }).location;
  if (
    typeof location !== 'string' ||
    location.length === 0 ||
    location.length > MAX_LOCATION_LENGTH ||
    location.trim().length === 0
  ) {
    throw new DomainError('INVALID_LOCATION', 'Invalid location');
  }

  return { location: location.trim() };
}
