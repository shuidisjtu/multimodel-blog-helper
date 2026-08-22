import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MusicMetadataDurationProbe } from '../../src/infrastructure/common/music-metadata-duration-probe.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

class FakeLogger implements Logger {
  readonly calls: LogFields[] = [];
  debug(f: LogFields): void {
    this.calls.push({ ...f, level: 'debug' });
  }
  info(f: LogFields): void {
    this.calls.push({ ...f, level: 'info' });
  }
  warn(f: LogFields): void {
    this.calls.push({ ...f, level: 'warn' });
  }
  error(f: LogFields): void {
    this.calls.push({ ...f, level: 'error' });
  }
}

/** 44 字节 RIFF/WAVE 头 + 4 字节静音(时长 = 4/16000 s > 0)。 */
function makeWavBytes(): Buffer {
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

const MP3_FIXTURE = fileURLToPath(new URL('../../fixtures/audio-sample.mp3', import.meta.url));

let tmpDir: string;
beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'blog-helper-probe-'));
});
afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('MusicMetadataDurationProbe(架构文档 §5 时长探测)', () => {
  it('真实 mp3 fixture: 解析出正时长', async () => {
    const probe = new MusicMetadataDurationProbe(new FakeLogger());
    const duration = await probe.probe(MP3_FIXTURE);
    expect(duration).not.toBeNull();
    expect(duration as number).toBeGreaterThan(0);
  });

  it('合法 wav: 解析出正时长', async () => {
    const path = join(tmpDir, 'tone.wav');
    await writeFile(path, makeWavBytes());
    const probe = new MusicMetadataDurationProbe(new FakeLogger());
    const duration = await probe.probe(path);
    expect(duration).toBeGreaterThan(0);
  });

  it('非音频文本: 降级返回 null 且记录降级日志', async () => {
    const path = join(tmpDir, 'note.txt');
    await writeFile(path, 'this is not audio');
    const logger = new FakeLogger();
    const probe = new MusicMetadataDurationProbe(logger);
    expect(await probe.probe(path)).toBeNull();
    expect(logger.calls.some((c) => c.event === 'audio.duration_probe.degraded')).toBe(true);
  });

  it('损坏 mp3(仅 ID3 头无帧): 降级返回 null', async () => {
    const path = join(tmpDir, 'broken.mp3');
    await writeFile(path, Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]));
    const probe = new MusicMetadataDurationProbe(new FakeLogger());
    expect(await probe.probe(path)).toBeNull();
  });
});
