import { Router } from 'express';
import type { GetTranscript } from '../../../application/get-transcript.js';
import type { QueryJob } from '../../../application/query-job.js';
import { DomainError } from '../../../domain/errors.js';
import { jobView, successEnvelope } from '../envelope.js';

/** 服务端生成 jobId 格式(randomUUID, shared/ids.ts); 校验失败视为不存在(404), 不暴露格式(§5 路径注入防御)。 */
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseJobId(raw: string): string {
  if (!JOB_ID_PATTERN.test(raw)) {
    throw new DomainError('JOB_NOT_FOUND', 'Job not found');
  }
  return raw;
}

/**
 * GET /api/v1/audio-jobs/{id} 与 /transcript(openapi.yaml getAudioJob / downloadTranscript):
 * 查询走 QueryJob + jobView 序列化(JSON 信封); 转录是纯文本响应(契约明确例外),
 * X-Request-Id 由 requestId 中间件统一写入。429 限流属 B6。
 */
export function createAudioJobQueryRouter(deps: {
  queryJob: QueryJob;
  getTranscript: GetTranscript;
}): Router {
  const router = Router();

  router.get('/api/v1/audio-jobs/:id', async (req, res) => {
    const requestId = String(res.locals.requestId ?? '');
    const id = parseJobId(req.params.id ?? '');
    const job = await deps.queryJob.run(id);
    res.json(successEnvelope(jobView(job), requestId));
  });

  router.get('/api/v1/audio-jobs/:id/transcript', async (req, res) => {
    const id = parseJobId(req.params.id ?? '');
    const text = await deps.getTranscript.run(id);
    res.type('text/plain').send(text);
  });

  return router;
}
