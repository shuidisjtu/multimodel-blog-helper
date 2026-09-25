/**
 * QwenAsrTranscriber: 通过阿里云百炼(国内站)同步识别接口实现 Transcriber 端口。
 * 一次 HTTP 调用(Node 内置 fetch), 不引入新依赖、不新增协议栈。
 *
 * 响应解析要点(实测, 见 docs/evidence/a6-1-qwen-asr-feasibility/ §8.2):
 * - 文本在**顶层** `text`, 用量在**顶层** `usage`; `json.output` 是不含 usage 的冗余副本, 不要读它
 * - 分段必须读 `sentences[]`(VAD 片段), 单数 `sentence` 始终覆盖整段音频, 读了会退化成"整段一句"
 * - 无 `choices` 字段, 照搬 OpenAI 风格解析会取不到任何文本
 *
 * 内存取舍: base64 内联要求**整文件读入内存**, 与 OpenAITranscriber 的 openAsBlob 流式读取不同。
 * 保护来自上传上限(MAX_UPLOAD_BYTES 默认 15 MiB)与下面的编码后预检——两者都收敛在
 * 上游实测的 data-uri 上限之内, 故不会因本适配器而多占内存。
 */
import { readFile } from 'node:fs/promises';
import { DomainError } from '../../domain/errors.js';
import type { Transcriber, Transcript, TranscriptSegment } from '../../domain/ports.js';
import type { Logger } from '../../shared/logger.js';
import { withRetry } from '../common/retry.js';
import type { AsrWord } from './segment-builder.js';
import { buildSegments } from './segment-builder.js';

/** 上游对单个 data-uri 的实测上限(字节): 20 MiB, 超限报 BadRequest.TooLarge (A6-1 实测)。 */
export const DATA_URI_MAX_BYTES = 20 * 1024 * 1024;

/** 上传白名单 MIME → 上游 `parameters.format`(必填)。与 domain/audio-upload.ts 的白名单一一对应。 */
const FORMAT_BY_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
};

export interface QwenAsrOptions {
  apiKey: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
  /** 说话人分离: 开启后返回多段 sentences 与 speaker_id, 片段可天然按说话人边界断开。 */
  speakerDiarization: boolean;
  maxRetries: number;
}

export class QwenAsrTranscriber implements Transcriber {
  constructor(
    private readonly options: QwenAsrOptions,
    private readonly logger: Logger,
  ) {}

  async transcribe(params: { jobId: string; path: string; mimeType: string }): Promise<Transcript> {
    const format = FORMAT_BY_MIME[params.mimeType];
    if (format === undefined) {
      throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type');
    }

    const bytes = await readFile(params.path);
    const dataUrl = buildDataUrl(params.mimeType, bytes);

    const started = Date.now();
    const { value, retryCount } = await withRetry(() => this.request(format, dataUrl), {
      maxAttempts: this.options.maxRetries + 1,
      isRetryable: isQwenAsrRetryable,
      logger: this.logger,
      context: { jobId: params.jobId },
    });

    const text = asNonEmptyString(pickNonEmpty(value, 'text'));
    if (text === null) {
      // 200 但无文本: 视为上游异常而非"空转录成功"(空转录会静默产出空摘要, 属假装可用)
      throw new DomainError('INTERNAL_ERROR', 'Transcription returned no text');
    }
    const segments = buildSegments(collectWords(value));
    const usageDuration = asFiniteNumber(value.usage?.duration);

    this.logger.info({
      event: 'qwen.transcribed',
      jobId: params.jobId,
      model: this.options.model,
      durationMs: Date.now() - started,
      retryCount,
      segmentCount: segments?.length ?? 0,
    });

    return {
      text,
      // 字数按码点计数(中文一字一码点), 与 OpenAITranscriber 口径一致
      characterCount: [...text].length,
      durationSeconds: usageDuration ?? lastSegmentEndSeconds(segments),
      segments,
    };
  }

  /** 单次调用: 返回 2xx 时解析 JSON; 其他状态抛 QwenAsrHttpError(由重试策略判定)。 */
  private async request(format: string, dataUrl: string): Promise<QwenAsrResponse> {
    const response = await fetch(this.options.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
        // 同步调用需显式关闭 SSE, 否则上游按流式返回(A6-1 实测)
        'X-DashScope-SSE': 'disable',
      },
      body: JSON.stringify({
        model: this.options.model,
        input: {
          messages: [
            { role: 'user', content: [{ type: 'input_audio', input_audio: { data: dataUrl } }] },
          ],
        },
        parameters: {
          format,
          ...(this.options.speakerDiarization ? { speaker_diarization_enabled: true } : {}),
        },
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    const raw = await response.text();
    const parsed = asRecord(safeJsonParse(raw));
    if (!response.ok) {
      const code = asString(parsed?.code);
      const message = asString(parsed?.message);
      // 已知超限/内容错误映射为明确业务错误, 避免退化成泛化的 500 "Processing failed"
      const mapped = mapUpstreamError(code, message);
      if (mapped !== null) throw mapped;
      throw new QwenAsrHttpError(response.status, code, message);
    }
    if (parsed === null) {
      throw new DomainError('INTERNAL_ERROR', 'Transcription response is not valid JSON');
    }
    return parsed as QwenAsrResponse;
  }
}

/** 上游 2xx 之外的响应: 仅携带判定重试与映射业务错误所需的最小信息。 */
export class QwenAsrHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly upstreamMessage: string | undefined,
  ) {
    super(`Qwen ASR request failed with status ${status}`);
    this.name = 'QwenAsrHttpError';
  }
}

/**
 * 把上游已知的错误码映射为明确业务错误(否则用户看到的是泛化的 500)。
 * 错误码取自 A6-1 实测; 无法识别的一律返回 null, 交由上层按未知失败处理。
 * 注意: 不把上游原始 message 带进 DomainError 或日志(非目标: 不写上游原始错误), 只按码判定。
 */
export function mapUpstreamError(
  code: string | undefined,
  message: string | undefined,
): DomainError | null {
  switch (code) {
    case 'AUDIO_DURATION_TOO_LONG':
      return new DomainError('AUDIO_TOO_LONG', 'Audio exceeds the maximum duration');
    case 'BadRequest.TooLarge':
      return new DomainError('FILE_TOO_LARGE', 'File is too large to transcribe');
    case 'ASR_RESPONSE_HAVE_NO_WORDS':
      return new DomainError('INVALID_FILE', 'Audio contains no recognizable speech');
    case 'InvalidParameter':
      // 实测: 超长 base64 字符串会以字符串长度上限报出(A6-1 §4.2)
      return /exceeds the maximum allowed|max bytes per data-uri/i.test(message ?? '')
        ? new DomainError('FILE_TOO_LARGE', 'File is too large to transcribe')
        : null;
    default:
      return null;
  }
}

/**
 * 重试判定: 429 与 5xx 可重试; 网络错误与超时(fetch 抛 TypeError / TimeoutError)可重试;
 * 业务错误(DomainError, 如超限)与其余 4xx **不重试**——重试不会改变结果, 只会重复计费。
 */
export function isQwenAsrRetryable(err: unknown): boolean {
  if (err instanceof DomainError) return false;
  if (err instanceof QwenAsrHttpError) return err.status === 429 || err.status >= 500;
  return true;
}

/** base64 编码后的字节数(膨胀 4/3, 不足一组按 4 字节补齐)。 */
export function encodedByteLength(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}

/** 构造 base64 Data URL; 编码后超过上游 data-uri 上限则提前抛业务错误(不让上游报错穿透)。 */
export function buildDataUrl(mimeType: string, bytes: Buffer): string {
  if (encodedByteLength(bytes.length) > DATA_URI_MAX_BYTES) {
    throw new DomainError('FILE_TOO_LARGE', 'File is too large to transcribe');
  }
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

/**
 * 收集词级数据。**优先取 `sentences[]`**: 开启说话人分离后 `sentence`(单数)与 `sentences` 同时存在,
 * 前者始终覆盖整段音频, 取它会让分段退化成"整段一句"(实测 15s 样本: sentence 0→14880ms/40 词,
 * sentences 3 段)。两者都空时返回空数组, 由 buildSegments 决定给不出时间戳。
 */
function collectWords(payload: QwenAsrResponse): AsrWord[] {
  const sentences = pickNonEmpty(payload, 'sentences');
  const fromSentences = flattenWords(Array.isArray(sentences) ? sentences : []);
  if (fromSentences.length > 0) return fromSentences;
  const sentence = pickNonEmpty(payload, 'sentence');
  return sentence !== undefined ? flattenWords([sentence]) : [];
}

function flattenWords(containers: readonly unknown[]): AsrWord[] {
  const words: AsrWord[] = [];
  for (const container of containers) {
    const list = asRecord(container)?.words;
    if (!Array.isArray(list)) continue;
    for (const word of list) {
      const record = asRecord(word);
      if (record !== null) words.push(record as AsrWord);
    }
  }
  return words;
}

function lastSegmentEndSeconds(segments: TranscriptSegment[] | undefined): number | undefined {
  const last = segments?.[segments.length - 1];
  return last === undefined ? undefined : last.endMs / 1000;
}

interface QwenAsrResponse {
  text?: unknown;
  sentence?: unknown;
  sentences?: unknown;
  usage?: { duration?: unknown };
  /** 通用域名把 text/sentence/sentences 放在此层; 专属域名的等价内容在顶层。 */
  output?: unknown;
}

/**
 * 读取上游字段, 兼容两站层级差异(均实测):
 * 专属域名 {WorkspaceId}.{region}.maas.aliyuncs.com 把结果放在顶层;
 * 通用域名 dashscope.aliyuncs.com 把 text/sentence/sentences 放在 output 内。
 * 取第一个非空候选, 避免顶层空值遮蔽 output 内的有效值。
 * 注: usage 两站均在顶层, 无需回退。
 */
function pickNonEmpty(payload: QwenAsrResponse, key: string): unknown {
  const nested = asRecord(payload.output);
  for (const candidate of [asRecord(payload)?.[key], nested?.[key]]) {
    if (candidate === undefined || candidate === null) continue;
    if (typeof candidate === 'string' && candidate === '') continue;
    if (Array.isArray(candidate) && candidate.length === 0) continue;
    return candidate;
  }
  return undefined;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
