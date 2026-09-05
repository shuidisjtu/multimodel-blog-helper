import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioJobPanel } from './AudioJobPanel';

const JOB_ID = '123e4567-e89b-42d3-a456-426614174000';
const QUERY_URL = `/api/v1/audio-jobs/${JOB_ID}`;
const TRANSCRIPT_URL = `${QUERY_URL}/transcript`;

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': 'req_response',
      ...headers,
    },
  });
}

function submissionResponse(status = 202, replayed = false): Response {
  return jsonResponse(status, {
    data: { id: JOB_ID, status: 'queued', queryUrl: QUERY_URL, replayed },
    requestId: 'req_submit',
  });
}

function jobResponse(
  status: 'queued' | 'transcribing' | 'summarizing' | 'succeeded' | 'failed',
): Response {
  const data: Record<string, unknown> = {
    id: JOB_ID,
    requestId: 'req_created',
    status,
    createdAt: '2026-09-05T01:00:00.000Z',
    updatedAt: '2026-09-05T01:02:00.000Z',
    expiresAt: '2026-09-06T01:00:00.000Z',
    queryUrl: QUERY_URL,
  };
  if (status === 'succeeded') {
    data.transcriptUrl = TRANSCRIPT_URL;
    data.summary = '- 第一条摘要\n- 第二条摘要';
    data.model = 'gpt-4o';
  }
  if (status === 'failed') {
    data.failure = { code: 'PROCESS_INTERRUPTED', message: 'Internal error' };
  }
  return jsonResponse(200, { data, requestId: `req_${status}` });
}

function chooseAudio(name = 'sample.mp3'): File {
  const file = new File(['ID3 audio'], name, { type: 'audio/mpeg' });
  fireEvent.change(screen.getByLabelText('选择音频文件'), { target: { files: [file] } });
  return file;
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AudioJobPanel', () => {
  it('does not upload without a file', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AudioJobPanel />);

    await user.click(screen.getByRole('button', { name: '上传并开始处理' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('请先选择音频文件。');
  });

  it.each([
    [202, false],
    [200, true],
  ])('uploads multipart and accepts submission status %s', async (status, replayed) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(submissionResponse(status, replayed))
      .mockResolvedValueOnce(jobResponse('succeeded'));
    vi.stubGlobal('fetch', fetchMock);
    render(<AudioJobPanel />);
    const file = chooseAudio();

    fireEvent.click(screen.getByRole('button', { name: '上传并开始处理' }));

    await screen.findByText(/第一条摘要/);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/v1/audio-jobs');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toEqual(file);
    expect(new Headers(init.headers).get('Idempotency-Key')).toBeTruthy();
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(QUERY_URL);
  });

  it('reuses the idempotency key when a failed upload is retried', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket /private/path'))
      .mockResolvedValueOnce(submissionResponse())
      .mockResolvedValueOnce(jobResponse('succeeded'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AudioJobPanel />);
    chooseAudio();

    await user.click(screen.getByRole('button', { name: '上传并开始处理' }));
    await screen.findByText('无法连接本地服务，请确认后端正在运行。');
    await user.click(screen.getByRole('button', { name: '上传并开始处理' }));
    await screen.findByText(/第一条摘要/);

    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(firstInit).toBeDefined();
    expect(secondInit).toBeDefined();
    const firstHeaders = new Headers(firstInit?.headers);
    const secondHeaders = new Headers(secondInit?.headers);
    expect(firstHeaders.get('Idempotency-Key')).toBe(secondHeaders.get('Idempotency-Key'));
    expect(screen.queryByText('/private/path')).not.toBeInTheDocument();
  });

  it('generates a new idempotency key when another file is selected', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AudioJobPanel />);

    chooseAudio('first.mp3');
    await user.click(screen.getByRole('button', { name: '上传并开始处理' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    chooseAudio('second.mp3');
    await user.click(screen.getByRole('button', { name: '上传并开始处理' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstHeaders = new Headers(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
    );
    const secondHeaders = new Headers(
      (fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers,
    );
    expect(firstHeaders.get('Idempotency-Key')).not.toBe(secondHeaders.get('Idempotency-Key'));
  });

  it('polls each processing status and stops after success', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(submissionResponse())
      .mockResolvedValueOnce(jobResponse('queued'))
      .mockResolvedValueOnce(jobResponse('transcribing'))
      .mockResolvedValueOnce(jobResponse('summarizing'))
      .mockResolvedValueOnce(jobResponse('succeeded'));
    vi.stubGlobal('fetch', fetchMock);
    render(<AudioJobPanel />);
    chooseAudio();

    fireEvent.click(screen.getByRole('button', { name: '上传并开始处理' }));
    await flushPromises();
    expect(screen.getByText('已受理，等待后台处理')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByText('正在转录音频')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '复制编号' })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '音频任务处理进度' })).toHaveAttribute(
      'aria-valuenow',
      '52',
    );
    expect(screen.getByRole('progressbar', { name: '音频任务处理进度' })).toHaveAttribute(
      'aria-valuetext',
      '正在转录音频',
    );
    expect(
      screen.getByRole('button', { name: '开始新任务' }).closest('.job-status-row'),
    ).not.toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getAllByText('正在生成摘要')).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByText('处理完成')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制编号' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '音频任务处理进度' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    expect(
      screen.getByRole('button', { name: '开始新任务' }).closest('.job-status-row'),
    ).not.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('copies the audio task number after the job succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jobResponse('succeeded'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboardNavigator = Object.create(navigator) as Navigator;
    Object.defineProperty(clipboardNavigator, 'clipboard', { value: { writeText } });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', clipboardNavigator);
    render(<AudioJobPanel />);

    fireEvent.change(screen.getByLabelText('查询已有音频任务'), {
      target: { value: JOB_ID },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询任务' }));
    await screen.findByText('处理完成');
    fireEvent.click(screen.getByRole('button', { name: '复制编号' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JOB_ID));
    expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument();
  });

  it('does not overlap polling requests', async () => {
    vi.useFakeTimers();
    let resolveQuery: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(submissionResponse())
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveQuery = resolve;
          }),
      )
      .mockResolvedValueOnce(jobResponse('failed'));
    vi.stubGlobal('fetch', fetchMock);
    render(<AudioJobPanel />);
    chooseAudio();

    fireEvent.click(screen.getByRole('button', { name: '上传并开始处理' }));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => resolveQuery?.(jobResponse('queued')));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops after a failed job and maps the safe failure code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(submissionResponse())
      .mockResolvedValueOnce(jobResponse('failed'));
    vi.stubGlobal('fetch', fetchMock);
    render(<AudioJobPanel />);
    chooseAudio();

    fireEvent.click(screen.getByRole('button', { name: '上传并开始处理' }));

    await screen.findByText('服务重启导致任务中断，请重新上传音频。');
    expect(screen.queryByText('Internal error')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '继续查询' })).not.toBeInTheDocument();
  });

  it('restores a job by UUID and rejects invalid IDs locally', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jobResponse('succeeded'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AudioJobPanel />);

    const taskNumberInput = screen.getByLabelText('查询已有音频任务');
    expect(taskNumberInput).toHaveAttribute('placeholder', '输入音频任务编号');
    await user.type(taskNumberInput, 'not-a-uuid');
    await user.click(screen.getByRole('button', { name: '查询任务' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的音频任务编号。');

    await user.clear(taskNumberInput);
    await user.type(taskNumberInput, JOB_ID);
    await user.click(screen.getByRole('button', { name: '查询任务' }));

    await screen.findByText(/第一条摘要/);
    expect(fetchMock).toHaveBeenCalledWith(QUERY_URL, expect.objectContaining({ method: 'GET' }));
  });

  it.each([
    ['JOB_NOT_FOUND', 404, '没有找到该音频任务，请检查音频任务编号。'],
    ['JOB_EXPIRED', 410, '该任务已经过期，请重新上传音频。'],
  ])('treats %s as a terminal lookup error', async (code, status, message) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(status, {
        error: { code, message: 'server detail' },
        requestId: 'req_lookup_error',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AudioJobPanel />);

    await user.type(screen.getByLabelText('查询已有音频任务'), JOB_ID);
    await user.click(screen.getByRole('button', { name: '查询任务' }));

    await screen.findByText(message);
    expect(screen.queryByRole('button', { name: '继续查询' })).not.toBeInTheDocument();
    expect(screen.queryByText('server detail')).not.toBeInTheDocument();
  });

  it('pauses a network polling error and continues the same job', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(jobResponse('succeeded'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AudioJobPanel />);

    await user.type(screen.getByLabelText('查询已有音频任务'), JOB_ID);
    await user.click(screen.getByRole('button', { name: '查询任务' }));
    await screen.findByText('无法连接本地服务，请确认后端正在运行。');
    await user.click(screen.getByRole('button', { name: '继续查询' }));

    await screen.findByText(/第一条摘要/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(QUERY_URL);
  });

  it('pauses after a three-minute polling window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T01:00:00.000Z'));
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jobResponse('queued')));
    vi.stubGlobal('fetch', fetchMock);
    render(<AudioJobPanel />);

    fireEvent.change(screen.getByLabelText('查询已有音频任务'), { target: { value: JOB_ID } });
    fireEvent.click(screen.getByRole('button', { name: '查询任务' }));
    await flushPromises();
    await act(() => vi.advanceTimersByTimeAsync(180_000));

    expect(screen.getByText('自动查询已暂停，任务可能仍在后台处理。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续查询' })).toBeInTheDocument();
  });

  it('aborts a hanging query when the three-minute polling window expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T01:00:00.000Z'));
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(submissionResponse())
      .mockImplementationOnce((_path: string, init: RequestInit) => {
        observedSignal = init.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      });
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<AudioJobPanel />);
    chooseAudio();

    fireEvent.click(screen.getByRole('button', { name: '上传并开始处理' }));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(observedSignal?.aborted).toBe(false);

    await act(() => vi.advanceTimersByTimeAsync(180_000));

    expect(observedSignal?.aborted).toBe(true);
    expect(screen.getByText('自动查询已暂停，任务可能仍在后台处理。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续查询' })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('loads transcript only on demand and downloads the loaded text', async () => {
    const transcriptText = '第一段转录。\n第二段转录。';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jobResponse('succeeded'))
      .mockResolvedValueOnce(
        new Response(transcriptText, {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Request-Id': 'req_text' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:transcript');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<AudioJobPanel />);

    await user.type(screen.getByLabelText('查询已有音频任务'), JOB_ID);
    await user.click(screen.getByRole('button', { name: '查询任务' }));
    await screen.findByText(/第一条摘要/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '加载转录' }));
    const transcriptRegion = await screen.findByRole('region', { name: '转录全文' });
    expect(transcriptRegion.querySelector('pre')?.textContent).toBe(transcriptText);
    await user.click(screen.getByRole('button', { name: '下载 TXT' }));

    expect(fetchMock.mock.calls[1]?.[0]).toBe(TRANSCRIPT_URL);
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:transcript');
  });

  it('keeps the summary visible when transcript loading fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jobResponse('succeeded'))
      .mockResolvedValueOnce(
        jsonResponse(409, {
          error: { code: 'JOB_NOT_READY', message: 'raw not ready' },
          requestId: 'req_not_ready',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<AudioJobPanel />);

    await user.type(screen.getByLabelText('查询已有音频任务'), JOB_ID);
    await user.click(screen.getByRole('button', { name: '查询任务' }));
    await screen.findByText(/第一条摘要/);
    await user.click(screen.getByRole('button', { name: '加载转录' }));

    expect(await screen.findByText('转录尚未准备好，请稍后重试。')).toBeInTheDocument();
    expect(screen.getByText(/第一条摘要/)).toBeInTheDocument();
    expect(screen.queryByText('raw not ready')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加载转录' })).toBeEnabled();
  });

  it('aborts an in-flight job query when unmounted', async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation((_path: string, init: RequestInit) => {
      observedSignal = init.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const view = render(<AudioJobPanel />);

    await user.type(screen.getByLabelText('查询已有音频任务'), JOB_ID);
    await user.click(screen.getByRole('button', { name: '查询任务' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(observedSignal?.aborted).toBe(false);

    view.unmount();
    expect(observedSignal?.aborted).toBe(true);
  });

  it('maps upload Retry-After without exposing the raw envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        429,
        {
          error: { code: 'RATE_LIMITED', message: 'raw rate message' },
          requestId: 'req_limited',
        },
        { 'Retry-After': '8' },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<AudioJobPanel />);
    chooseAudio();

    fireEvent.click(screen.getByRole('button', { name: '上传并开始处理' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('请求过于频繁，请在 8 秒后重试。'),
    );
    expect(screen.queryByText('raw rate message')).not.toBeInTheDocument();
    expect(screen.queryByText('requestId: req_limited')).not.toBeInTheDocument();
  });
});
