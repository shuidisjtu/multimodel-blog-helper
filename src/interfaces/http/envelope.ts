/**
 * HTTP 响应信封(架构文档 §5 / openapi.yaml): 成功 { data, requestId }; 失败 { error: { code, message }, requestId }。
 * error 的 details 为契约可选字段, 本服务暂不对外输出(安全默认)。
 */
export function successEnvelope(
  data: unknown,
  requestId: string,
): { data: unknown; requestId: string } {
  return { data, requestId };
}

export function errorEnvelope(
  code: string,
  message: string,
  requestId: string,
): { error: { code: string; message: string }; requestId: string } {
  return { error: { code, message }, requestId };
}

/** 上传受理响应 data(契约 AudioJobSubmission): id/status/queryUrl/replayed; queryUrl 为契约相对 URL。 */
export function submissionData(
  job: { id: string; status: string },
  replayed: boolean,
): { id: string; status: string; queryUrl: string; replayed: boolean } {
  return {
    id: job.id,
    status: job.status,
    queryUrl: `/api/v1/audio-jobs/${job.id}`,
    replayed,
  };
}

/** 任务查询响应 data(契约 JobView): 必填 id/requestId(创建时)/时间/queryUrl; 可选字段按状态包含。
 * 内部字段(input/路径/哈希/幂等 key)绝不进入响应(架构文档 §8.1)。 */
export interface JobView {
  id: string;
  requestId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  queryUrl: string;
  transcriptUrl?: string;
  summary?: string;
  model?: string;
  failure?: { code: string; message: string };
}

export function jobView(job: {
  id: string;
  requestId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  result?: { summary: string; model: string; transcriptPath?: string };
  failure?: { code: string; safeMessage: string };
}): JobView {
  const view: JobView = {
    id: job.id,
    requestId: job.requestId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
    queryUrl: `/api/v1/audio-jobs/${job.id}`,
  };
  if (job.status === 'succeeded' && job.result !== undefined) {
    return {
      ...view,
      transcriptUrl: `/api/v1/audio-jobs/${job.id}/transcript`,
      summary: job.result.summary,
      model: job.result.model,
    };
  }
  if (job.status === 'failed' && job.failure !== undefined) {
    return { ...view, failure: { code: job.failure.code, message: job.failure.safeMessage } };
  }
  return view;
}
