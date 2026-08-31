import { describe, expect, it } from 'vitest';
import type { DomainError } from '../../src/domain/errors.js';
import { parseWeatherRequest } from '../../src/interfaces/http/schemas/weather-request.js';

describe('parseWeatherRequest', () => {
  it('接受合法地点并在验证后 trim 首尾空白', () => {
    expect(parseWeatherRequest({ location: '  Shanghai  ' })).toEqual({ location: 'Shanghai' });
  });

  it.each([
    ['空白字符串', { location: '   ' }],
    ['非字符串', { location: 42 }],
    ['额外字段', { location: 'Shanghai', extra: true }],
    ['数组', ['Shanghai']],
    ['缺少 location', {}],
    ['原始长度超过 200', { location: `${' '.repeat(199)}ab` }],
  ])('拒绝%s', (_name, body) => {
    expect(() => parseWeatherRequest(body)).toThrow(
      expect.objectContaining<Partial<DomainError>>({ code: 'INVALID_LOCATION' }),
    );
  });

  it('允许原始长度恰好 200 的非空白地点', () => {
    expect(parseWeatherRequest({ location: `${' '.repeat(199)}x` })).toEqual({ location: 'x' });
  });
});
