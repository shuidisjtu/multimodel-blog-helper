import { Router } from 'express';
import multer from 'multer';
import type { SubmitAudio } from '../../../application/submit-audio.js';
import { validateAudioUpload } from '../../../domain/audio-upload.js';
import { DomainError } from '../../../domain/errors.js';
import { submissionData, successEnvelope } from '../envelope.js';
import { parseIdempotencyKey } from '../schemas/idempotency-key.js';

/**
 * POST /api/v1/audio-jobs(架构文档 §5/§6.1/§8.1 + openapi.yaml submitAudioJob):
 * multer 内存暂存(显式大小限制) → validateAudioUpload(MIME/大小/魔数, 纯函数) →
 * SubmitAudio 用例(落盘/时长/幂等/入队) → 202(created) / 200(replayed) / 409(conflict)。
 * 路由层不落盘、不直接读文件系统(§3.1); 429 限流属 B6。
 */
export function createAudioJobsRouter(deps: {
  submitAudio: SubmitAudio;
  maxUploadBytes: number;
}): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxUploadBytes },
  });

  router.post('/api/v1/audio-jobs', upload.single('file'), async (req, res) => {
    const requestId = String(res.locals.requestId ?? '');
    const idempotencyKey = parseIdempotencyKey(req.header('Idempotency-Key'));
    const file = req.file;
    if (file === undefined) {
      throw new DomainError('INVALID_FILE', 'Uploaded file is empty');
    }
    // 内容校验失败先返回其对应错误, 不进入幂等判定(架构文档 §5)
    const check = validateAudioUpload({
      mimeType: file.mimetype,
      bytes: file.buffer,
      maxBytes: deps.maxUploadBytes,
    });
    if (!check.ok) {
      throw new DomainError(check.code, check.message);
    }
    const outcome = await deps.submitAudio.run({
      requestId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      extension: check.extension,
      bytes: file.buffer,
      idempotencyKey,
    });
    if (outcome.outcome === 'conflict') {
      // 同 key 不同文件: 409(错误信封由错误中间件统一输出)
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key conflict');
    }
    res
      .status(outcome.outcome === 'created' ? 202 : 200)
      .json(
        successEnvelope(submissionData(outcome.job, outcome.outcome === 'replayed'), requestId),
      );
  });

  return router;
}
