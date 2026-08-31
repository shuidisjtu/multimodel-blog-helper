import { describe, expect, it } from 'vitest';
import type { DomainError } from '../../src/domain/errors.js';
import { parseJobId } from '../../src/interfaces/http/schemas/job-id.js';

describe('parseJobId', () => {
  it('接受服务端 UUID', () => {
    expect(parseJobId('123e4567-e89b-12d3-a456-426614174000')).toBe(
      '123e4567-e89b-12d3-a456-426614174000',
    );
  });

  it.each(['not-a-uuid', '../../etc/passwd'])('把非法 ID 统一视为不存在: %s', (raw) => {
    expect(() => parseJobId(raw)).toThrow(
      expect.objectContaining<Partial<DomainError>>({ code: 'JOB_NOT_FOUND' }),
    );
  });
});
