/**
 * AskWeather 用例(架构文档 §3.1/§7.1): 通过 WeatherProvider 查询当前天气。
 * HTTP 与 wttr.in 均位于外层；本用例只编排端口、错误语义和可关联日志。
 */
import { DomainError } from '../domain/errors.js';
import type { Weather, WeatherProvider } from '../domain/ports.js';
import type { Logger } from '../shared/logger.js';

export interface AskWeatherParams {
  location: string;
  requestId: string;
}

export class AskWeather {
  constructor(
    private readonly deps: {
      weather: WeatherProvider;
      logger: Logger;
    },
  ) {}

  async run(params: AskWeatherParams): Promise<Weather> {
    const startedAt = Date.now();
    try {
      const weather = await this.deps.weather.current(params.location);
      this.deps.logger.info({
        event: 'weather.current.succeeded',
        requestId: params.requestId,
        durationMs: Date.now() - startedAt,
      });
      return weather;
    } catch (err) {
      const errorCode = err instanceof DomainError ? err.code : 'WEATHER_UNAVAILABLE';
      this.deps.logger.warn({
        event: 'weather.current.failed',
        requestId: params.requestId,
        durationMs: Date.now() - startedAt,
        errorCode,
      });
      if (err instanceof DomainError) throw err;
      // 天气是外部依赖，未知适配器失败也应有稳定、可重试的对外语义。
      throw new DomainError('WEATHER_UNAVAILABLE', 'Weather service is unavailable');
    }
  }
}
