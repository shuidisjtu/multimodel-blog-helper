import { type ApiSuccess, getJson, getText, postForm } from './http';

export type AudioJobStatus = 'queued' | 'transcribing' | 'summarizing' | 'succeeded' | 'failed';

export interface AudioJobSubmissionDto {
  id: string;
  status: AudioJobStatus;
  queryUrl: string;
  replayed: boolean;
}

export interface PublicJobFailure {
  code: string;
  message: string;
}

export interface AudioJobDto {
  id: string;
  requestId: string;
  status: AudioJobStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  queryUrl: string;
  transcriptUrl?: string;
  summary?: string;
  model?: string;
  failure?: PublicJobFailure;
}

type UnknownRecord = Record<string, unknown>;

const JOB_STATUSES = new Set<AudioJobStatus>([
  'queued',
  'transcribing',
  'summarizing',
  'succeeded',
  'failed',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isDateTime(value: unknown): value is string {
  return isNonBlankString(value) && !Number.isNaN(Date.parse(value));
}

function isJobStatus(value: unknown): value is AudioJobStatus {
  return typeof value === 'string' && JOB_STATUSES.has(value as AudioJobStatus);
}

export function isAudioJobId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function queryPathForId(id: string): string {
  return `/api/v1/audio-jobs/${id}`;
}

function isQueryPath(value: unknown, id?: string): value is string {
  if (!isNonBlankString(value)) return false;
  const match = /^\/api\/v1\/audio-jobs\/([0-9a-f-]+)$/i.exec(value);
  return (
    match !== null &&
    isAudioJobId(match[1] ?? '') &&
    (id === undefined || match[1]?.toLowerCase() === id.toLowerCase())
  );
}

function isTranscriptPath(value: unknown, id: string): value is string {
  return value === `${queryPathForId(id)}/transcript`;
}

function isAudioJobSubmissionDto(value: unknown): value is AudioJobSubmissionDto {
  if (!isRecord(value) || !isAudioJobId(String(value.id ?? ''))) return false;
  const id = String(value.id);
  return (
    isJobStatus(value.status) &&
    isQueryPath(value.queryUrl, id) &&
    typeof value.replayed === 'boolean'
  );
}

function isPublicJobFailure(value: unknown): value is PublicJobFailure {
  return isRecord(value) && isNonBlankString(value.code) && isNonBlankString(value.message);
}

function isAudioJobDto(value: unknown): value is AudioJobDto {
  if (!isRecord(value) || !isAudioJobId(String(value.id ?? ''))) return false;
  const id = String(value.id);
  if (
    !isNonBlankString(value.requestId) ||
    !isJobStatus(value.status) ||
    !isDateTime(value.createdAt) ||
    !isDateTime(value.updatedAt) ||
    !isDateTime(value.expiresAt) ||
    !isQueryPath(value.queryUrl, id)
  ) {
    return false;
  }
  if (value.status === 'succeeded') {
    return (
      isTranscriptPath(value.transcriptUrl, id) &&
      isNonBlankString(value.summary) &&
      isNonBlankString(value.model)
    );
  }
  if (value.status === 'failed') return isPublicJobFailure(value.failure);
  return true;
}

function normalizeQueryPath(idOrPath: string): string {
  const value = idOrPath.trim();
  if (isAudioJobId(value)) return queryPathForId(value);
  if (isQueryPath(value)) return value;
  throw new Error('Invalid audio job path');
}

function normalizeTranscriptPath(path: string): string {
  const match = /^\/api\/v1\/audio-jobs\/([0-9a-f-]+)\/transcript$/i.exec(path);
  if (match === null || !isAudioJobId(match[1] ?? '')) throw new Error('Invalid transcript path');
  return path;
}

export function submitAudioJob(
  file: File,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ApiSuccess<AudioJobSubmissionDto>> {
  const form = new FormData();
  form.append('file', file);
  return postForm(
    '/api/v1/audio-jobs',
    form,
    { 'Idempotency-Key': idempotencyKey },
    isAudioJobSubmissionDto,
    { signal, acceptedStatuses: [200, 202] },
  );
}

export function getAudioJob(
  idOrPath: string,
  signal?: AbortSignal,
): Promise<ApiSuccess<AudioJobDto>> {
  return getJson(normalizeQueryPath(idOrPath), isAudioJobDto, { signal });
}

export function getTranscript(
  transcriptUrl: string,
  signal?: AbortSignal,
): Promise<ApiSuccess<string>> {
  return getText(normalizeTranscriptPath(transcriptUrl), { signal });
}
