import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GetTranscript } from '../../src/application/get-transcript.js';
import { QueryJob } from '../../src/application/query-job.js';
import { SubmitAudio } from '../../src/application/submit-audio.js';
import type { AudioDurationProbe } from '../../src/domain/ports.js';
import { MemoryJobQueue } from '../../src/infrastructure/queue/memory-job-queue.js';
import { FileJobRepository } from '../../src/infrastructure/repository/file-job-repository.js';
import { LocalFileStore } from '../../src/infrastructure/storage/file-store.js';
import { createApp } from '../../src/interfaces/http/app.js';
import type { Clock } from '../../src/shared/clock.js';
import { systemIdGenerator } from '../../src/shared/ids.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

class FakeLogger implements Logger {
  readonly calls: LogFields[] = [];
  debug(f: LogFields): void {
    this.calls.push({ ...f, level: 'debug' });
  }
  info(f: LogFields): void {
    this.calls.push({ ...f, level: 'info' });
  }
  warn(f: LogFields): void {
    this.calls.push({ ...f, level: 'warn' });
  }
  error(f: LogFields): void {
    this.calls.push({ ...f, level: 'error' });
  }
}

/** 最小合法 mp3(ID3v2 头)。 */
function mp3Bytes(): Uint8Array<ArrayBuffer> {
  const view = new Uint8Array(12);
  view.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00]);
  return view;
}

interface TestContext {
  baseUrl: string;
  close: () => Promise<void>;
  tempDir: string;
  jobs: FileJobRepository;
  files: LocalFileStore;
}

async function buildTestApp(): Promise<TestContext> {
  const tempDir = await mkdtemp(join(tmpdir(), 'b2-route-'));
  const clock: Clock = { now: () => '2026-08-24T08:00:00.000Z' };
  const logger = new FakeLogger();
  const ids = systemIdGenerator;
  const files = new LocalFileStore(tempDir);
  const jobs = new FileJobRepository(tempDir, clock, ids);
  const queue = new MemoryJobQueue(30, 1);
  const probe: AudioDurationProbe = { probe: async () => 60 };
  const submitAudio = new SubmitAudio({
    jobs,
    files,
    queue,
    clock,
    ids,
    logger,
    jobTtlHours: 24,
    queueMaxLength: 30,
    durationProbe: probe,
    maxAudioDurationSeconds: 3600,
  });
  const queryJob = new QueryJob({ jobs, clock, logger });
  const getTranscript = new GetTranscript({ jobs, files, logger });
  const app = createApp({
    submitAudio,
    queryJob,
    getTranscript,
    ids,
    logger,
    maxUploadBytes: 25 * 1024 * 1024,
  });
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
    tempDir,
    jobs,
    files,
  };
}

/** 走真实 POST 上传受理, 返回任务 id。 */
async function submitJob(baseUrl: string): Promise<string> {
  const form = new FormData();
  form.set('file', new Blob([mp3Bytes()], { type: 'audio/mpeg' }), 'demo.mp3');
  const res = await fetch(`${baseUrl}/api/v1/audio-jobs`, { method: 'POST', body: form });
  expect(res.status).toBe(202);
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

/** 落盘转录产物并把任务推进到 succeeded。 */
async function advanceToSucceeded(
  ctx: TestContext,
  id: string,
  content = '转录文本。',
): Promise<void> {
  const saved = await ctx.files.saveOutput({ jobId: id, kind: 'transcript', content });
  await ctx.jobs.update(id, (j) => ({
    ...j,
    status: 'succeeded',
    result: { transcriptPath: saved.path, summary: '摘要。', model: 'gpt-4o' },
  }));
}

/** 把任务置为 expired tombstone(与 CleanupExpired.tombstoneOf 相同最小化)。 */
async function tombstone(ctx: TestContext, id: string): Promise<void> {
  await ctx.jobs.update(id, (j) => ({
    id: j.id,
    requestId: j.requestId,
    status: 'expired',
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    expiresAt: j.expiresAt,
  }));
}

let ctx: TestContext;

beforeAll(async () => {
  ctx = await buildTestApp();
});

afterAll(async () => {
  await ctx.close();
  await rm(ctx.tempDir, { recursive: true, force: true });
});

describe('GET /api/v1/audio-jobs/{id}(openapi.yaml getAudioJob)', () => {
  it('queued → 200, data 含必填字段且无成功可选字段, data.requestId=创建时请求标识, 外层 requestId=当前请求', async () => {
    const id = await submitJob(ctx.baseUrl);

    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown>; requestId: string };
    expect(body.data.id).toBe(id);
    expect(body.data.status).toBe('queued');
    expect((body.data as { queryUrl: string }).queryUrl).toBe(`/api/v1/audio-jobs/${id}`);
    expect(body.data).not.toHaveProperty('transcriptUrl');
    expect(body.data).not.toHaveProperty('summary');
    expect(body.data).not.toHaveProperty('failed');
    expect(body.requestId).toBe(res.headers.get('x-request-id'));
  });

  it('succeeded → 200, 含 transcriptUrl/summary/model, 且不暴露 input/路径/哈希', async () => {
    const id = await submitJob(ctx.baseUrl);
    await advanceToSucceeded(ctx, id, '你好世界。');

    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect((body.data as { transcriptUrl: string }).transcriptUrl).toBe(
      `/api/v1/audio-jobs/${id}/transcript`,
    );
    expect((body.data as { summary: string }).summary).toBe('摘要。');
    expect((body.data as { model: string }).model).toBe('gpt-4o');
    expect(Object.keys(body.data)).not.toContain('input');
    expect(Object.keys(body.data)).not.toContain('idempotencyKey');
    expect(JSON.stringify(body)).not.toContain('/tmp/');
  });

  it('failed → 200, failure { code, message }(失败可查询)', async () => {
    const id = await submitJob(ctx.baseUrl);
    await ctx.jobs.update(id, (j) => ({
      ...j,
      status: 'failed',
      failure: { code: 'INTERNAL_ERROR', safeMessage: 'Processing failed' },
    }));

    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { failure: { code: string; message: string } } };
    expect(body.data.failure).toEqual({ code: 'INTERNAL_ERROR', message: 'Processing failed' });
  });

  it('不存在的任务 → 404 JOB_NOT_FOUND(错误信封)', async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/v1/audio-jobs/01234567-89ab-cdef-0123-456789abcdef`,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('JOB_NOT_FOUND');
    expect(body.error.message).toBe('Job not found');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('非法 id(路径注入尝试)→ 404, 不泄路径/不 500', async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/v1/audio-jobs/${encodeURIComponent('../../etc/passwd')}`,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('JOB_NOT_FOUND');
  });

  it('expired tombstone → 410 JOB_EXPIRED', async () => {
    const id = await submitJob(ctx.baseUrl);
    await tombstone(ctx, id);

    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${id}`);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('JOB_EXPIRED');
  });
});

describe('GET /api/v1/audio-jobs/{id}/transcript(openapi.yaml downloadTranscript)', () => {
  it('succeeded → 200 text/plain 纯文本(非 JSON 信封), 带 X-Request-Id 头', async () => {
    const id = await submitJob(ctx.baseUrl);
    await advanceToSucceeded(ctx, id, '这是转录文本。\n第二行。');

    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${id}/transcript`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')?.startsWith('text/plain')).toBe(true);
    await expect(res.text()).resolves.toBe('这是转录文本。\n第二行。');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('queued → 409 JOB_NOT_READY', async () => {
    const id = await submitJob(ctx.baseUrl);
    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${id}/transcript`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('JOB_NOT_READY');
  });

  it('failed → 409 JOB_NOT_READY', async () => {
    const id = await submitJob(ctx.baseUrl);
    await ctx.jobs.update(id, (j) => ({
      ...j,
      status: 'failed',
      failure: { code: 'INTERNAL_ERROR', safeMessage: 'Processing failed' },
    }));
    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${id}/transcript`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('JOB_NOT_READY');
  });

  it('succeeded 但产物文件缺失(清理窗口)→ 409 JOB_NOT_READY', async () => {
    const id = await submitJob(ctx.baseUrl);
    // 直接把状态置为 succeeded 但不落盘产物文件(read 时 ENOENT)
    await ctx.jobs.update(id, (j) => ({
      ...j,
      status: 'succeeded',
      result: {
        transcriptPath: join(ctx.tempDir, 'outputs', id, 'transcript.txt'),
        summary: '摘要。',
        model: 'gpt-4o',
      },
    }));
    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${id}/transcript`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('JOB_NOT_READY');
  });

  it('不存在的任务 → 404', async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/v1/audio-jobs/01234567-89ab-cdef-0123-456789abcdef/transcript`,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('JOB_NOT_FOUND');
  });

  it('expired tombstone → 410', async () => {
    const id = await submitJob(ctx.baseUrl);
    await tombstone(ctx, id);
    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs/${id}/transcript`);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('JOB_EXPIRED');
  });
});
