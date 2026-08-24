import { describe, expect, it } from 'vitest';
import {
  errorEnvelope,
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
});
