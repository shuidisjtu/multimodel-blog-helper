import { DomainError } from '../../../domain/errors.js';

/** 服务端生成的 UUID；非法路径参数按不存在处理，以避免暴露格式和路径细节。 */
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseJobId(raw: string): string {
  if (!JOB_ID_PATTERN.test(raw)) {
    throw new DomainError('JOB_NOT_FOUND', 'Job not found');
  }
  return raw;
}
