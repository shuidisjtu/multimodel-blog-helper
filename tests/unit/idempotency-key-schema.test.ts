import { describe, expect, it } from 'vitest';
import type { DomainError } from '../../src/domain/errors.js';
import { parseIdempotencyKey } from '../../src/interfaces/http/schemas/idempotency-key.js';

describe('parseIdempotencyKey', () => {
  it('把未提供和纯空白 key 归一化为未提供', () => {
    expect(parseIdempotencyKey(undefined)).toBeUndefined();
    expect(parseIdempotencyKey(' \t ')).toBeUndefined();
  });

  it('trim 合法 key 并接受规范化长度恰好 255', () => {
    expect(parseIdempotencyKey('  request-1  ')).toBe('request-1');
    expect(parseIdempotencyKey('x'.repeat(255))).toHaveLength(255);
  });

  it('拒绝规范化后长度超过 255 的 key', () => {
    expect(() => parseIdempotencyKey('x'.repeat(256))).toThrow(
      expect.objectContaining<Partial<DomainError>>({ code: 'INVALID_IDEMPOTENCY_KEY' }),
    );
  });
});
