/**
 * 上传校验规则(架构文档 §5): 白名单 MIME + 大小 + 魔数一致性。
 * 纯函数、无 IO; 内存快速校验在 HTTP 层调用(架构文档 §6.1), 时长探测在用例层落盘后(见 AudioDurationProbe)。
 */

export type AudioCodecFamily = 'mp3' | 'wav' | 'mp4';

/** 白名单 MIME(相比教材 03-02 的 audio/* 前缀匹配, 有意收紧防伪造 MIME, §5)。 */
export const AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a'] as const;
type AudioMimeType = (typeof AUDIO_MIME_TYPES)[number];

/** MIME → 扩展名(存储名由服务生成, §5); 与魔数家族解耦: m4a 与 mp4 同容器, 扩展名仍保留原始类型。 */
const EXTENSION_BY_MIME: Record<AudioMimeType, string> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
};

/** MIME → 魔数家族(mp4/m4a 合并为同家族 —— 同为 ISO-BMFF, 细分 brand 会因封装工具差异误杀)。 */
const FAMILY_BY_MIME: Record<AudioMimeType, AudioCodecFamily> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'mp4',
};

export type ValidationErrorCode = 'FILE_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE' | 'INVALID_FILE';

export type UploadValidationResult =
  | { ok: true; extension: string }
  | { ok: false; code: ValidationErrorCode; message: string };

export function validateAudioUpload(p: {
  mimeType: string;
  bytes: Buffer;
  maxBytes: number;
}): UploadValidationResult {
  const { mimeType, bytes, maxBytes } = p;
  if (bytes.length > maxBytes) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `File exceeds max size of ${maxBytes} bytes`,
    };
  }
  if (bytes.length === 0) {
    return { ok: false, code: 'INVALID_FILE', message: 'Uploaded file is empty' };
  }
  const family = FAMILY_BY_MIME[mimeType as AudioMimeType];
  if (family === undefined) {
    return {
      ok: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: `Unsupported media type: ${mimeType}`,
    };
  }
  if (!matchesMagic(bytes, family)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'File content does not match the declared content type',
    };
  }
  return { ok: true, extension: EXTENSION_BY_MIME[mimeType as AudioMimeType] };
}

/**
 * 魔数探测(§5 实现注意): mp3 无固定文件头 —— ID3 帧头或 MPEG 同步字(宽松匹配, 不得误杀合法 mp3);
 * wav = RIFF+WAVE; mp4/m4a = 偏移 4 处 ftyp。
 */
function matchesMagic(bytes: Buffer, family: AudioCodecFamily): boolean {
  switch (family) {
    case 'mp3':
      if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)
        return true;
      return bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0;
    case 'wav':
      return (
        bytes.length >= 12 &&
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WAVE'
      );
    case 'mp4':
      return bytes.length >= 8 && bytes.toString('ascii', 4, 8) === 'ftyp';
  }
}
