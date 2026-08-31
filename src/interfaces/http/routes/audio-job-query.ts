import { Router } from 'express';
import type { GetTranscript } from '../../../application/get-transcript.js';
import type { QueryJob } from '../../../application/query-job.js';
import { jobView, successEnvelope } from '../envelope.js';
import { parseJobId } from '../schemas/job-id.js';

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
