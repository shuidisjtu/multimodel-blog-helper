/**
 * Job 领域模型与状态机(架构文档 §4.1)。
 * 状态迁移只能由用例层完成,领域层只提供合法迁移定义。
 */
import { JobStateError } from './errors.js';

export type JobStatus =
  | 'queued'
  | 'transcribing'
  | 'summarizing'
  | 'succeeded'
  | 'failed'
  | 'expired';

export interface JobInput {
  path: string;
  originalName: string;
  mimeType: string;
  bytes: number;
  sha256: string;
}

export interface JobResult {
  transcriptPath: string;
  summary: string;
  model: string;
}

export interface JobFailure {
  code: string;
  safeMessage: string;
}

export interface BlogJob {
  id: string;
  requestId: string;
  status: JobStatus;
  input: JobInput;
  result?: JobResult;
  failure?: JobFailure;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

/** 合法迁移表:queued → transcribing → summarizing → succeeded;任一进行中状态可到 failed;终态在清理后到 expired。 */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['transcribing', 'failed'],
  transcribing: ['summarizing', 'failed'],
  summarizing: ['succeeded', 'failed'],
  succeeded: ['expired'],
  failed: ['expired'],
  expired: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** 终态(succeeded/failed/expired)不得被重新处理。 */
export function isTerminal(status: JobStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'expired';
}

export function assertCanTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new JobStateError(
      `Illegal state transition: ${from} -> ${to}`,
      from,
      to,
    );
  }
}
