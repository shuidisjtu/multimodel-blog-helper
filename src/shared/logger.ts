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
    // sanitizeValue 对 LogFields 的输出仍是对象类型(嵌套/数组分支在该类型下不成立)
    const sanitized = sanitizeValue(fields, new WeakSet<object>()) as Record<string, unknown>;
    const line: Record<string, unknown> = {
      ...sanitized,
      timestamp: new Date().toISOString(),
      level: levelOut,
    };
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

/** 递归脱敏(架构文档 §8.2): 嵌套对象/数组中的敏感键同样替换, 不依赖调用方约定;
 * 循环引用替换为占位符(避免栈溢出), 非纯对象(Date/Error/Buffer 等)原样交给 JSON.stringify。 */
function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  if (Array.isArray(value)) {
    seen.add(value);
    return value.map((item) => sanitizeValue(item, seen));
  }
  if (!isPlainObject(value)) return value;
  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const lower = key.toLowerCase();
    // 安全字段永不脱敏; 敏感字段名不区分大小写
    if (!SAFE_KEYS.has(lower) && SENSITIVE_KEYS.has(lower)) {
      out[key] = '[redacted]';
    } else {
      out[key] = sanitizeValue(nested, seen);
    }
  }
  return out;
}

/** 纯对象判定: 原型为 Object.prototype 或 null(排除 Date/Error/Buffer 等有自定义序列化的类型)。 */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

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
