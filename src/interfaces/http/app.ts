import express, { type Express } from 'express';
import type { AskWeather } from '../../application/ask-weather.js';
import type { GetTranscript } from '../../application/get-transcript.js';
import type { QueryJob } from '../../application/query-job.js';
import type { SubmitAudio } from '../../application/submit-audio.js';
import type { IdGenerator } from '../../shared/ids.js';
import type { Logger } from '../../shared/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { createAudioJobQueryRouter } from './routes/audio-job-query.js';
import { createAudioJobsRouter } from './routes/audio-jobs.js';
import { createWeatherRouter } from './routes/weather.js';

export interface AppDeps {
  submitAudio: SubmitAudio;
  queryJob: QueryJob;
  getTranscript: GetTranscript;
  askWeather: AskWeather;
  ids: IdGenerator;
  logger: Logger;
  maxUploadBytes: number;
}

/**
 * Express 应用组装(架构文档 §3.1 interfaces/http 职责): requestId → 路由 → 错误边界。
 * Express 5 自动转发 async rejection 到错误中间件(§8.1 统一错误边界, 无需逐路由包装器)。
 */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestIdMiddleware(deps.ids));
  app.use(express.json());
  app.use(
    createAudioJobsRouter({ submitAudio: deps.submitAudio, maxUploadBytes: deps.maxUploadBytes }),
  );
  app.use(
    createAudioJobQueryRouter({ queryJob: deps.queryJob, getTranscript: deps.getTranscript }),
  );
  app.use(createWeatherRouter({ askWeather: deps.askWeather }));
  app.use(errorHandler(deps.logger));
  return app;
}
