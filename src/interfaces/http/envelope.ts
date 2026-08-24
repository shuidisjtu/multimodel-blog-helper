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
