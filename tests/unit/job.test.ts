import { describe, expect, it } from 'vitest';
import {
  assertCanTransition,
  canTransition,
  isTerminal,
  type JobStatus,
} from '../../src/domain/job.js';
import { JobStateError } from '../../src/domain/errors.js';

const ALL_STATUSES: JobStatus[] = [
  'queued',
  'transcribing',
  'summarizing',
  'succeeded',
  'failed',
  'expired',
];

describe('Job 状态机(架构文档 §4.1)', () => {
  it('合法迁移:queued → transcribing → summarizing → succeeded', () => {
    expect(canTransition('queued', 'transcribing')).toBe(true);
    expect(canTransition('transcribing', 'summarizing')).toBe(true);
    expect(canTransition('summarizing', 'succeeded')).toBe(true);
  });

  it('任一进行中状态可到 failed', () => {
    for (const from of ['queued', 'transcribing', 'summarizing'] as const) {
      expect(canTransition(from, 'failed')).toBe(true);
    }
  });

  it('终态(succeeded/failed)在清理后可到 expired', () => {
    expect(canTransition('succeeded', 'expired')).toBe(true);
    expect(canTransition('failed', 'expired')).toBe(true);
  });

  it('终态不得被重新处理:succeeded/failed 只能到 expired(清理),expired 不可迁移', () => {
    for (const from of ['succeeded', 'failed'] as const) {
      for (const to of ALL_STATUSES) {
        if (to === 'expired') continue; // 清理产生 expired 是唯一合法出口
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
    for (const to of ALL_STATUSES) {
      expect(canTransition('expired', to), `expired -> ${to}`).toBe(false);
    }
  });

  it('回退与跳步迁移非法:transcribing→queued、queued→summarizing', () => {
    expect(canTransition('transcribing', 'queued')).toBe(false);
    expect(canTransition('queued', 'summarizing')).toBe(false);
    expect(canTransition('queued', 'succeeded')).toBe(false);
  });

  it('assertCanTransition 对非法迁移抛出 JobStateError', () => {
    expect(() => assertCanTransition('succeeded', 'failed')).toThrow(
      JobStateError,
    );
    expect(() => assertCanTransition('expired', 'queued')).toThrow(
      'Illegal state transition: expired -> queued',
    );
  });

  it('isTerminal 只认 succeeded/failed/expired', () => {
    expect(isTerminal('succeeded')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('expired')).toBe(true);
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('transcribing')).toBe(false);
    expect(isTerminal('summarizing')).toBe(false);
  });
});
