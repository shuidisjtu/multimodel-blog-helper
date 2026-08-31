import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AjvImport, { type AnySchema } from 'ajv';
import addFormatsImport from 'ajv-formats';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { AskWeather } from '../../src/application/ask-weather.js';
import { GetTranscript } from '../../src/application/get-transcript.js';
import { QueryJob } from '../../src/application/query-job.js';
import { SubmitAudio } from '../../src/application/submit-audio.js';
import { DomainError } from '../../src/domain/errors.js';
import type { AudioDurationProbe, Weather, WeatherProvider } from '../../src/domain/ports.js';
import { MemoryJobQueue } from '../../src/infrastructure/queue/memory-job-queue.js';
import { FileJobRepository } from '../../src/infrastructure/repository/file-job-repository.js';
import { LocalFileStore } from '../../src/infrastructure/storage/file-store.js';
import { createApp } from '../../src/interfaces/http/app.js';
import type { Clock } from '../../src/shared/clock.js';
import { systemIdGenerator } from '../../src/shared/ids.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

type JsonObject = Record<string, unknown>;
const Ajv = AjvImport.default;
const addFormats = addFormatsImport.default;

class FakeLogger implements Logger {
  readonly calls: LogFields[] = [];
  debug(fields: LogFields): void {
    this.calls.push({ ...fields, level: 'debug' });
  }
  info(fields: LogFields): void {
    this.calls.push({ ...fields, level: 'info' });
  }
  warn(fields: LogFields): void {
    this.calls.push({ ...fields, level: 'warn' });
  }
  error(fields: LogFields): void {
    this.calls.push({ ...fields, level: 'error' });
  }
}

const openApi = parse(
  readFileSync(new URL('../../src/interfaces/http/openapi.yaml', import.meta.url), 'utf8'),
) as JsonObject;

function object(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected OpenAPI object');
  }
  return value as JsonObject;
}

function resolvePointer(ref: string): unknown {
  if (!ref.startsWith('#/')) throw new Error(`Only local OpenAPI references are supported: ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce<unknown>(
      (current, part) => object(current)[part.replaceAll('~1', '/').replaceAll('~0', '~')],
      openApi,
    );
}

/** 递归展开文档内 $ref，使测试直接以 openapi.yaml 的响应约束验证 wire response。 */
function dereference(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dereference);
  if (typeof value !== 'object' || value === null) return value;
  const source = object(value);
  if (typeof source.$ref === 'string') return dereference(resolvePointer(source.$ref));
  return Object.fromEntries(
    Object.entries(source).map(([key, child]) => [key, dereference(child)]),
  );
}

function operation(operationId: string): JsonObject {
  const paths = object(openApi.paths);
  for (const pathItem of Object.values(paths)) {
    for (const candidate of Object.values(object(pathItem))) {
      if (
        typeof candidate === 'object' &&
        candidate !== null &&
        !Array.isArray(candidate) &&
        object(candidate).operationId === operationId
      ) {
        return object(candidate);
      }
    }
  }
  throw new Error(`OpenAPI operation not found: ${operationId}`);
}

async function assertOpenApiResponse(
  operationId: string,
  response: Response,
  expectedStatus: number,
): Promise<void> {
  expect(response.status).toBe(expectedStatus);
  const responses = object(operation(operationId).responses);
  const declaredResponse = dereference(responses[String(expectedStatus)]);
  const responseContract = object(declaredResponse);

  for (const headerName of Object.keys(object(responseContract.headers ?? {}))) {
    expect(
      response.headers.get(headerName),
      `${operationId} must include ${headerName}`,
    ).toBeTruthy();
  }

  const content = object(responseContract.content ?? {});
  const mediaTypes = Object.keys(content);
  expect(mediaTypes).toHaveLength(1);
  const mediaType = mediaTypes[0];
  if (mediaType === undefined) throw new Error(`Missing media type for ${operationId}`);
  expect(response.headers.get('content-type')?.startsWith(mediaType)).toBe(true);

  if (mediaType === 'application/json') {
    const body = (await response.clone().json()) as unknown;
    const contentContract = object(content[mediaType]);
    const schema = contentContract.schema;
    if (schema === undefined) throw new Error(`Missing JSON schema for ${operationId}`);
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(dereference(schema) as AnySchema);
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);

    const json = object(body);
    expect(json.requestId).toBe(response.headers.get('x-request-id'));
  }

  if (operationId === 'submitAudioJob' && expectedStatus === 503) {
    expect(response.headers.get('retry-after')).toMatch(/^\d+$/);
  }
}

function mp3Bytes(extra?: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(12 + (extra ?? 0));
  bytes.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00]);
  return bytes;
}

function audioForm(bytes = mp3Bytes(), type = 'audio/mpeg'): FormData {
  const form = new FormData();
  form.set('file', new Blob([bytes], { type }), 'demo.mp3');
  return form;
}

interface TestContext {
  baseUrl: string;
  close(): Promise<void>;
  tempDir: string;
  files: LocalFileStore;
  jobs: FileJobRepository;
}

async function buildTestApp(options?: {
  durationSeconds?: number;
  maxUploadBytes?: number;
  queueMaxLength?: number;
  weather?: WeatherProvider;
}): Promise<TestContext> {
  const tempDir = await mkdtemp(join(tmpdir(), 'b5-contract-'));
  const clock: Clock = { now: () => '2026-08-30T08:00:00.000Z' };
  const logger = new FakeLogger();
  const ids = systemIdGenerator;
  const files = new LocalFileStore(tempDir);
  const jobs = new FileJobRepository(tempDir, clock, ids);
  const queueMaxLength = options?.queueMaxLength ?? 30;
  const durationProbe: AudioDurationProbe = { probe: async () => options?.durationSeconds ?? 60 };
  const submitAudio = new SubmitAudio({
    jobs,
    files,
    queue: new MemoryJobQueue(queueMaxLength, 1),
    clock,
    ids,
    logger,
    jobTtlHours: 24,
    queueMaxLength,
    durationProbe,
    maxAudioDurationSeconds: 3600,
  });
  const queryJob = new QueryJob({ jobs, clock, logger });
  const getTranscript = new GetTranscript({ jobs, files, logger });
  const weather = options?.weather ?? {
    current: async (location: string): Promise<Weather> => ({
      location,
      tempC: 20,
      description: 'Clear',
    }),
  };
  const app = createApp({
    submitAudio,
    queryJob,
    getTranscript,
    askWeather: new AskWeather({ weather, logger }),
    ids,
    logger,
    maxUploadBytes: options?.maxUploadBytes ?? 25 * 1024 * 1024,
  });
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    tempDir,
    files,
    jobs,
  };
}

async function dispose(ctx: TestContext): Promise<void> {
  await ctx.close();
  await rm(ctx.tempDir, { recursive: true, force: true });
}

async function submit(ctx: TestContext, init?: { key?: string; bytes?: Uint8Array<ArrayBuffer> }) {
  const response = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs`, {
    method: 'POST',
    headers: init?.key === undefined ? undefined : { 'Idempotency-Key': init.key },
    body: audioForm(init?.bytes),
  });
  return response;
}

async function idFrom(response: Response): Promise<string> {
  return object(object(await response.json()).data).id as string;
}

async function markSucceeded(ctx: TestContext, id: string): Promise<void> {
  const transcript = await ctx.files.saveOutput({
    jobId: id,
    kind: 'transcript',
    content: '转录内容。',
  });
  await ctx.jobs.update(id, (job) => ({
    ...job,
    status: 'succeeded',
    result: { transcriptPath: transcript.path, summary: '摘要。', model: 'gpt-4o' },
  }));
}

async function markExpired(ctx: TestContext, id: string): Promise<void> {
  await ctx.jobs.update(id, (job) => ({
    id: job.id,
    requestId: job.requestId,
    status: 'expired',
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
  }));
}

let ctx: TestContext;

beforeAll(async () => {
  ctx = await buildTestApp();
});

afterAll(async () => {
  await dispose(ctx);
});

describe('OpenAPI response contracts: audio submission', () => {
  it('validates 202 creation and 200 idempotent replay from OpenAPI', async () => {
    const created = await submit(ctx, { key: 'replay-key' });
    await assertOpenApiResponse('submitAudioJob', created, 202);
    const replayed = await submit(ctx, { key: 'replay-key' });
    await assertOpenApiResponse('submitAudioJob', replayed, 200);
  });

  it.each([
    ['invalid file', () => new FormData()],
    ['unsupported media type', () => audioForm(mp3Bytes(), 'text/plain')],
  ])('validates %s error response', async (_name, form) => {
    const response = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs`, {
      method: 'POST',
      body: form(),
    });
    await assertOpenApiResponse('submitAudioJob', response, _name === 'invalid file' ? 400 : 415);
  });

  it('validates 400 for overlong idempotency key', async () => {
    const response = await submit(ctx, { key: 'x'.repeat(256) });
    await assertOpenApiResponse('submitAudioJob', response, 400);
    expect(object(object(await response.json()).error).code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('validates 409 conflict for different valid content with same key', async () => {
    const first = await submit(ctx, { key: 'conflict-key' });
    await assertOpenApiResponse('submitAudioJob', first, 202);
    const second = await submit(ctx, { key: 'conflict-key', bytes: mp3Bytes(1) });
    await assertOpenApiResponse('submitAudioJob', second, 409);
  });

  it('validates 413 multer size limit and 503 queue-full response', async () => {
    const small = await buildTestApp({ maxUploadBytes: 12 });
    const full = await buildTestApp({ queueMaxLength: 1 });
    try {
      await assertOpenApiResponse(
        'submitAudioJob',
        await submit(small, { bytes: mp3Bytes(1) }),
        413,
      );
      await assertOpenApiResponse('submitAudioJob', await submit(full), 202);
      await assertOpenApiResponse('submitAudioJob', await submit(full), 503);
    } finally {
      await dispose(small);
      await dispose(full);
    }
  });

  it('validates 400 AUDIO_TOO_LONG response', async () => {
    const tooLong = await buildTestApp({ durationSeconds: 3601 });
    try {
      await assertOpenApiResponse('submitAudioJob', await submit(tooLong), 400);
    } finally {
      await dispose(tooLong);
    }
  });
});

describe('OpenAPI response contracts: job query and transcript', () => {
  it('validates queued, succeeded, and failed JobView responses', async () => {
    const queuedSubmission = await submit(ctx);
    await assertOpenApiResponse('submitAudioJob', queuedSubmission, 202);
    const queuedId = await idFrom(queuedSubmission);
    await assertOpenApiResponse(
      'getAudioJob',
      await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${queuedId}`),
      200,
    );

    const succeededSubmission = await submit(ctx);
    const succeededId = await idFrom(succeededSubmission);
    await markSucceeded(ctx, succeededId);
    await assertOpenApiResponse(
      'getAudioJob',
      await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${succeededId}`),
      200,
    );

    const failedSubmission = await submit(ctx);
    const failedId = await idFrom(failedSubmission);
    await ctx.jobs.update(failedId, (job) => ({
      ...job,
      status: 'failed',
      failure: { code: 'INTERNAL_ERROR', safeMessage: 'Processing failed' },
    }));
    await assertOpenApiResponse(
      'getAudioJob',
      await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${failedId}`),
      200,
    );
  });

  it('validates job 404 and 410 responses', async () => {
    await assertOpenApiResponse(
      'getAudioJob',
      await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/123e4567-e89b-12d3-a456-426614174001`),
      404,
    );
    const submission = await submit(ctx);
    const id = await idFrom(submission);
    await markExpired(ctx, id);
    await assertOpenApiResponse(
      'getAudioJob',
      await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${id}`),
      410,
    );
  });

  it('validates transcript text success plus 409, 404, and 410 errors', async () => {
    const succeededSubmission = await submit(ctx);
    const succeededId = await idFrom(succeededSubmission);
    await markSucceeded(ctx, succeededId);
    await assertOpenApiResponse(
      'downloadTranscript',
      await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${succeededId}/transcript`),
      200,
    );

    const queuedSubmission = await submit(ctx);
    const queuedId = await idFrom(queuedSubmission);
    await assertOpenApiResponse(
      'downloadTranscript',
      await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${queuedId}/transcript`),
      409,
    );
    await assertOpenApiResponse(
      'downloadTranscript',
      await fetch(
        `${ctx.baseUrl}/api/v1/audio-jobs/123e4567-e89b-12d3-a456-426614174002/transcript`,
      ),
      404,
    );
    await markExpired(ctx, queuedId);
    await assertOpenApiResponse(
      'downloadTranscript',
      await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${queuedId}/transcript`),
      410,
    );
  });
});

describe('OpenAPI response contracts: weather', () => {
  it('validates success and HTTP DTO 422 response', async () => {
    await assertOpenApiResponse(
      'getWeather',
      await fetch(`${ctx.baseUrl}/api/v1/assistant/weather`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ location: '  Shanghai  ' }),
      }),
      200,
    );
    await assertOpenApiResponse(
      'getWeather',
      await fetch(`${ctx.baseUrl}/api/v1/assistant/weather`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ location: '   ' }),
      }),
      422,
    );
  });

  it('validates provider INVALID_LOCATION and WEATHER_UNAVAILABLE responses', async () => {
    const invalid = await buildTestApp({
      weather: {
        current: async () => Promise.reject(new DomainError('INVALID_LOCATION', 'raw provider')),
      },
    });
    const unavailable = await buildTestApp({
      weather: { current: async () => Promise.reject(new Error('upstream secret')) },
    });
    try {
      const request = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"location":"Paris"}',
      };
      await assertOpenApiResponse(
        'getWeather',
        await fetch(`${invalid.baseUrl}/api/v1/assistant/weather`, request),
        422,
      );
      await assertOpenApiResponse(
        'getWeather',
        await fetch(`${unavailable.baseUrl}/api/v1/assistant/weather`, request),
        503,
      );
    } finally {
      await dispose(invalid);
      await dispose(unavailable);
    }
  });
});
