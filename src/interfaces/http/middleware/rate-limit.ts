import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, type RateLimitInfo, rateLimit } from 'express-rate-limit';
import type { Logger } from '../../../shared/logger.js';
import { errorEnvelope } from '../envelope.js';
import { MESSAGE_BY_CODE } from './error-handler.js';

/** 限流窗口(B6 计划: 每 IP 每 60 秒), 与 RATE_LIMIT_*_PER_MINUTE 配置配对。 */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * 取 X-Forwarded-For 最左侧地址(客户端直连代理的地址, B6 计划 §限流)。
 * 链式代理场景可被伪造, 但仅在显式配置 TRUST_PROXY 后启用(部署方负责代理边界)。
 */
export function firstForwardedIp(headerValue: string | undefined): string | undefined {
  if (headerValue === undefined) return undefined;
  const first = headerValue.split(',')[0]?.trim() ?? '';
  return first === '' ? undefined : first;
}

/**
 * 客户端 IP 提取(B6 计划): 默认 req.socket.remoteAddress(不信任 X-Forwarded-For);
 * 显式配置 TRUST_PROXY 后才使用代理解析的客户端 IP(首段), 否则回退 socket 地址。
 */
function extractClientIp(req: Request, trustProxy: boolean): string {
  if (trustProxy) {
    // 头值类型为 string | string[] | undefined, 仅 string 参与解析(数组形态视为无值)
    const xff = req.headers['x-forwarded-for'];
    const forwarded = typeof xff === 'string' ? firstForwardedIp(xff) : undefined;
    if (forwarded !== undefined) return forwarded;
  }
  return req.socket.remoteAddress ?? req.ip ?? '';
}

/**
 * 动态 Retry-After(秒, B6 计划): 按当前窗口剩余时间向上取整且最小 1 秒;
 * 无法取得重置时间时回退到窗口剩余时间。
 */
export function retryAfterSeconds(
  resetTime: Date | undefined,
  windowMs: number,
  nowMs: number,
): number {
  const base = resetTime === undefined ? windowMs : Math.max(0, resetTime.getTime() - nowMs);
  return Math.max(1, Math.ceil(base / 1000));
}

/**
 * 路由级 IP 限流器(B6 计划): 统一 429 RATE_LIMITED envelope + 动态 Retry-After,
 * 关闭 RateLimit 与 X-RateLimit 额外头; IPv4-mapped IPv6 由 ipKeyGenerator 规范化,
 * 避免同一客户端获得多份额度。passOnStoreError: false(fail-closed): 内部故障经统一
 * 错误边界拒绝请求并记录结构化错误日志, 不放行。
 */
export function createRateLimiter(opts: {
  windowMs: number;
  max: number;
  trustProxy: boolean;
  logger: Logger;
}): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    keyGenerator: (req) => ipKeyGenerator(extractClientIp(req, opts.trustProxy)),
    standardHeaders: false,
    legacyHeaders: false,
    passOnStoreError: false,
    handler: (req, res) => {
      const requestId = String(res.locals.requestId ?? '');
      const info = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit;
      res.setHeader(
        'Retry-After',
        String(retryAfterSeconds(info?.resetTime, opts.windowMs, Date.now())),
      );
      res.status(429).json(errorEnvelope('RATE_LIMITED', MESSAGE_BY_CODE.RATE_LIMITED, requestId));
    },
  });
}
