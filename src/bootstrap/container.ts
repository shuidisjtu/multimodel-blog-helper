/**
 * 依赖组装(架构文档 §3.1 bootstrap 职责): 配置 → 基础设施 → 用例 → worker/recover。
 * 业务依赖全部经此单点注入, 禁止在其他文件 new 基础设施实例。
 */
import OpenAI from 'openai';
import { GetTranscript } from '../application/get-transcript.js';
import { ProcessJob } from '../application/process-job.js';
import { ProcessJobWorker } from '../application/process-job-worker.js';
import { QueryJob } from '../application/query-job.js';
import { RecoverJobs } from '../application/recover-jobs.js';
import { SubmitAudio } from '../application/submit-audio.js';
import { MusicMetadataDurationProbe } from '../infrastructure/common/music-metadata-duration-probe.js';
import { ResponsesSummarizer } from '../infrastructure/openai/summarizer.js';
import { OpenAITranscriber } from '../infrastructure/openai/transcriber.js';
import { MemoryJobQueue } from '../infrastructure/queue/memory-job-queue.js';
import { FileJobRepository } from '../infrastructure/repository/file-job-repository.js';
import { LocalFileStore } from '../infrastructure/storage/file-store.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import type { IdGenerator } from '../shared/ids.js';
import { systemIdGenerator } from '../shared/ids.js';
import type { Logger } from '../shared/logger.js';
import { createLogger } from '../shared/logger.js';
import type { AppConfig } from './config.js';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  clock: Clock;
  ids: IdGenerator;
  submitAudio: SubmitAudio;
  queryJob: QueryJob;
  getTranscript: GetTranscript;
  processJob: ProcessJob;
  worker: ProcessJobWorker;
  recover: RecoverJobs;
}

export function buildContainer(config: AppConfig): AppDependencies {
  const ids: IdGenerator = systemIdGenerator;
  const clock: Clock = systemClock;
  const logger = createLogger(config.logLevel);
  const files = new LocalFileStore(config.storage.tempDir);
  const jobs = new FileJobRepository(config.storage.tempDir, clock, ids);
  const queue = new MemoryJobQueue(config.queue.maxLength, config.queue.workerConcurrency);
  const durationProbe = new MusicMetadataDurationProbe(logger);
  const submitAudio = new SubmitAudio({
    jobs,
    files,
    queue,
    clock,
    ids,
    logger,
    jobTtlHours: config.storage.jobTtlHours,
    queueMaxLength: config.queue.maxLength,
    durationProbe,
    maxAudioDurationSeconds: config.limits.maxAudioDurationSeconds,
  });
  const queryJob = new QueryJob({ jobs, clock, logger });
  const getTranscript = new GetTranscript({ jobs, files, logger });
  const client = new OpenAI({ apiKey: config.openai.apiKey, baseURL: config.openai.baseUrl });
  const transcriber = new OpenAITranscriber(
    client,
    config.openai.transcribeModel,
    {
      timeoutMs: config.openai.transcribeTimeoutMs,
      maxRetries: config.openai.maxRetries,
    },
    logger,
  );
  const summarizer = new ResponsesSummarizer(
    client,
    config.openai.summaryModel,
    {
      timeoutMs: config.openai.summaryTimeoutMs,
      maxRetries: config.openai.maxRetries,
    },
    logger,
  );
  const processJob = new ProcessJob({
    jobs,
    files,
    transcriber,
    summarizer,
    logger,
    transcribeModel: config.openai.transcribeModel,
    summaryModel: config.openai.summaryModel,
  });
  const worker = new ProcessJobWorker({ queue, process: processJob, logger });
  const recover = new RecoverJobs({ jobs, queue, clock, logger });
  return {
    config,
    logger,
    clock,
    ids,
    submitAudio,
    queryJob,
    getTranscript,
    processJob,
    worker,
    recover,
  };
}
