import { useEffect, useRef, useState } from 'react';
import {
  type AudioJobDto,
  type AudioJobStatus,
  type AudioJobSubmissionDto,
  getAudioJob,
  getTranscript,
  isAudioJobId,
  submitAudioJob,
} from '../api/audioJobs';
import { ApiRequestError } from '../api/http';

const POLL_INTERVAL_MS = 2_000;
const POLL_WINDOW_MS = 3 * 60_000;

type UploadState = 'idle' | 'uploading' | 'submitted' | 'error';
type PollingState = 'idle' | 'polling' | 'paused' | 'timed-out' | 'complete';
type TranscriptState = 'idle' | 'loading' | 'ready' | 'error';
type CopyState = 'idle' | 'copied' | 'error';

interface PanelError {
  message: string;
}

function retryAfterMessage(base: string, error: ApiRequestError): string {
  return error.retryAfterSeconds === undefined
    ? base
    : `${base}，请在 ${error.retryAfterSeconds} 秒后重试。`;
}

function requestErrorMessage(
  error: unknown,
  context: 'upload' | 'poll' | 'transcript',
): PanelError {
  if (!(error instanceof ApiRequestError)) {
    return { message: '请求暂时无法完成，请稍后重试。' };
  }
  if (error.kind === 'network') {
    return { message: '无法连接本地服务，请确认后端正在运行。' };
  }

  const messages: Record<string, string> = {
    INVALID_FILE: '音频文件内容无效，请重新选择。',
    AUDIO_TOO_LONG: '音频时长超过限制，请选择不超过 60 分钟的文件。',
    FILE_TOO_LARGE: '音频文件过大，请选择不超过 25 MiB 的文件。',
    UNSUPPORTED_MEDIA_TYPE: '不支持该音频格式，请选择 MP3、WAV、MP4 或 M4A。',
    INVALID_IDEMPOTENCY_KEY: '上传标识无效，请重新选择文件后再试。',
    IDEMPOTENCY_CONFLICT: '该上传标识已用于其他文件，请重新选择文件后再试。',
    JOB_NOT_FOUND: '没有找到该音频任务，请检查音频任务编号。',
    JOB_EXPIRED: '该任务已经过期，请重新上传音频。',
    JOB_NOT_READY: '转录尚未准备好，请稍后重试。',
    PROCESS_INTERRUPTED: '服务重启导致任务中断，请重新上传音频。',
    INTERNAL_ERROR: '服务暂时无法完成请求，请稍后重试。',
  };
  let message = messages[error.code];
  if (error.code === 'QUEUE_FULL') {
    message = retryAfterMessage('任务队列已满', error);
  } else if (error.code === 'RATE_LIMITED') {
    message = retryAfterMessage('请求过于频繁', error);
  }
  if (message === undefined) {
    message =
      context === 'upload'
        ? '音频上传暂时无法完成，请稍后重试。'
        : context === 'transcript'
          ? '转录暂时无法加载，请稍后重试。'
          : '任务状态暂时无法查询，请稍后重试。';
  }
  return { message };
}

function failureMessage(code: string): string {
  if (code === 'PROCESS_INTERRUPTED') return '服务重启导致任务中断，请重新上传音频。';
  if (code === 'AUDIO_TOO_LONG') return '音频时长超过限制，请选择较短的文件。';
  return '音频处理失败，请重新上传或稍后重试。';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function statusLabel(status: AudioJobStatus): string {
  switch (status) {
    case 'queued':
      return '已受理，等待后台处理';
    case 'transcribing':
      return '正在转录音频';
    case 'summarizing':
      return '正在生成摘要';
    case 'succeeded':
      return '处理完成';
    case 'failed':
      return '处理失败';
  }
}

function stageForStatus(status: AudioJobStatus): number {
  switch (status) {
    case 'queued':
      return 0;
    case 'transcribing':
      return 1;
    case 'summarizing':
      return 2;
    case 'succeeded':
      return 3;
    case 'failed':
      return 0;
  }
}

function progressForStatus(
  status: AudioJobStatus | undefined,
  isUploading: boolean,
  maxStageSeen: number,
): number {
  if (isUploading) return 8;
  switch (status) {
    case 'queued':
      return 18;
    case 'transcribing':
      return 52;
    case 'summarizing':
      return 82;
    case 'succeeded':
      return 100;
    case 'failed':
      return [18, 52, 82][Math.min(maxStageSeen, 2)] ?? 18;
    default:
      return 0;
  }
}

export function AudioJobPanel() {
  const [selectedFile, setSelectedFile] = useState<File>();
  const [idempotencyKey, setIdempotencyKey] = useState<string>();
  const [fileInputKey, setFileInputKey] = useState(0);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [submission, setSubmission] = useState<AudioJobSubmissionDto>();
  const [job, setJob] = useState<AudioJobDto>();
  const [activeQueryPath, setActiveQueryPath] = useState<string>();
  const [pollingState, setPollingState] = useState<PollingState>('idle');
  const [panelError, setPanelError] = useState<PanelError>();
  const [resumeId, setResumeId] = useState('');
  const [maxStageSeen, setMaxStageSeen] = useState(0);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [transcriptState, setTranscriptState] = useState<TranscriptState>('idle');
  const [transcript, setTranscript] = useState<string>();
  const [transcriptError, setTranscriptError] = useState<PanelError>();

  const uploadInFlight = useRef(false);
  const uploadController = useRef<AbortController | undefined>(undefined);
  const pollController = useRef<AbortController | undefined>(undefined);
  const transcriptController = useRef<AbortController | undefined>(undefined);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollRun = useRef(0);

  function cancelPolling() {
    pollRun.current += 1;
    if (pollTimer.current !== undefined) clearTimeout(pollTimer.current);
    pollTimer.current = undefined;
    pollController.current?.abort();
    pollController.current = undefined;
  }

  function resetTranscript() {
    transcriptController.current?.abort();
    transcriptController.current = undefined;
    setTranscriptState('idle');
    setTranscript(undefined);
    setTranscriptError(undefined);
  }

  useEffect(
    () => () => {
      pollRun.current += 1;
      if (pollTimer.current !== undefined) clearTimeout(pollTimer.current);
      uploadController.current?.abort();
      pollController.current?.abort();
      transcriptController.current?.abort();
    },
    [],
  );

  async function pollJob(queryPath: string, runId: number, deadline: number) {
    if (runId !== pollRun.current) return;
    if (Date.now() >= deadline) {
      setPollingState('timed-out');
      return;
    }

    const controller = new AbortController();
    pollController.current = controller;
    let timedOut = false;
    const deadlineTimer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
        if (runId === pollRun.current) setPollingState('timed-out');
      },
      Math.max(0, deadline - Date.now()),
    );
    try {
      const result = await getAudioJob(queryPath, controller.signal);
      if (timedOut || runId !== pollRun.current || controller.signal.aborted) return;
      setJob(result.data);
      setPanelError(undefined);
      const stage = stageForStatus(result.data.status);
      setMaxStageSeen((current) => Math.max(current, stage));
      if (result.data.status === 'succeeded' || result.data.status === 'failed') {
        setPollingState('complete');
        return;
      }
      pollTimer.current = setTimeout(
        () => void pollJob(queryPath, runId, deadline),
        POLL_INTERVAL_MS,
      );
    } catch (error) {
      if (timedOut || runId !== pollRun.current || controller.signal.aborted) return;
      setPanelError(requestErrorMessage(error, 'poll'));
      const isTerminalLookupError =
        error instanceof ApiRequestError &&
        (error.code === 'JOB_NOT_FOUND' || error.code === 'JOB_EXPIRED');
      setPollingState(isTerminalLookupError ? 'complete' : 'paused');
    } finally {
      clearTimeout(deadlineTimer);
      if (pollController.current === controller) pollController.current = undefined;
    }
  }

  function beginPolling(queryPath: string) {
    cancelPolling();
    const runId = pollRun.current;
    setActiveQueryPath(queryPath);
    setPollingState('polling');
    setPanelError(undefined);
    void pollJob(queryPath, runId, Date.now() + POLL_WINDOW_MS);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setSelectedFile(file);
    setIdempotencyKey(file === undefined ? undefined : crypto.randomUUID());
    setUploadState('idle');
    setPanelError(undefined);
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploadInFlight.current) return;
    if (selectedFile === undefined) {
      setPanelError({ message: '请先选择音频文件。' });
      setUploadState('error');
      return;
    }

    const key = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(key);
    uploadInFlight.current = true;
    setUploadState('uploading');
    setPanelError(undefined);
    setSubmission(undefined);
    setJob(undefined);
    setCopyState('idle');
    setMaxStageSeen(0);
    resetTranscript();
    cancelPolling();
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      const result = await submitAudioJob(selectedFile, key, controller.signal);
      if (controller.signal.aborted) return;
      setSubmission(result.data);
      setUploadState('submitted');
      setIdempotencyKey(undefined);
      beginPolling(result.data.queryUrl);
    } catch (error) {
      if (controller.signal.aborted) return;
      setPanelError(requestErrorMessage(error, 'upload'));
      setUploadState('error');
    } finally {
      uploadInFlight.current = false;
      if (uploadController.current === controller) uploadController.current = undefined;
    }
  }

  function handleResume(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = resumeId.trim();
    if (!isAudioJobId(id)) {
      setPanelError({ message: '请输入有效的音频任务编号。' });
      return;
    }
    setSelectedFile(undefined);
    setIdempotencyKey(undefined);
    setFileInputKey((current) => current + 1);
    setUploadState('idle');
    setSubmission(undefined);
    setJob(undefined);
    setCopyState('idle');
    setMaxStageSeen(0);
    resetTranscript();
    beginPolling(id);
  }

  function startNewTask() {
    cancelPolling();
    uploadController.current?.abort();
    uploadController.current = undefined;
    resetTranscript();
    uploadInFlight.current = false;
    setSelectedFile(undefined);
    setIdempotencyKey(undefined);
    setFileInputKey((current) => current + 1);
    setUploadState('idle');
    setSubmission(undefined);
    setJob(undefined);
    setActiveQueryPath(undefined);
    setPollingState('idle');
    setCopyState('idle');
    setPanelError(undefined);
    setResumeId('');
    setMaxStageSeen(0);
  }

  async function loadTranscript() {
    if (job?.status !== 'succeeded' || job.transcriptUrl === undefined) return;
    transcriptController.current?.abort();
    const controller = new AbortController();
    transcriptController.current = controller;
    setTranscriptState('loading');
    setTranscriptError(undefined);
    try {
      const result = await getTranscript(job.transcriptUrl, controller.signal);
      if (controller.signal.aborted) return;
      setTranscript(result.data);
      setTranscriptState('ready');
    } catch (error) {
      if (controller.signal.aborted) return;
      setTranscriptError(requestErrorMessage(error, 'transcript'));
      setTranscriptState('error');
    } finally {
      if (transcriptController.current === controller) transcriptController.current = undefined;
    }
  }

  async function copyTaskNumber() {
    if (job?.status !== 'succeeded') return;
    try {
      await navigator.clipboard.writeText(job.id);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }

  function downloadTranscript() {
    if (transcript === undefined || job === undefined) return;
    const url = URL.createObjectURL(new Blob([transcript], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `transcript-${job.id}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const trackedStatus = job?.status ?? submission?.status;
  const isUploading = uploadState === 'uploading';
  const isTracking = activeQueryPath !== undefined;
  const canContinue =
    activeQueryPath !== undefined && (pollingState === 'paused' || pollingState === 'timed-out');
  const showNewTaskBesideStatus = isTracking && trackedStatus !== undefined && !isUploading;
  const progressLabel = isUploading
    ? '正在上传音频'
    : trackedStatus === undefined
      ? '等待上传音频'
      : statusLabel(trackedStatus);
  const progressPercent = progressForStatus(trackedStatus, isUploading, maxStageSeen);
  const isProgressRunning =
    isUploading ||
    trackedStatus === 'queued' ||
    trackedStatus === 'transcribing' ||
    trackedStatus === 'summarizing';
  const progressClass = [
    'pipeline-fill',
    isProgressRunning ? 'is-running' : '',
    trackedStatus === 'succeeded' ? 'is-complete' : '',
    trackedStatus === 'failed' ? 'is-error' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className="panel audio-slot" aria-labelledby="audio-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">AUDIO PIPELINE</p>
          <h2 id="audio-title">异步音频任务</h2>
        </div>
        <span className="module-tag module-tag-ready">已接入</span>
      </div>

      <p className="panel-intro">
        上传音频后自动跟踪转录与摘要状态；支持 MP3、WAV、MP4、M4A，默认不超过 25 MiB、60 分钟。
      </p>

      <div className="audio-controls">
        <form className="audio-upload-form" onSubmit={(event) => void handleUpload(event)}>
          <label htmlFor="audio-file">选择音频文件</label>
          <input
            key={fileInputKey}
            id="audio-file"
            name="file"
            type="file"
            accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,.mp3,.wav,.mp4,.m4a"
            disabled={isUploading || isTracking}
            onChange={handleFileChange}
          />
          {selectedFile !== undefined && (
            <p className="file-metadata">
              {selectedFile.name} · {selectedFile.type || '未知媒体类型'} ·{' '}
              {formatBytes(selectedFile.size)}
            </p>
          )}
          <button type="submit" disabled={isUploading || isTracking}>
            {isUploading ? '正在上传…' : '上传并开始处理'}
          </button>
        </form>

        <form className="job-resume-form" onSubmit={handleResume}>
          <label htmlFor="resume-job-id">查询已有音频任务</label>
          <div className="input-row">
            <input
              id="resume-job-id"
              type="text"
              value={resumeId}
              placeholder="输入音频任务编号"
              disabled={isUploading || isTracking}
              onChange={(event) => setResumeId(event.target.value)}
            />
            <button type="submit" disabled={isUploading || isTracking}>
              查询任务
            </button>
          </div>
        </form>
      </div>

      <section className="pipeline" aria-labelledby="pipeline-title">
        <div className="pipeline-heading">
          <strong id="pipeline-title">任务进度</strong>
          <span>当前：{progressLabel}</span>
        </div>
        <div
          className="pipeline-track"
          role="progressbar"
          aria-label="音频任务处理进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent}
          aria-valuetext={progressLabel}
        >
          <span className={progressClass} style={{ width: `${progressPercent}%` }} />
        </div>
      </section>

      <div className="job-feedback" aria-live="polite" aria-atomic="true">
        {!isUploading && trackedStatus === undefined && panelError === undefined && (
          <p className="feedback-neutral">选择音频创建任务，或输入音频任务编号恢复查询。</p>
        )}
        {isUploading && <p className="feedback-loading">正在上传音频并创建异步任务。</p>}
        {trackedStatus !== undefined && (
          <div className="job-status-row">
            <div className="job-status-summary">
              <strong>{statusLabel(trackedStatus)}</strong>
              <div className="job-number-row">
                <p className="job-number">音频任务编号：{job?.id ?? submission?.id}</p>
                {job?.status === 'succeeded' && (
                  <button
                    className="secondary-button copy-task-number-button"
                    type="button"
                    onClick={() => void copyTaskNumber()}
                  >
                    {copyState === 'copied' ? '已复制' : '复制编号'}
                  </button>
                )}
                {copyState === 'error' && (
                  <span className="copy-error" role="alert">
                    复制失败，请手动选择编号复制。
                  </span>
                )}
              </div>
            </div>
            {showNewTaskBesideStatus && (
              <button className="secondary-button" type="button" onClick={startNewTask}>
                开始新任务
              </button>
            )}
          </div>
        )}
        {panelError !== undefined && (
          <div className="audio-error" role="alert">
            <p>{panelError.message}</p>
          </div>
        )}
        {pollingState === 'timed-out' && (
          <p className="polling-note">自动查询已暂停，任务可能仍在后台处理。</p>
        )}
        {job?.status === 'failed' && (
          <div className="audio-error" role="alert">
            <p>{failureMessage(job.failure?.code ?? 'INTERNAL_ERROR')}</p>
          </div>
        )}
        <div className="action-row">
          {canContinue && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => beginPolling(activeQueryPath)}
            >
              继续查询
            </button>
          )}
          {isTracking && !isUploading && !showNewTaskBesideStatus && (
            <button className="secondary-button" type="button" onClick={startNewTask}>
              开始新任务
            </button>
          )}
        </div>
      </div>

      {job?.status === 'succeeded' && (
        <section className="audio-result" aria-labelledby="audio-result-title">
          <div className="result-heading">
            <div>
              <p className="eyebrow">BLOG DRAFT</p>
              <h3 id="audio-result-title">摘要与转录</h3>
            </div>
            <span className="model-label">模型：{job.model}</span>
          </div>
          <pre className="summary-text">{job.summary}</pre>
          <dl className="job-metadata-list">
            <div>
              <dt>更新时间</dt>
              <dd>{new Date(job.updatedAt).toLocaleString()}</dd>
            </div>
          </dl>

          <div className="transcript-actions">
            <button type="button" disabled={transcriptState === 'loading'} onClick={loadTranscript}>
              {transcriptState === 'loading'
                ? '正在加载转录…'
                : transcriptState === 'ready'
                  ? '重新加载转录'
                  : '加载转录'}
            </button>
            {transcriptState === 'ready' && (
              <button className="secondary-button" type="button" onClick={downloadTranscript}>
                下载 TXT
              </button>
            )}
          </div>
          {transcriptError !== undefined && (
            <div className="audio-error" role="alert">
              <p>{transcriptError.message}</p>
            </div>
          )}
          {transcriptState === 'ready' && (
            <section className="transcript-preview" aria-labelledby="transcript-title">
              <h4 id="transcript-title">转录全文</h4>
              <pre className="transcript-text">{transcript}</pre>
            </section>
          )}
        </section>
      )}
    </section>
  );
}
