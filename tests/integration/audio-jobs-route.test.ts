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
