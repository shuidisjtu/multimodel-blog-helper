import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeatherPanel } from './WeatherPanel';

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': 'req_test',
      ...headers,
    },
  });
}

type WeatherOverrides = {
  location?: string;
  tempC?: number;
  description?: string;
};

function successResponse(overrides: WeatherOverrides = {}): Response {
  return response(200, {
    data: {
      location: overrides.location ?? 'Shanghai',
      tempC: overrides.tempC ?? 27.5,
      description: overrides.description ?? 'Partly cloudy',
    },
    requestId: 'req_weather_success',
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WeatherPanel', () => {
  it('does not dispatch a request for blank input', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WeatherPanel />);

    await user.clear(screen.getByLabelText('地点名称'));
    await user.type(screen.getByLabelText('地点名称'), '   ');
    await user.click(screen.getByRole('button', { name: '查询天气' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('请输入要查询的地点名称。');
  });

  it('renders the matched station and the submitted location without requestId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WeatherPanel />);

    await user.clear(screen.getByLabelText('地点名称'));
    await user.type(screen.getByLabelText('地点名称'), '上海');
    await user.click(screen.getByRole('button', { name: '查询天气' }));

    await waitFor(() => expect(screen.getByText('27.5°C')).toBeInTheDocument());
    expect(screen.getByText('匹配站点：')).toBeInTheDocument();
    expect(screen.getByText('你输入的：')).toBeInTheDocument();
    expect(screen.getByText('Shanghai')).toBeInTheDocument();
    expect(screen.getByText('上海')).toBeInTheDocument();
    expect(screen.getByText('Partly cloudy')).toBeInTheDocument();
    expect(screen.queryByText(/requestId/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/assistant/weather',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ location: '上海' }),
      }),
    );
  });

  it('renders user-facing copy without implementer wording', () => {
    const { container } = render(<WeatherPanel />);

    expect(screen.getByText('查询当前地点天气；输入格式见下方提示。')).toBeInTheDocument();
    expect(screen.queryByText(/服务端会校验/)).not.toBeInTheDocument();
    expect(container.querySelector('[aria-describedby="weather-input-hint"]')).not.toBeNull();

    const hint = container.querySelector('.input-hint')?.textContent ?? '';
    expect(hint).toContain('城市+区');
    expect(hint).toContain('南京市鼓楼区');
    expect(hint).toContain('200 个字符');
  });

  it('shows the location example while idle', () => {
    render(<WeatherPanel />);
    expect(screen.getByText('输入城市名或“城市+区”，例如 南京市鼓楼区。')).toBeInTheDocument();
  });

  it('keeps the submitted location after the user edits the input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WeatherPanel />);

    await user.clear(screen.getByLabelText('地点名称'));
    await user.type(screen.getByLabelText('地点名称'), '上海');
    await user.click(screen.getByRole('button', { name: '查询天气' }));
    await waitFor(() => expect(screen.getByText('上海')).toBeInTheDocument());

    await user.type(screen.getByLabelText('地点名称'), '南京');

    expect(screen.getByLabelText('地点名称')).toHaveValue('上海南京');
    expect(screen.getByText('上海')).toBeInTheDocument();
    expect(screen.getByText('Shanghai')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('replaces the previous snapshot and reading on a new submission', async () => {
    let resolvePending: ((value: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(successResponse({ location: 'Shanghai' }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolvePending = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WeatherPanel />);

    await user.clear(screen.getByLabelText('地点名称'));
    await user.type(screen.getByLabelText('地点名称'), '上海');
    await user.click(screen.getByRole('button', { name: '查询天气' }));
    await waitFor(() => expect(screen.getByText('Shanghai')).toBeInTheDocument());

    await user.clear(screen.getByLabelText('地点名称'));
    await user.type(screen.getByLabelText('地点名称'), '闵行区');
    await user.click(screen.getByRole('button', { name: '查询天气' }));

    expect(screen.queryByText('Shanghai')).not.toBeInTheDocument();
    expect(screen.queryByText('上海')).not.toBeInTheDocument();
    expect(screen.queryByText('27.5°C')).not.toBeInTheDocument();
    expect(screen.getByText('正在请求天气工具，请稍候。')).toBeInTheDocument();

    resolvePending?.(successResponse({ location: 'Pootung', tempC: 26.8, description: 'Sunny' }));
    await waitFor(() => expect(screen.getByText('Pootung')).toBeInTheDocument());
    expect(screen.getByText('闵行区')).toBeInTheDocument();
    expect(screen.getByText('26.8°C')).toBeInTheDocument();
    expect(screen.getByText('Sunny')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('documents the place-line styles', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');
    expect(css).toContain('.weather-places');
    expect(css).toContain('.place-label');
    expect(css).toContain('.place-line strong');
    expect(css).toContain('overflow-wrap: anywhere;');
    expect(css).toContain('min-height: 196px;');
  });

  it.each([
    ['INVALID_LOCATION', 422, '请输入有效的地点名称。'],
    ['WEATHER_UNAVAILABLE', 503, '天气服务暂时不可用，请稍后重试。'],
  ])('maps %s to a safe actionable message', async (code, status, message) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response(status, { error: { code, message: 'upstream detail' }, requestId: 'req_problem' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WeatherPanel />);

    await user.click(screen.getByRole('button', { name: '查询天气' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
    expect(screen.queryByText('upstream detail')).not.toBeInTheDocument();
    expect(screen.queryByText(/requestId/)).not.toBeInTheDocument();
  });

  it('shows Retry-After without exposing the raw error envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(
        429,
        {
          error: { code: 'RATE_LIMITED', message: 'Too many requests' },
          requestId: 'req_limited',
        },
        { 'Retry-After': '12' },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WeatherPanel />);

    await user.click(screen.getByRole('button', { name: '查询天气' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        '天气查询请求过于频繁，请在 12 秒后重试。',
      ),
    );
    expect(screen.queryByText('Too many requests')).not.toBeInTheDocument();
  });

  it('shows a safe local-service message for network errors', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('socket ECONNREFUSED /secret/path'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WeatherPanel />);

    await user.click(screen.getByRole('button', { name: '查询天气' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('无法连接本地服务，请确认后端正在运行。'),
    );
    expect(screen.queryByText('/secret/path')).not.toBeInTheDocument();
  });

  it('blocks duplicate dispatches while the request is in flight', async () => {
    let resolveRequest: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<WeatherPanel />);

    const form = screen.getByLabelText('地点名称').closest('form');
    if (form === null) throw new Error('Missing weather form');
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '查询中…' })).toBeDisabled();

    resolveRequest?.(successResponse());
    await waitFor(() => expect(screen.getByText('27.5°C')).toBeInTheDocument());
  });

  it('retries with the existing location after a failed request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(503, {
          error: { code: 'WEATHER_UNAVAILABLE', message: 'unavailable' },
          requestId: 'req_unavailable',
        }),
      )
      .mockResolvedValueOnce(successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<WeatherPanel />);

    await user.clear(screen.getByLabelText('地点名称'));
    await user.type(screen.getByLabelText('地点名称'), 'Hangzhou');
    await user.click(screen.getByRole('button', { name: '查询天气' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: '重试查询' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('地点名称')).toHaveValue('Hangzhou');
    await waitFor(() => expect(screen.getByText('27.5°C')).toBeInTheDocument());
  });

  it('keeps the documented mobile breakpoint and reduced-motion rule', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');
    expect(css).toContain('@media (max-width: 880px)');
    expect(css).toContain('grid-template-columns: 1fr;');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
