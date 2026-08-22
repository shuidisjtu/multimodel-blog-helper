import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/shared/logger.js';

/** 捕获 console.log 输出并解析为 JSON 行(架构文档 §8.2:一行一事件)。 */
function capture() {
  const lines: Record<string, unknown>[] = [];
  vi.spyOn(console, 'log').mockImplementation((s: string) => {
    lines.push(JSON.parse(s) as Record<string, unknown>);
  });
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger(架构文档 §8.2:JSON 一行一事件)', () => {
  it('级别过滤:info 级别不输出 debug,只输出 info/warn/error', () => {
    const lines = capture();
    const logger = createLogger('info');
    logger.debug({ event: 'debug-ev' });
    logger.info({ event: 'info-ev' });
    logger.warn({ event: 'warn-ev' });
    logger.error({ event: 'error-ev' });
    expect(lines.map((l) => l.event)).toEqual(['info-ev', 'warn-ev', 'error-ev']);
  });

  it('级别过滤:error 级别只输出 error(抑制 warn/info/debug)', () => {
    const lines = capture();
    const logger = createLogger('error');
    logger.debug({ event: 'd' });
    logger.info({ event: 'i' });
    logger.warn({ event: 'w' });
    logger.error({ event: 'e' });
    expect(lines.map((l) => l.event)).toEqual(['e']);
  });

  it('debug 级别输出所有级别', () => {
    const lines = capture();
    const logger = createLogger('debug');
    logger.debug({ event: 'd' });
    logger.info({ event: 'i' });
    expect(lines.map((l) => l.event)).toEqual(['d', 'i']);
  });

  it('输出为合法 JSON 且含 timestamp/level/event 与调用方字段', () => {
    const lines = capture();
    const logger = createLogger('debug');
    logger.info({ event: 'job.started', jobId: 'j1', requestId: 'r1', durationMs: 12 });
    expect(lines).toHaveLength(1);
    const line = lines[0] as Record<string, unknown>;
    expect(line.event).toBe('job.started');
    expect(line.jobId).toBe('j1');
    expect(line.requestId).toBe('r1');
    expect(line.durationMs).toBe(12);
    expect(line.level).toBe('info');
    const ts = line.timestamp as string;
    expect(new Date(ts).toISOString()).toBe(ts); // 合法 ISO 8601
  });

  it('脱敏:敏感键(path/text/content/transcript/summary/apiKey/authorization/file/audioPath)替换为 [redacted]', () => {
    const lines = capture();
    const logger = createLogger('debug');
    logger.info({
      event: 'file.saved',
      jobId: 'j1',
      requestId: 'r1',
      durationMs: 5,
      path: '/tmp/uploads/j1/input.mp3',
      text: 'secret text',
      content: 'secret body',
      transcript: 'full transcript',
      summary: 'summary content',
      apiKey: 'sk-123',
      authorization: 'Bearer xxx',
      file: 'audio.mp3',
      audioPath: '/tmp/audio.mp3',
    });
    const line = lines[0] as Record<string, unknown>;
    for (const key of [
      'path',
      'text',
      'content',
      'transcript',
      'summary',
      'apiKey',
      'authorization',
      'file',
      'audioPath',
    ]) {
      expect(line[key], key).toBe('[redacted]');
    }
    // 安全字段原样保留
    expect(line.event).toBe('file.saved');
    expect(line.jobId).toBe('j1');
    expect(line.requestId).toBe('r1');
    expect(line.durationMs).toBe(5);
  });

  it('脱敏键名不区分大小写', () => {
    const lines = capture();
    createLogger('debug').info({ event: 'e', Path: 'P', TEXT: 'T', AudioPath: 'A' });
    const line = lines[0] as Record<string, unknown>;
    expect(line.Path).toBe('[redacted]');
    expect(line.TEXT).toBe('[redacted]');
    expect(line.AudioPath).toBe('[redacted]');
  });

  it('脱敏:filePath/filepath 键(音频绝对路径,MusicMetadataDurationProbe 所用键)替换为 [redacted]', () => {
    const lines = capture();
    const logger = createLogger('debug');
    logger.info({
      event: 'probe.duration',
      filePath: 'C:/uploads/j1/input.mp3',
      filepath: '/var/data/j2/audio.mp3',
    });
    const line = lines[0] as Record<string, unknown>;
    expect(line.filePath).toBe('[redacted]');
    expect(line.filepath).toBe('[redacted]');
    // 原始路径不得出现在任何日志行中
    expect(JSON.stringify(lines)).not.toContain('input.mp3');
    expect(JSON.stringify(lines)).not.toContain('audio.mp3');
  });
});
