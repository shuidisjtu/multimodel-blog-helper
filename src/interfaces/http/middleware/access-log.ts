import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../../../shared/logger.js';

/**
 * 访问日志中间件(架构文档 §8.2, B6a): 请求完成(finish)时输出一行 http.access。
 * 记录方法、路由模式路径、状态码、耗时与 requestId; 路径采用路由模式(如 /api/v1/audio-jobs/:id),
 * 不含具体 jobId/地点等敏感值(未匹配路由的请求记录原始 path); 不记录请求体、响应内容与凭证。
 */
export function accessLogMiddleware(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = performance.now();
    res.on('finish', () => {
      const requestId = String(res.locals.requestId ?? '');
      logger.info({
        event: 'http.access',
        requestId,
        method: req.method,
        route: `${req.baseUrl ?? ''}${req.route?.path ?? req.path}`,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    next();
  };
}
