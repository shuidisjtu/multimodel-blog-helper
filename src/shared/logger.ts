/**
 * 结构化 JSON 日志(架构文档 §8.2):一行一个事件,至少含 timestamp/level/event;
 * 文件名、文本内容、音频路径、Authorization、API key 等敏感字段脱敏为 [redacted]。
 * 仅过滤顶层键(嵌套对象由调用方自行避免记录敏感内容)。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志字段: 除 event 外均可选; 允许调用方追加任意结构化字段, 敏感键会被脱敏。 */
export interface LogFields {
  event: string;
  requestId?: string;
  jobId?: string;
  durationMs?: number;
  errorCode?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(fields: LogFields): void;
  info(fields: LogFields): void;
  warn(fields: LogFields): void;
  error(fields: LogFields): void;
}

/** 级别过滤: error>=warn>=info>=debug; 输出 console.log(JSON.stringify(行))。 */
export function createLogger(level: LogLevel): Logger {
  const minRank = LEVEL_RANK[level];
  const write = (levelOut: LogLevel, fields: LogFields): void => {
    if (LEVEL_RANK[levelOut] < minRank) return;
    const line: Record<string, unknown> = {
      ...fields,
      timestamp: new Date().toISOString(),
      level: levelOut,
    };
    for (const key of Object.keys(line)) {
      const lower = key.toLowerCase();
      // 安全字段永不脱敏; 敏感字段名不区分大小写
      if (!SAFE_KEYS.has(lower) && SENSITIVE_KEYS.has(lower)) {
        line[key] = '[redacted]';
      }
    }
    console.log(JSON.stringify(line));
  };
  return {
    debug: (fields) => write('debug', fields),
    info: (fields) => write('info', fields),
    warn: (fields) => write('warn', fields),
    error: (fields) => write('error', fields),
  };
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** 敏感字段名(小写比较): 命中即脱敏。 */
const SENSITIVE_KEYS = new Set([
  'path',
  'filepath',
  'text',
  'content',
  'transcript',
  'summary',
  'apikey',
  'authorization',
  'file',
  'audiopath',
]);

/** 安全字段(架构文档 §8.2): 永不脱敏。 */
const SAFE_KEYS = new Set([
  'event',
  'jobid',
  'requestid',
  'durationms',
  'errorcode',
  'level',
  'timestamp',
]);
