import cors from 'cors';
import type { RequestHandler } from 'express';

/**
 * 白名单 CORS 中间件(B6 计划): 仅白名单 Origin 获得允许头, 不配通配符 *;
 * 白名单为空的部署不上挂(默认同源, 不返回任何 CORS 允许头)。
 * 允许方法 GET/POST/OPTIONS, 允许请求头 Content-Type / Idempotency-Key / X-Request-Id;
 * OPTIONS 预检由本中间件响应(204), 不进入业务路由/限流。
 */
export function createCorsMiddleware(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return cors({
    origin: (origin, callback) => callback(null, origin === undefined || allowed.has(origin)),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Request-Id'],
  });
}
