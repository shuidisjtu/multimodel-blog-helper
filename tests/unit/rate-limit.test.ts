import { describe, expect, it } from 'vitest';
import {
  firstForwardedIp,
  retryAfterSeconds,
} from '../../src/interfaces/http/middleware/rate-limit.js';

describe('firstForwardedIp(B6b: TRUST_PROXY 时取 X-Forwarded-For 最左侧客户端地址)', () => {
  it('多段 XFF 取第一段并去除空白', () => {
    expect(firstForwardedIp('203.0.113.7, 10.0.0.1, 198.51.100.4')).toBe('203.0.113.7');
    expect(firstForwardedIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('无 XFF 头与空白头均返回 undefined(回退 socket 地址)', () => {
    expect(firstForwardedIp(undefined)).toBeUndefined();
    expect(firstForwardedIp('')).toBeUndefined();
    expect(firstForwardedIp(' , ')).toBeUndefined();
  });
});

describe('retryAfterSeconds(B6b: 动态 Retry-After, 向上取整且最小 1 秒)', () => {
  const now = 1_800_000_000_000;

  it('按重置时间剩余秒数向上取整', () => {
    expect(retryAfterSeconds(new Date(now + 30_000), 60_000, now)).toBe(30);
    expect(retryAfterSeconds(new Date(now + 59_500), 60_000, now)).toBe(60);
    expect(retryAfterSeconds(new Date(now + 1), 60_000, now)).toBe(1);
  });

  it('重置时间已过或不可用时取窗口剩余时间, 且最小为 1 秒', () => {
    expect(retryAfterSeconds(new Date(now - 5_000), 60_000, now)).toBe(1);
    expect(retryAfterSeconds(undefined, 60_000, now)).toBe(60);
  });

  it('窗口小于 1 秒时仍给 1 秒下限', () => {
    expect(retryAfterSeconds(undefined, 500, now)).toBe(1);
  });
});
