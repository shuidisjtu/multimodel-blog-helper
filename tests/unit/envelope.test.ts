import { describe, expect, it } from 'vitest';
import {
  errorEnvelope,
  jobView,
  submissionData,
  successEnvelope,
} from '../../src/interfaces/http/envelope.js';

describe('HTTP 信封(openapi.yaml §components.schemas)', () => {
  it('successEnvelope: { data, requestId }', () => {
    expect(successEnvelope({ id: 'job-1' }, 'req-1')).toEqual({
      data: { id: 'job-1' },
      requestId: 'req-1',
    });
  });

  it('errorEnvelope: { error: { code, message }, requestId }', () => {
    expect(errorEnvelope('FILE_TOO_LARGE', 'File is too large', 'req-1')).toEqual({
      error: { code: 'FILE_TOO_LARGE', message: 'File is too large' },
      requestId: 'req-1',
    });
  });

  it('submissionData: 派生 queryUrl 与 replayed 标记(AudioJobSubmission)', () => {
    expect(submissionData({ id: 'job_abc', status: 'queued' }, false)).toEqual({
      id: 'job_abc',
      status: 'queued',
      queryUrl: '/api/v1/audio-jobs/job_abc',
      replayed: false,
    });
    expect(submissionData({ id: 'job_abc', status: 'transcribing' }, true).replayed).toBe(true);
  });

  it('jobView: succeeded → 全字段(JobView, 含 transcriptUrl/summary/model), 且不泄漏内部字段', () => {
    const view = jobView({
      id: 'job-1',
      requestId: 'req-1',
      status: 'succeeded',
      createdAt: '2026-08-24T08:00:00.000Z',
      updatedAt: '2026-08-24T08:00:10.000Z',
      expiresAt: '2026-08-25T08:00:00.000Z',
      result: { summary: '要点', model: 'gpt-4o', transcriptPath: '/secret/path/t.txt' },
    });
    expect(view).toEqual({
      id: 'job-1',
      requestId: 'req-1',
      status: 'succeeded',
      createdAt: '2026-08-24T08:00:00.000Z',
      updatedAt: '2026-08-24T08:00:10.000Z',
      expiresAt: '2026-08-25T08:00:00.000Z',
      queryUrl: '/api/v1/audio-jobs/job-1',
      transcriptUrl: '/api/v1/audio-jobs/job-1/transcript',
      summary: '要点',
      model: 'gpt-4o',
    });
    expect(Object.keys(view)).not.toContain('input');
    expect(Object.keys(view)).not.toContain('idempotencyKey');
  });

  it('jobView: failed → failure { code, message: safeMessage }', () => {
    const view = jobView({
      id: 'job-2',
      requestId: 'req-2',
      status: 'failed',
      createdAt: '2026-08-24T08:00:00.000Z',
      updatedAt: '2026-08-24T08:00:05.000Z',
      expiresAt: '2026-08-25T08:00:00.000Z',
      failure: { code: 'WEATHER_UNAVAILABLE', safeMessage: 'Weather service is unavailable' },
    });
    expect(view.failure).toEqual({
      code: 'WEATHER_UNAVAILABLE',
      message: 'Weather service is unavailable',
    });
    expect(view).not.toHaveProperty('transcriptUrl');
    expect(view).not.toHaveProperty('summary');
  });

  it('jobView: queued → 仅必填字段', () => {
    const view = jobView({
      id: 'job-3',
      requestId: 'req-3',
      status: 'queued',
      createdAt: '2026-08-24T08:00:00.000Z',
      updatedAt: '2026-08-24T08:00:00.000Z',
      expiresAt: '2026-08-25T08:00:00.000Z',
    });
    expect(view).toEqual({
      id: 'job-3',
      requestId: 'req-3',
      status: 'queued',
      createdAt: '2026-08-24T08:00:00.000Z',
      updatedAt: '2026-08-24T08:00:00.000Z',
      expiresAt: '2026-08-25T08:00:00.000Z',
      queryUrl: '/api/v1/audio-jobs/job-3',
    });
  });
});
