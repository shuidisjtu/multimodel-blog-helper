import type { NextFunction, Request, Response } from 'express';
import type { IdGenerator } from '../../../shared/ids.js';

/**
 * requestId 中间件(架构文档 §5/§8.2): 服务生成关联标识(不信任客户端),
 * 写入 res.locals.requestId 供路由与错误中间件使用, 并设置 X-Request-Id 响应头。
 */
export function requestIdMiddleware(ids: IdGenerator) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const requestId = ids.nextId();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  };
}
