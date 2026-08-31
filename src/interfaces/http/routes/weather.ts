import { Router } from 'express';
import type { AskWeather } from '../../../application/ask-weather.js';
import { successEnvelope } from '../envelope.js';
import { parseWeatherRequest } from '../schemas/weather-request.js';

/** POST /api/v1/assistant/weather: DTO 校验 → AskWeather → JSON 成功信封。 */
export function createWeatherRouter(deps: { askWeather: AskWeather }): Router {
  const router = Router();
  router.post('/api/v1/assistant/weather', async (req, res) => {
    const requestId = String(res.locals.requestId ?? '');
    const { location } = parseWeatherRequest(req.body);
    const weather = await deps.askWeather.run({ location, requestId });
    res.json(successEnvelope(weather, requestId));
  });
  return router;
}
