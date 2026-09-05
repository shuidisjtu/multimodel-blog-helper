/**
 * 环境配置加载与校验(架构文档 §7.2):启动时校验失败即退出。
 * 所有 process.env 读取集中在此,禁止散落读取(架构文档 §11.2)。
 */
import dotenv from 'dotenv';
import type { LogLevel } from '../shared/logger.js';

const DEVELOPMENT_OPENAI_DOTENV_OVERRIDES = ['OPENAI_API_KEY', 'OPENAI_BASE_URL'] as const;

/**
 * 本地开发允许仓库 .env 覆盖 IDE 注入的 OpenAI 凭据和网关地址。
 * 端口、超时、模型、队列和限流等配置仍保持标准优先级：显式进程变量高于 .env。
 */
export function applyDevelopmentOpenAiOverrides(
  env: NodeJS.ProcessEnv,
  localEnv: NodeJS.ProcessEnv | undefined,
  nodeEnv: string,
): void {
  if (nodeEnv !== 'development' || localEnv === undefined) return;
  for (const key of DEVELOPMENT_OPENAI_DOTENV_OVERRIDES) {
    const value = localEnv[key];
    if (value !== undefined) env[key] = value;
  }
}

const dotenvResult = dotenv.config({ quiet: true });
applyDevelopmentOpenAiOverrides(
  process.env,
  dotenvResult.parsed,
  process.env.NODE_ENV ?? 'development',
);

export interface AppConfig {
  nodeEnv: string;
  port: number;
  openai: {
    apiKey: string;
    baseUrl: string;
    transcribeModel: string;
    summaryModel: string;
    transcribeTimeoutMs: number;
    /** 摘要上游超时(毫秒), 默认 60000(摘要文本量小, 不复用转录的 10 分钟)。 */
    summaryTimeoutMs: number;
    /** 可恢复错误的最大重试次数, 默认 2(共 3 次尝试); 0 = 不重试。 */
    maxRetries: number;
  };
  storage: {
    tempDir: string;
    maxUploadBytes: number;
    jobTtlHours: number;
  };
  weather: {
    baseUrl: string;
    timeoutMs: number;
  };
  queue: {
    maxLength: number;
    workerConcurrency: number;
  };
  limits: {
    rateLimitUploadPerMinute: number;
    rateLimitWeatherPerMinute: number;
    maxAudioDurationSeconds: number;
  };
  security: {
    /** TRUST_PROXY: 为 true 时限流按 X-Forwarded-For 首段计 IP(部署在反代后时配置)。 */
    trustProxy: boolean;
    /** CORS 白名单: 逗号分隔 Origin; 空 = 默认同源(不返回 CORS 允许头)。 */
    corsAllowedOrigins: string[];
  };
  metrics: {
    port: number;
  };
  logLevel: LogLevel;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new ConfigError(`Missing required env var: ${key}`);
  }
  return value;
}

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number, min = 0): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < min) {
    throw new ConfigError(`Invalid integer for ${key}: ${raw}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Node 版本门槛:openAsBlob 等内置 API 依赖 Node 24+,版本过低直接失败(环境自检,不带到运行期)
  const nodeVersion = process.versions.node ?? '';
  if (nodeVersion === '') {
    throw new ConfigError('Cannot determine Node version');
  }
  const nodeMajor = Number.parseInt(nodeVersion.split('.')[0] ?? '', 10);
  if (Number.isNaN(nodeMajor) || nodeMajor < 24) {
    throw new ConfigError(`Node >= 24 required (current: ${nodeVersion})`);
  }
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port: intEnv(env, 'PORT', 3000, 1),
    openai: {
      apiKey: requireEnv(env, 'OPENAI_API_KEY'),
      baseUrl: requireEnv(env, 'OPENAI_BASE_URL'),
      transcribeModel: requireEnv(env, 'OPENAI_TRANSCRIBE_MODEL'),
      summaryModel: requireEnv(env, 'OPENAI_SUMMARY_MODEL'),
      transcribeTimeoutMs: intEnv(env, 'OPENAI_TRANSCRIBE_TIMEOUT_MS', 600000, 1),
      summaryTimeoutMs: intEnv(env, 'OPENAI_SUMMARY_TIMEOUT_MS', 60000, 1),
      maxRetries: intEnv(env, 'OPENAI_MAX_RETRIES', 2, 0),
    },
    storage: {
      tempDir: requireEnv(env, 'TEMP_DIR'),
      maxUploadBytes: intEnv(env, 'MAX_UPLOAD_BYTES', 25 * 1024 * 1024, 1),
      jobTtlHours: intEnv(env, 'JOB_TTL_HOURS', 24, 1),
    },
    weather: {
      baseUrl: requireEnv(env, 'WEATHER_BASE_URL'),
      timeoutMs: intEnv(env, 'WEATHER_TIMEOUT_MS', 15000, 1),
    },
    queue: {
      maxLength: intEnv(env, 'MAX_QUEUE_LENGTH', 100, 1),
      workerConcurrency: intEnv(env, 'WORKER_CONCURRENCY', 1, 1),
    },
    limits: {
      rateLimitUploadPerMinute: intEnv(env, 'RATE_LIMIT_UPLOAD_PER_MINUTE', 10, 1),
      rateLimitWeatherPerMinute: intEnv(env, 'RATE_LIMIT_WEATHER_PER_MINUTE', 30, 1),
      maxAudioDurationSeconds: intEnv(env, 'MAX_AUDIO_DURATION_SECONDS', 3600, 1),
    },
    metrics: {
      port: intEnv(env, 'METRICS_PORT', 9100, 1),
    },
    security: {
      trustProxy: parseTrustProxy(env.TRUST_PROXY),
      corsAllowedOrigins: parseCorsOrigins(env.CORS_ALLOWED_ORIGINS),
    },
    logLevel: parseLogLevel(env.LOG_LEVEL),
  };
}

/** TRUST_PROXY 白名单解析(B6): 空=不信任代理(默认用 socket 地址); 仅 true/1 显式启用, 其余非法值启动即失败。 */
function parseTrustProxy(raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new ConfigError(`Invalid TRUST_PROXY: ${raw}`);
}

/** CORS 白名单解析(B6): 逗号分隔绝对 Origin; 空=默认同源; 禁止通配符 * 与无 scheme 的值。 */
function parseCorsOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  for (const origin of origins) {
    if (origin === '*') {
      throw new ConfigError('CORS_ALLOWED_ORIGINS must not contain "*"');
    }
    if (!/^https?:\/\/\S+/.test(origin)) {
      throw new ConfigError(`Invalid CORS_ALLOWED_ORIGINS entry: ${origin}`);
    }
  }
  return origins;
}

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** LOG_LEVEL 白名单校验: 非法值启动即失败, 不静默降级(与数值配置同策略)。 */
function parseLogLevel(raw: string | undefined): LogLevel {
  const value = raw ?? 'info';
  if (!LOG_LEVELS.includes(value as LogLevel)) {
    throw new ConfigError(`Invalid LOG_LEVEL: ${value}`);
  }
  return value as LogLevel;
}
