import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type B7TestSystem,
  createB7TestSystem,
  deferred,
  FakeSummarizer,
  FakeTranscriber,
} from './support/b7-test-system.js';

const AUDIO_FIXTURE = new URL('../../fixtures/audio-sample.mp3', import.meta.url);
const TRANSCRIPT = 'B7 deterministic transcript';
const SUMMARY = '- B7 deterministic summary';

const openSystems = new Set<B7TestSystem>();

afterEach(async () => {
  for (const system of openSystems) {
    await system.close();
  }
  openSystems.clear();
});

function track(system: B7TestSystem): B7TestSystem {
  openSystems.add(system);
  return system;
}

async function fixtureBytes(): Promise<Buffer> {
  return readFile(AUDIO_FIXTURE);
}

function uploadForm(bytes: Uint8Array<ArrayBufferLike>): FormData {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }), 'fixture.mp3');
  return form;
}

async function upload(
  system: B7TestSystem,
  bytes: Uint8Array<ArrayBufferLike>,
  idempotencyKey?: string,
): Promise<Response> {
  const headers = idempotencyKey === undefined ? undefined : { 'Idempotency-Key': idempotencyKey };
  return fetch(`${system.baseUrl}/api/v1/audio-jobs`, {
    method: 'POST',
    headers,
    body: uploadForm(bytes),
  });
}

interface JobResponse {
  data: Record<string, unknown>;
  requestId: string;
}

async function getJob(system: B7TestSystem, id: string): Promise<JobResponse> {
  const response = await fetch(`${system.baseUrl}/api/v1/audio-jobs/${id}`);
  const body = (await response.json()) as JobResponse;
  expect(response.status).toBe(200);
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
  return body;
}

async function waitForStatus(
  system: B7TestSystem,
  id: string,
  expected: string,
  timeoutMs = 2000,
): Promise<JobResponse> {
  const deadline = Date.now() + timeoutMs;
  let last: JobResponse | undefined;
  while (Date.now() <= deadline) {
    last = await getJob(system, id);
    if (last.data.status === expected) return last;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expected}; last response: ${JSON.stringify(last)}`);
}

async function createdJobId(response: Response): Promise<string> {
  const body = (await response.json()) as { data: { id: string } };
  expect(body.data.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return body.data.id;
}

describe('B7 backend core flow', () => {
  it('uploads, observes every async state, queries summary, and downloads transcript', async () => {
    const transcribeGate = deferred<{ text: string }>();
    const summarizeGate = deferred<{ text: string }>();
    const transcriber = new FakeTranscriber({ resultGate: transcribeGate });
    const summarizer = new FakeSummarizer({
      resultGate: summarizeGate,
      expectedText: TRANSCRIPT,
    });
    const system = track(await createB7TestSystem({ transcriber, summarizer }));
    const bytes = await fixtureBytes();

    const create = await upload(system, bytes);
    expect(create.status).toBe(202);
    const createBody = (await create.json()) as {
      data: { id: string; status: string; queryUrl: string; replayed: boolean };
      requestId: string;
    };
    expect(createBody.data.status).toBe('queued');
    expect(createBody.data.replayed).toBe(false);
    expect(createBody.data.queryUrl).toBe(`/api/v1/audio-jobs/${createBody.data.id}`);
    expect(createBody.requestId).toBe(create.headers.get('x-request-id'));

    await transcriber.started.promise;
    const transcribing = await waitForStatus(system, createBody.data.id, 'transcribing');
    expect(transcribing.data.id).toBe(createBody.data.id);

    transcribeGate.resolve({ text: TRANSCRIPT });
    await summarizer.started.promise;
    const summarizing = await waitForStatus(system, createBody.data.id, 'summarizing');
    expect(summarizing.data.id).toBe(createBody.data.id);

    summarizeGate.resolve({ text: SUMMARY });
    const succeeded = await waitForStatus(system, createBody.data.id, 'succeeded');
    expect(succeeded.data.summary).toBe(SUMMARY);
    expect(succeeded.data.model).toBe('b7-fake-transcriber');
    expect(succeeded.data.transcriptUrl).toBe(
      `/api/v1/audio-jobs/${createBody.data.id}/transcript`,
    );
    expect(succeeded.data).not.toHaveProperty('input');
    expect(succeeded.data).not.toHaveProperty('idempotencyKey');
    expect(JSON.stringify(succeeded)).not.toContain(system.tempDir);

    const transcript = await fetch(
      `${system.baseUrl}/api/v1/audio-jobs/${createBody.data.id}/transcript`,
    );
    expect(transcript.status).toBe(200);
    expect(transcript.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await transcript.text()).toBe(TRANSCRIPT);
    expect(
      await readFile(join(system.tempDir, 'outputs', createBody.data.id, 'transcript.txt'), 'utf8'),
    ).toBe(TRANSCRIPT);

    const transcriberCall = transcriber.calls[0];
    const summarizerCall = summarizer.calls[0];
    expect(transcriber.calls).toHaveLength(1);
    expect(summarizer.calls).toHaveLength(1);
    expect(transcriberCall).toBeDefined();
    expect(summarizerCall).toBeDefined();
    if (transcriberCall === undefined || summarizerCall === undefined) return;
    expect(transcriberCall.jobId).toBe(createBody.data.id);
    expect(summarizerCall.jobId).toBe(createBody.data.id);
    expect(transcriberCall.mimeType).toBe('audio/mpeg');
    expect(await readFile(transcriberCall.path)).toEqual(bytes);

    const transitions = system.logger.calls
      .filter((call) => call.event === 'job.status' && call.jobId === createBody.data.id)
      .map((call) => `${String(call.from)} -> ${String(call.to)}`);
    expect(transitions).toEqual([
      'queued -> transcribing',
      'transcribing -> summarizing',
      'summarizing -> succeeded',
    ]);
  });

  it('rejects invalid audio before creating a job or invoking the model', async () => {
    const system = track(await createB7TestSystem());
    const response = await upload(system, Buffer.from('not an audio file'));
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({
      error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported media type' },
    });
    expect(system.transcriber.calls).toHaveLength(0);
    expect(
      (await readdir(join(system.tempDir, 'jobs'))).filter((name) => name.endsWith('.json')),
    ).toHaveLength(0);
  });

  it('replays the same idempotent upload and rejects a different file', async () => {
    const system = track(await createB7TestSystem());
    const bytes = await fixtureBytes();
    const different = new Uint8Array(bytes);
    different[different.length - 1] = (different[different.length - 1] ?? 0) ^ 0xff;

    const first = await upload(system, bytes, 'b7-idempotency-key');
    expect(first.status).toBe(202);
    const firstId = await createdJobId(first);
    await waitForStatus(system, firstId, 'succeeded');

    const replay = await upload(system, bytes, 'b7-idempotency-key');
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as {
      data: { id: string; replayed: boolean };
      requestId: string;
    };
    expect(replayBody.data).toEqual({
      id: firstId,
      status: 'succeeded',
      queryUrl: `/api/v1/audio-jobs/${firstId}`,
      replayed: true,
    });
    expect(replayBody.requestId).toBe(replay.headers.get('x-request-id'));

    const conflict = await upload(system, different, 'b7-idempotency-key');
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key conflict' },
    });
    expect(conflict.headers.get('x-request-id')).toBeTruthy();
    expect(system.transcriber.calls).toHaveLength(1);
    expect(
      (await readdir(join(system.tempDir, 'jobs'))).filter((name) => name.endsWith('.json')),
    ).toHaveLength(1);
  });

  it('returns QUEUE_FULL and rolls back the second upload while the first is processing', async () => {
    const transcribeGate = deferred<{ text: string }>();
    const transcriber = new FakeTranscriber({ resultGate: transcribeGate });
    const system = track(await createB7TestSystem({ queueMaxLength: 1, transcriber }));
    const bytes = await fixtureBytes();

    const first = await upload(system, bytes);
    expect(first.status).toBe(202);
    const firstId = await createdJobId(first);
    await transcriber.started.promise;
    await waitForStatus(system, firstId, 'transcribing');

    const second = await upload(system, bytes);
    expect(second.status).toBe(503);
    expect(second.headers.get('retry-after')).toBe('1');
    expect(await second.json()).toMatchObject({
      error: { code: 'QUEUE_FULL', message: 'Queue is full, retry later' },
    });
    expect(
      (await readdir(join(system.tempDir, 'jobs'))).filter((name) => name.endsWith('.json')),
    ).toHaveLength(1);
    expect(await readdir(join(system.tempDir, 'uploads'))).toHaveLength(1);

    transcribeGate.resolve({ text: TRANSCRIPT });
    await waitForStatus(system, firstId, 'succeeded');
  });

  it('applies independent upload and weather rate limits without limiting queries', async () => {
    const bytes = await fixtureBytes();
    const uploadSystem = track(await createB7TestSystem({ uploadLimit: 1 }));
    const firstUpload = await upload(uploadSystem, bytes);
    expect(firstUpload.status).toBe(202);
    const firstId = await createdJobId(firstUpload);
    await waitForStatus(uploadSystem, firstId, 'succeeded');

    const limitedUpload = await upload(uploadSystem, bytes);
    expect(limitedUpload.status).toBe(429);
    expect(Number(limitedUpload.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await limitedUpload.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect((await getJob(uploadSystem, firstId)).data.status).toBe('succeeded');

    const weatherSystem = track(await createB7TestSystem({ weatherLimit: 1 }));
    const firstWeather = await fetch(`${weatherSystem.baseUrl}/api/v1/assistant/weather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: 'Shanghai' }),
    });
    expect(firstWeather.status).toBe(200);
    const limitedWeather = await fetch(`${weatherSystem.baseUrl}/api/v1/assistant/weather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: 'Shanghai' }),
    });
    expect(limitedWeather.status).toBe(429);
    expect(Number(limitedWeather.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await limitedWeather.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(weatherSystem.weather.calls).toEqual(['Shanghai']);
  });

  it('returns stable weather success and safe failure envelopes', async () => {
    const system = track(await createB7TestSystem());
    const request = (location: string) =>
      fetch(`${system.baseUrl}/api/v1/assistant/weather`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location }),
      });

    const success = await request('Shanghai');
    expect(success.status).toBe(200);
    const successBody = (await success.json()) as {
      data: Record<string, unknown>;
      requestId: string;
    };
    expect(successBody.data).toEqual({
      location: 'Shanghai',
      tempC: 23,
      description: 'B7 fake clear sky',
    });
    expect(successBody.requestId).toBe(success.headers.get('x-request-id'));

    const invalid = await request('Unknown');
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({
      error: { code: 'INVALID_LOCATION', message: 'Invalid location' },
    });

    const unavailable = await request('Broken');
    expect(unavailable.status).toBe(503);
    const unavailableText = await unavailable.text();
    expect(unavailableText).toContain('WEATHER_UNAVAILABLE');
    expect(unavailableText).not.toContain('upstream secret');
    expect(unavailableText).not.toContain('wttr.in');
    expect(unavailable.headers.get('x-request-id')).toBeTruthy();
  });

  it('handles CORS allow, deny, default same-origin, and preflight without business calls', async () => {
    const system = track(
      await createB7TestSystem({ corsAllowedOrigins: ['https://allowed.example'] }),
    );
    const preflight = await fetch(`${system.baseUrl}/api/v1/assistant/weather`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://allowed.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://allowed.example');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Content-Type');
    expect(system.weather.calls).toHaveLength(0);

    const allowed = await fetch(`${system.baseUrl}/api/v1/assistant/weather`, {
      method: 'POST',
      headers: {
        Origin: 'https://allowed.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ location: 'Shanghai' }),
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://allowed.example');

    const denied = await fetch(`${system.baseUrl}/api/v1/assistant/weather`, {
      method: 'POST',
      headers: {
        Origin: 'https://denied.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ location: 'Shanghai' }),
    });
    expect(denied.status).toBe(200);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();

    const sameOriginSystem = track(await createB7TestSystem());
    const sameOrigin = await fetch(`${sameOriginSystem.baseUrl}/api/v1/assistant/weather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: 'Shanghai' }),
    });
    expect(sameOrigin.status).toBe(200);
    expect(sameOrigin.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('records a processing failure as a queryable failed job', async () => {
    const summarizer = new FakeSummarizer();
    const failingTranscriber = new FakeTranscriber({
      error: new Error('sensitive upstream failure'),
    });
    const system = track(await createB7TestSystem({ transcriber: failingTranscriber, summarizer }));

    const response = await upload(system, await fixtureBytes());
    expect(response.status).toBe(202);
    const id = await createdJobId(response);
    const failed = await waitForStatus(system, id, 'failed');
    expect(failed.data.failure).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Processing failed',
    });
    expect(JSON.stringify(failed)).not.toContain('sensitive upstream failure');
    expect(summarizer.calls).toHaveLength(0);
  });
});
