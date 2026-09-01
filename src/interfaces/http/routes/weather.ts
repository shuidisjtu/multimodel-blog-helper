import { type RequestHandler, Router } from 'express';
import type { AskWeather } from '../../../application/ask-weather.js';
import { successEnvelope } from '../envelope.js';
import { parseWeatherRequest } from '../schemas/weather-request.js';

/**
 * POST /api/v1/assistant/weather: 路由级限流 → DTO 校验 → AskWeather → JSON 成功信封。
 * 429 限流响应由 rateLimiter 统一输出(B6)。
 */
export function createWeatherRouter(deps: {
  askWeather: AskWeather;
  rateLimiter: RequestHandler;
}): Router {
  const router = Router();
  router.post('/api/v1/assistant/weather', deps.rateLimiter, async (req, res) => {
    const requestId = String(res.locals.requestId ?? '');
    const { location } = parseWeatherRequest(req.body);
    const weather = await deps.askWeather.run({ location, requestId });
    res.json(successEnvelope(weather, requestId));
  });
  return router;
}
