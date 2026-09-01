import express, { type Express } from 'express';
import type { AskWeather } from '../../application/ask-weather.js';
import type { GetTranscript } from '../../application/get-transcript.js';
import type { QueryJob } from '../../application/query-job.js';
import type { SubmitAudio } from '../../application/submit-audio.js';
import type { IdGenerator } from '../../shared/ids.js';
import type { Logger } from '../../shared/logger.js';
import { accessLogMiddleware } from './middleware/access-log.js';
import { createCorsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { createRateLimiter, RATE_LIMIT_WINDOW_MS } from './middleware/rate-limit.js';
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
  /** TRUST_PROXY(B6): 为 true 时限流按 X-Forwarded-For 首段计 IP, 默认不信任(用 socket 地址)。 */
  trustProxy: boolean;
  /** CORS 白名单(B6): 空列表 = 默认同源, 不返回 CORS 允许头。 */
  corsAllowedOrigins: string[];
  /** 上传接口限流(每 IP 每 60 秒次数, B6)。 */
  rateLimitUploadPerMinute: number;
  /** 天气接口限流(每 IP 每 60 秒次数, B6)。 */
  rateLimitWeatherPerMinute: number;
}

/**
 * Express 应用组装(架构文档 §3.1 interfaces/http 职责):
 * requestId → CORS → 访问日志 → JSON → 路由级限流 → 业务路由 → 错误边界(B6 计划中间件顺序)。
 * Express 5 自动转发 async rejection 到错误中间件(§8.1 统一错误边界, 无需逐路由包装器)。
 */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestIdMiddleware(deps.ids));
  // 白名单为空时不上挂 CORS: 默认同源, 不返回任何 CORS 允许头(计划: 不配通配符 *)
  if (deps.corsAllowedOrigins.length > 0) {
    app.use(createCorsMiddleware(deps.corsAllowedOrigins));
  }
  app.use(accessLogMiddleware(deps.logger));
  app.use(express.json());
  const uploadRateLimiter = createRateLimiter({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: deps.rateLimitUploadPerMinute,
    trustProxy: deps.trustProxy,
    logger: deps.logger,
  });
  const weatherRateLimiter = createRateLimiter({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: deps.rateLimitWeatherPerMinute,
    trustProxy: deps.trustProxy,
    logger: deps.logger,
  });
  app.use(
    createAudioJobsRouter({
      submitAudio: deps.submitAudio,
      maxUploadBytes: deps.maxUploadBytes,
      rateLimiter: uploadRateLimiter,
    }),
  );
  app.use(
    createAudioJobQueryRouter({ queryJob: deps.queryJob, getTranscript: deps.getTranscript }),
  );
  app.use(createWeatherRouter({ askWeather: deps.askWeather, rateLimiter: weatherRateLimiter }));
  app.use(errorHandler(deps.logger));
  return app;
}
