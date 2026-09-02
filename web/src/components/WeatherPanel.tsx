import { useRef, useState } from 'react';
import { ApiRequestError } from '../api/http';
import { getWeather, type WeatherDto } from '../api/weather';

type WeatherStatus = 'idle' | 'loading' | 'success' | 'error';

interface WeatherError {
  message: string;
  requestId?: string;
  retryAfterSeconds?: number;
}

function messageForError(error: unknown): WeatherError {
  if (!(error instanceof ApiRequestError)) {
    return { message: '天气查询暂时无法完成，请稍后重试。' };
  }

  if (error.kind === 'network') {
    return { message: '无法连接本地服务，请确认后端正在运行。' };
  }

  const metadata = {
    requestId: error.requestId,
    retryAfterSeconds: error.retryAfterSeconds,
  };
  switch (error.code) {
    case 'INVALID_LOCATION':
      return { message: '请输入有效的地点名称。', ...metadata };
    case 'WEATHER_UNAVAILABLE':
      return { message: '天气服务暂时不可用，请稍后重试。', ...metadata };
    case 'RATE_LIMITED':
      return {
        message:
          error.retryAfterSeconds === undefined
            ? '天气查询请求过于频繁，请稍后再试。'
            : `天气查询请求过于频繁，请在 ${error.retryAfterSeconds} 秒后重试。`,
        ...metadata,
      };
    default:
      return { message: '天气查询暂时无法完成，请稍后重试。', ...metadata };
  }
}

export function WeatherPanel() {
  const requestInFlight = useRef(false);
  const [location, setLocation] = useState('Shanghai');
  const [status, setStatus] = useState<WeatherStatus>('idle');
  const [weather, setWeather] = useState<WeatherDto>();
  const [requestId, setRequestId] = useState<string>();
  const [error, setError] = useState<WeatherError>();

  async function submitWeather() {
    if (requestInFlight.current) return;
    if (location.trim() === '') {
      setWeather(undefined);
      setRequestId(undefined);
      setError({ message: '请输入要查询的地点名称。' });
      setStatus('error');
      return;
    }
    if (location.length > 200) {
      setWeather(undefined);
      setRequestId(undefined);
      setError({ message: '地点名称不能超过 200 个字符。' });
      setStatus('error');
      return;
    }

    requestInFlight.current = true;
    setStatus('loading');
    setError(undefined);
    setWeather(undefined);
    setRequestId(undefined);
    try {
      const result = await getWeather(location);
      setWeather(result.data);
      setRequestId(result.requestId);
      setStatus('success');
    } catch (requestError) {
      setError(messageForError(requestError));
      setStatus('error');
    } finally {
      requestInFlight.current = false;
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitWeather();
  }

  const isLoading = status === 'loading';

  return (
    <section className="panel weather-panel" aria-labelledby="weather-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">WEATHER TOOL</p>
          <h2 id="weather-title">地点天气查询</h2>
        </div>
        <span className="module-tag module-tag-ready">已接入</span>
      </div>

      <p className="panel-intro">使用现有天气 API 查询当前天气；服务端会校验地点并隐藏上游细节。</p>

      <form className="weather-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="weather-location">地点名称</label>
        <div className="input-row">
          <input
            id="weather-location"
            name="location"
            type="text"
            value={location}
            maxLength={200}
            onChange={(event) => setLocation(event.target.value)}
            aria-describedby="weather-input-hint"
            disabled={isLoading}
          />
          <button type="submit" disabled={isLoading}>
            {isLoading ? '查询中…' : '查询天气'}
          </button>
        </div>
        <p id="weather-input-hint" className="input-hint">
          最多 200 个字符；首尾空白由服务端标准化。
        </p>
      </form>

      <div className="weather-feedback" aria-live="polite" aria-atomic="true">
        {status === 'idle' && <p className="feedback-neutral">输入地点后发起一次真实 API 查询。</p>}
        {isLoading && <p className="feedback-loading">正在请求天气工具，请稍候。</p>}
        {status === 'success' && weather !== undefined && (
          <div className="weather-result">
            <div className="weather-reading">
              <span className="temperature">{weather.tempC}°C</span>
              <div>
                <strong>{weather.location}</strong>
                <p>{weather.description}</p>
              </div>
            </div>
            <p className="request-id">requestId: {requestId}</p>
          </div>
        )}
        {status === 'error' && error !== undefined && (
          <div className="weather-error" role="alert">
            <p>{error.message}</p>
            {error.requestId !== undefined && (
              <p className="request-id">requestId: {error.requestId}</p>
            )}
            {location.trim() !== '' && (
              <button className="retry-button" type="button" onClick={() => void submitWeather()}>
                重试查询
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
