import { DomainError } from '../../../domain/errors.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/** 空白 header 与未提供 header 语义相同；非空值以 trim 后的规范化值参与幂等判定。 */
export function parseIdempotencyKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;

  const normalized = raw.trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new DomainError('INVALID_IDEMPOTENCY_KEY', 'Invalid Idempotency-Key');
  }
  return normalized;
}
