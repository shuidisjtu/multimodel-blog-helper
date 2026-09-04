import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AskWeather } from '../../../src/application/ask-weather.js';
import { GetTranscript } from '../../../src/application/get-transcript.js';
import { ProcessJob } from '../../../src/application/process-job.js';
import { ProcessJobWorker } from '../../../src/application/process-job-worker.js';
import { QueryJob } from '../../../src/application/query-job.js';
import { RecoverJobs } from '../../../src/application/recover-jobs.js';
import { SubmitAudio } from '../../../src/application/submit-audio.js';
import { DomainError } from '../../../src/domain/errors.js';
import type {
  AudioDurationProbe,
  SummarizeParams,
  Summarizer,
  TranscribeParams,
  Transcriber,
  Transcript,
  Weather,
  WeatherProvider,
} from '../../../src/domain/ports.js';
import { MemoryJobQueue } from '../../../src/infrastructure/queue/memory-job-queue.js';
import { FileJobRepository } from '../../../src/infrastructure/repository/file-job-repository.js';
import { LocalFileStore } from '../../../src/infrastructure/storage/file-store.js';
import { createApp } from '../../../src/interfaces/http/app.js';
import type { Clock } from '../../../src/shared/clock.js';
import { systemIdGenerator } from '../../../src/shared/ids.js';
import type { LogFields, Logger } from '../../../src/shared/logger.js';

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value?: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value?: T) => resolvePromise(value as T),
    reject: rejectPromise,
  };
}

export class FakeLogger implements Logger {
  readonly calls: Array<LogFields & { level: string }> = [];

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

export class FakeTranscriber implements Transcriber {
  readonly calls: TranscribeParams[] = [];
  readonly started = deferred<void>();
  private readonly resultGate?: Deferred<Transcript>;
  private readonly result: Transcript;
  private readonly error?: unknown;

  constructor(options: { text?: string; resultGate?: Deferred<Transcript>; error?: unknown } = {}) {
    this.result = { text: options.text ?? 'B7 fake transcript' };
    this.resultGate = options.resultGate;
    this.error = options.error;
  }

  async transcribe(params: TranscribeParams): Promise<Transcript> {
    this.calls.push(params);
    this.started.resolve();
    if (this.error !== undefined) throw this.error;
    if (this.resultGate !== undefined) return this.resultGate.promise;
    return this.result;
  }
}

export class FakeSummarizer implements Summarizer {
  readonly calls: SummarizeParams[] = [];
  readonly started = deferred<void>();
  private readonly resultGate?: Deferred<{ text: string }>;
  private readonly result: { text: string };
  private readonly expectedText?: string;

  constructor(
    options: {
      text?: string;
      resultGate?: Deferred<{ text: string }>;
      expectedText?: string;
    } = {},
  ) {
    this.result = { text: options.text ?? '- B7 fake summary' };
    this.resultGate = options.resultGate;
    this.expectedText = options.expectedText;
  }

  async summarize(params: SummarizeParams): Promise<{ text: string }> {
    this.calls.push(params);
    this.started.resolve();
    if (this.expectedText !== undefined && params.text !== this.expectedText) {
      throw new Error(`unexpected transcript: ${params.text}`);
    }
    if (this.resultGate !== undefined) return this.resultGate.promise;
    return this.result;
  }
}

export class FakeWeatherProvider implements WeatherProvider {
  readonly calls: string[] = [];

  async current(location: string): Promise<Weather> {
    this.calls.push(location);
    if (location === 'Unknown') {
      throw new DomainError('INVALID_LOCATION', 'upstream invalid location details');
    }
    if (location === 'Broken') {
      throw new Error('upstream secret: https://wttr.in/Broken');
    }
    return { location, tempC: 23, description: 'B7 fake clear sky' };
  }
}

export interface B7TestSystemOptions {
  queueMaxLength?: number;
  uploadLimit?: number;
  weatherLimit?: number;
  corsAllowedOrigins?: string[];
  transcriber?: FakeTranscriber;
  summarizer?: FakeSummarizer;
  weather?: FakeWeatherProvider;
}

export interface B7TestSystem {
  readonly app: ReturnType<typeof createApp>;
  readonly baseUrl: string;
  readonly tempDir: string;
  readonly jobs: FileJobRepository;
  readonly files: LocalFileStore;
  readonly queue: MemoryJobQueue;
  readonly logger: FakeLogger;
  readonly transcriber: FakeTranscriber;
  readonly summarizer: FakeSummarizer;
  readonly weather: FakeWeatherProvider;
  close(): Promise<void>;
}

export async function createB7TestSystem(options: B7TestSystemOptions = {}): Promise<B7TestSystem> {
  const tempDir = await mkdtemp(join(tmpdir(), 'b7-core-flow-'));
  const clock: Clock = { now: () => '2026-09-04T00:00:00.000Z' };
  const logger = new FakeLogger();
  const files = new LocalFileStore(tempDir);
  const jobs = new FileJobRepository(tempDir, clock, systemIdGenerator);
  const queue = new MemoryJobQueue(options.queueMaxLength ?? 30, 1);
  const transcriber = options.transcriber ?? new FakeTranscriber();
  const summarizer = options.summarizer ?? new FakeSummarizer();
  const weather = options.weather ?? new FakeWeatherProvider();
  const durationProbe: AudioDurationProbe = { probe: async () => 60 };
  const submitAudio = new SubmitAudio({
    jobs,
    files,
    queue,
    clock,
    ids: systemIdGenerator,
    logger,
    jobTtlHours: 24,
    queueMaxLength: options.queueMaxLength ?? 30,
    durationProbe,
    maxAudioDurationSeconds: 3600,
  });
  const queryJob = new QueryJob({ jobs, clock, logger });
  const getTranscript = new GetTranscript({ jobs, files, logger });
  const askWeather = new AskWeather({ weather, logger });
  const processJob = new ProcessJob({
    jobs,
    files,
    transcriber,
    summarizer,
    logger,
    transcribeModel: 'b7-fake-transcriber',
    summaryModel: 'b7-fake-summarizer',
  });
  const worker = new ProcessJobWorker({ queue, process: processJob, logger });
  const recover = new RecoverJobs({ jobs, queue, clock, logger });
  await recover.run();
  worker.start();

  const app = createApp({
    submitAudio,
    queryJob,
    getTranscript,
    askWeather,
    ids: systemIdGenerator,
    logger,
    maxUploadBytes: 25 * 1024 * 1024,
    trustProxy: false,
    corsAllowedOrigins: options.corsAllowedOrigins ?? [],
    rateLimitUploadPerMinute: options.uploadLimit ?? 1000,
    rateLimitWeatherPerMinute: options.weatherLimit ?? 1000,
  });
  const server: Server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo | null;
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    await rm(tempDir, { recursive: true, force: true });
    throw new Error('B7 test server did not expose an address');
  }

  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    tempDir,
    jobs,
    files,
    queue,
    logger,
    transcriber,
    summarizer,
    weather,
    close: async () => {
      await closeServer(server);
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
