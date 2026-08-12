import { describe, expect, it } from 'vitest';
import { systemClock } from '../../src/shared/clock.js';
import { systemIdGenerator } from '../../src/shared/ids.js';

describe('shared 工具(ids/clock)', () => {
  it('systemIdGenerator.nextId() 多次调用互不相同且非空', () => {
    const ids = new Set(Array.from({ length: 100 }, () => systemIdGenerator.nextId()));
    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('systemClock.now() 是合法 ISO 8601 日期字符串', () => {
    const s = systemClock.now();
    expect(new Date(s).toISOString()).toBe(s);
    expect(Number.isNaN(Date.parse(s))).toBe(false);
  });
});
