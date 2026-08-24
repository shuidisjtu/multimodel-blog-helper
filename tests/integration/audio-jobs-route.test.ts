import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

/** 最小合法 mp3(ID3v2 头, 魔数校验通过; 时长效应用 fake probe 决定)。 */
function mp3Bytes(): Uint8Array<ArrayBuffer> {
  const view = new Uint8Array(12);
  view.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00]);
  return view;
}

interface TestContext {
  app: ReturnType<typeof createApp>;
  baseUrl: string;
  close: () => Promise<void>;
  tempDir: string;
  queue: MemoryJobQueue;
}

async function buildTestApp(opts?: {
  queueMaxLength?: number;
  maxUploadBytes?: number;
  probe?: AudioDurationProbe;
}): Promise<TestContext> {
  const tempDir = await mkdtemp(join(tmpdir(), 'b1-route-'));
  const clock: Clock = { now: () => '2026-08-24T08:00:00.000Z' };
  const logger = new FakeLogger();
  const ids = systemIdGenerator;
  const files = new LocalFileStore(tempDir);
  const jobs = new FileJobRepository(tempDir, clock, ids);
  const queue = new MemoryJobQueue(opts?.queueMaxLength ?? 30, 1);
  const probe: AudioDurationProbe = opts?.probe ?? { probe: async () => 60 };
  const submitAudio = new SubmitAudio({
    jobs,
    files,
    queue,
    clock,
    ids,
    logger,
    jobTtlHours: 24,
    queueMaxLength: opts?.queueMaxLength ?? 30,
    durationProbe: probe,
    maxAudioDurationSeconds: 3600,
  });
  const app = createApp({
    submitAudio,
    ids,
    logger,
    maxUploadBytes: opts?.maxUploadBytes ?? 25 * 1024 * 1024,
  });
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    tempDir,
    queue,
  };
}

let ctx: TestContext;

beforeAll(async () => {
  ctx = await buildTestApp();
});

afterAll(async () => {
  await ctx.close();
  await rm(ctx.tempDir, { recursive: true, force: true });
});

describe('POST /api/v1/audio-jobs(openapi.yaml submitAudioJob)', () => {
  it('合法音频 → 202, 返回 job id/status/queryUrl/replayed=false, X-Request-Id 体头一致', async () => {
    const form = new FormData();
    form.set('file', new Blob([mp3Bytes()], { type: 'audio/mpeg' }), 'demo.mp3');
    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs`, { method: 'POST', body: form });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      data: { id: string; status: string; queryUrl: string; replayed: boolean };
      requestId: string;
    };
    expect(body.data.status).toBe('queued');
    expect(body.data.replayed).toBe(false);
    expect(body.data.queryUrl).toBe(`/api/v1/audio-jobs/${body.data.id}`);
    expect(body.requestId).toBe(res.headers.get('x-request-id'));
    expect(ctx.queue.size()).toBe(1);
  });
});

describe('POST /api/v1/audio-jobs: 幂等与错误场景(openapi.yaml)', () => {
  function formWith(bytes: Uint8Array<ArrayBufferLike>, mime: string): FormData {
    const form = new FormData();
    // BlobPart 要求 ArrayBuffer 背衬视图; Buffer/Uint8Array<ArrayBufferLike> 不直接可赋, 复制一份(字节不变)
    form.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), 'demo.mp3');
    return form;
  }

  it('同 Idempotency-Key 同文件重放 → 200 replayed=true, 返回原 Job 且不再次入队', async () => {
    const key = 'idem-same-file';
    const first = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: formWith(mp3Bytes(), 'audio/mpeg'),
    });
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as { data: { id: string; replayed: boolean } };
    const queueAfterFirst = ctx.queue.size();

    const second = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: formWith(mp3Bytes(), 'audio/mpeg'),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      data: { id: string; replayed: boolean };
      requestId: string;
    };
    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(secondBody.data.replayed).toBe(true);
    expect(secondBody.requestId).toBe(second.headers.get('x-request-id'));
    expect(ctx.queue.size()).toBe(queueAfterFirst);
  });

  it('同 Idempotency-Key 不同文件 → 409 IDEMPOTENCY_CONFLICT', async () => {
    const key = 'idem-conflict-key';
    const bytesA = Buffer.concat([mp3Bytes(), Buffer.from([0x00])]);
    const bytesB = Buffer.concat([mp3Bytes(), Buffer.from([0xff])]);
    const first = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: formWith(bytesA, 'audio/mpeg'),
    });
    expect(first.status).toBe(202);
    const second = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: formWith(bytesB, 'audio/mpeg'),
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key conflict' },
    });
  });

  it('时长超上限 → 400 AUDIO_TOO_LONG', async () => {
    const blocked = await buildTestApp({ probe: { probe: async () => 9999 } });
    try {
      const res = await fetch(`${blocked.baseUrl}/api/v1/audio-jobs`, {
        method: 'POST',
        body: formWith(mp3Bytes(), 'audio/mpeg'),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'AUDIO_TOO_LONG' } });
    } finally {
      await blocked.close();
      await rm(blocked.tempDir, { recursive: true, force: true });
    }
  });

  it('超过大小上限; multer LIMIT_FILE_SIZE → 413', async () => {
    const small = await buildTestApp({ maxUploadBytes: 8 });
    try {
      const res = await fetch(`${small.baseUrl}/api/v1/audio-jobs`, {
        method: 'POST',
        body: formWith(mp3Bytes(), 'audio/mpeg'),
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: { code: 'FILE_TOO_LARGE' } });
    } finally {
      await small.close();
      await rm(small.tempDir, { recursive: true, force: true });
    }
  });

  it('MIME 不在白名单 → 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs`, {
      method: 'POST',
      body: formWith(mp3Bytes(), 'text/plain'),
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA_TYPE' } });
  });

  it('音频 MIME 但魔数不匹配 → 415', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs`, {
      method: 'POST',
      body: formWith(Buffer.from('not an audio file at all!!'), 'audio/mpeg'),
    });
    expect(res.status).toBe(415);
  });

  it('空文件 → 400 INVALID_FILE', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs`, {
      method: 'POST',
      body: formWith(Buffer.alloc(0), 'audio/mpeg'),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_FILE' } });
  });

  it('缺少 file 字段 → 400 INVALID_FILE', async () => {
    const form = new FormData();
    form.set('note', 'no file here');
    const res = await fetch(`${ctx.baseUrl}/api/v1/audio-jobs`, { method: 'POST', body: form });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_FILE' } });
  });

  it('队列满 → 503 QUEUE_FULL 且携带 Retry-After', async () => {
    const full = await buildTestApp({ queueMaxLength: 1 });
    try {
      const first = await fetch(`${full.baseUrl}/api/v1/audio-jobs`, {
        method: 'POST',
        body: formWith(mp3Bytes(), 'audio/mpeg'),
      });
      expect(first.status).toBe(202);
      const second = await fetch(`${full.baseUrl}/api/v1/audio-jobs`, {
        method: 'POST',
        body: formWith(mp3Bytes(), 'audio/mpeg'),
      });
      expect(second.status).toBe(503);
      expect(second.headers.get('retry-after')).toBe('1');
      expect(await second.json()).toMatchObject({ error: { code: 'QUEUE_FULL' } });
    } finally {
      await full.close();
      await rm(full.tempDir, { recursive: true, force: true });
    }
  });
});
