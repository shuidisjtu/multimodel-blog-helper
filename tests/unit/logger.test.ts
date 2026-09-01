import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, type LogFields } from '../../src/shared/logger.js';

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

  it('递归脱敏:嵌套对象中的敏感键同样替换, 安全键不受影响', () => {
    const lines = capture();
    const logger = createLogger('debug');
    logger.info({
      event: 'job.failed.detail',
      requestId: 'r1',
      detail: {
        path: '/tmp/uploads/j1/input.mp3',
        text: 'secret text',
        summary: '摘要',
        authorization: 'Bearer sk-abc',
        apiKey: 'sk-123',
      },
      meta: { durationMs: 7, attempt: 2 },
    });
    const line = lines[0] as Record<string, unknown>;
    const detail = line.detail as Record<string, unknown>;
    expect(detail.path).toBe('[redacted]');
    expect(detail.text).toBe('[redacted]');
    expect(detail.summary).toBe('[redacted]');
    expect(detail.authorization).toBe('[redacted]');
    expect(detail.apiKey).toBe('[redacted]');
    expect(line.meta).toEqual({ durationMs: 7, attempt: 2 });
    expect(line.requestId).toBe('r1');
    // 原始敏感值不得出现在任何日志行中
    expect(JSON.stringify(lines)).not.toContain('secret text');
    expect(JSON.stringify(lines)).not.toContain('input.mp3');
    expect(JSON.stringify(lines)).not.toContain('摘要');
  });

  it('递归脱敏:数组中嵌套对象/数组同样处理', () => {
    const lines = capture();
    const logger = createLogger('debug');
    logger.info({
      event: 'batch.processing',
      items: [
        { transcript: '片段一', path: '/tmp/a.mp3' },
        [{ content: '深层内容' }],
        'plain-string',
      ],
    });
    const line = lines[0] as Record<string, unknown>;
    const items = line.items as Array<Record<string, unknown>>;
    expect(items[0]).toEqual({ transcript: '[redacted]', path: '[redacted]' });
    expect(items[1]).toEqual([{ content: '[redacted]' }]);
    expect(items[2]).toBe('plain-string');
    expect(JSON.stringify(lines)).not.toContain('片段一');
    expect(JSON.stringify(lines)).not.toContain('深层内容');
    expect(JSON.stringify(lines)).not.toContain('/tmp/a.mp3');
  });

  it('递归脱敏:嵌套键名不区分大小写', () => {
    const lines = capture();
    const logger = createLogger('debug');
    logger.info({ event: 'e', detail: { Path: 'P', TEXT: 'T1', AudioPath: 'A' } });
    const line = lines[0] as Record<string, unknown>;
    expect(line.detail).toEqual({
      Path: '[redacted]',
      TEXT: '[redacted]',
      AudioPath: '[redacted]',
    });
  });

  it('递归脱敏:循环引用不导致栈溢出/崩溃, 记录为安全占位', () => {
    const lines = capture();
    const logger = createLogger('debug');
    const cyclic: LogFields = { event: 'e', summary: 's1' };
    cyclic.self = cyclic;
    logger.info(cyclic);
    const line = lines[0] as Record<string, unknown>;
    expect(line.event).toBe('e');
    expect(line.summary).toBe('[redacted]');
    expect(JSON.stringify(lines)).not.toContain('s1');
  });
});
