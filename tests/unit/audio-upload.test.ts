import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateAudioUpload } from '../../src/domain/audio-upload.js';

const MAX = 25 * 1024 * 1024;

/** 最小 mp3 样本: ID3v2 头(0x49 0x44 0x33)。 */
function id3Mp3Bytes(): Buffer {
  return Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00]);
}

/** mp3 无 ID3 头: 直接 MPEG 帧同步字(0xFF + 高 3 位 111)。 */
function rawMp3Bytes(): Buffer {
  return Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]);
}

/** 44 字节 RIFF/WAVE 头 + 4 字节静音数据。 */
function wavBytes(): Buffer {
  const buf = Buffer.alloc(48);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(40, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(4, 40);
  return buf;
}

/** 最小 ISO-BMFF box: 偏移 4 处 "ftyp"。 */
function mp4BoxBytes(): Buffer {
  const buf = Buffer.alloc(12);
  buf.writeUInt32BE(12, 0);
  buf.write('ftyp', 4);
  buf.write('isom', 8);
  return buf;
}

describe('validateAudioUpload(架构文档 §5 上传限制)', () => {
  it('白名单 MIME + 对应魔数通过, 返回按 MIME 推断的扩展名', () => {
    expect(
      validateAudioUpload({ mimeType: 'audio/mpeg', bytes: id3Mp3Bytes(), maxBytes: MAX }),
    ).toEqual({ ok: true, extension: 'mp3' });
    expect(
      validateAudioUpload({ mimeType: 'audio/wav', bytes: wavBytes(), maxBytes: MAX }),
    ).toEqual({ ok: true, extension: 'wav' });
    expect(
      validateAudioUpload({ mimeType: 'audio/mp4', bytes: mp4BoxBytes(), maxBytes: MAX }),
    ).toEqual({ ok: true, extension: 'mp4' });
    expect(
      validateAudioUpload({ mimeType: 'audio/x-m4a', bytes: mp4BoxBytes(), maxBytes: MAX }),
    ).toEqual({ ok: true, extension: 'm4a' });
  });

  it('mp3 无 ID3 头时按 MPEG 同步字通过(宽松匹配, 不误杀)', () => {
    const res = validateAudioUpload({
      mimeType: 'audio/mpeg',
      bytes: rawMp3Bytes(),
      maxBytes: MAX,
    });
    expect(res.ok).toBe(true);
  });

  it('超限 → FILE_TOO_LARGE(即使 MIME/魔数正确)', () => {
    const res = validateAudioUpload({ mimeType: 'audio/mpeg', bytes: id3Mp3Bytes(), maxBytes: 8 });
    expect(res).toEqual({ ok: false, code: 'FILE_TOO_LARGE', message: expect.any(String) });
  });

  it('未知 MIME → UNSUPPORTED_MEDIA_TYPE', () => {
    const res = validateAudioUpload({ mimeType: 'image/png', bytes: id3Mp3Bytes(), maxBytes: MAX });
    expect(res).toEqual({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', message: expect.any(String) });
  });

  it('MIME/魔数不一致(纯文本声称 audio/mpeg)→ UNSUPPORTED_MEDIA_TYPE', () => {
    const res = validateAudioUpload({
      mimeType: 'audio/mpeg',
      bytes: Buffer.from('just a plain text file'),
      maxBytes: MAX,
    });
    expect(res).toEqual({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', message: expect.any(String) });
  });

  it('跨家族错配: wav 内容声称 audio/mpeg → 拒绝', () => {
    const res = validateAudioUpload({ mimeType: 'audio/mpeg', bytes: wavBytes(), maxBytes: MAX });
    expect(res.ok).toBe(false);
  });

  it('空文件 → INVALID_FILE(优先于 MIME/魔数判断)', () => {
    const res = validateAudioUpload({
      mimeType: 'audio/mpeg',
      bytes: Buffer.alloc(0),
      maxBytes: MAX,
    });
    expect(res).toEqual({ ok: false, code: 'INVALID_FILE', message: expect.any(String) });
  });

  it('fixtures/audio-sample.mp3 真样本通过(ID3 头)', async () => {
    const bytes = await readFile(
      fileURLToPath(new URL('../../fixtures/audio-sample.mp3', import.meta.url)),
    );
    const res = validateAudioUpload({ mimeType: 'audio/mpeg', bytes, maxBytes: MAX });
    expect(res.ok).toBe(true);
  });
});
