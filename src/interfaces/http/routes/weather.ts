import { Router } from 'express';
import type { AskWeather } from '../../../application/ask-weather.js';
import { DomainError } from '../../../domain/errors.js';
import { successEnvelope } from '../envelope.js';

const MAX_LOCATION_LENGTH = 200;

function parseLocation(body: unknown): string {
  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, 'location')
  ) {
    throw new DomainError('INVALID_LOCATION', 'Invalid location');
  }
  const location = (body as { location?: unknown }).location;
  if (typeof location !== 'string') {
    throw new DomainError('INVALID_LOCATION', 'Invalid location');
  }
  const normalized = location.trim();
  if (normalized.length === 0 || normalized.length > MAX_LOCATION_LENGTH) {
    throw new DomainError('INVALID_LOCATION', 'Invalid location');
  }
  return normalized;
}

/** POST /api/v1/assistant/weather: DTO 校验 → AskWeather → JSON 成功信封。 */
export function createWeatherRouter(deps: { askWeather: AskWeather }): Router {
  const router = Router();
  router.post('/api/v1/assistant/weather', async (req, res) => {
    const requestId = String(res.locals.requestId ?? '');
    const location = parseLocation(req.body);
    const weather = await deps.askWeather.run({ location, requestId });
    res.json(successEnvelope(weather, requestId));
  });
  return router;
}
