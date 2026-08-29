import multer from 'multer';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/domain/errors.js';
import { errorHandler } from '../../src/interfaces/http/middleware/error-handler.js';
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

function makeRes() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    setHeaderCalls: [] as Array<[string, string]>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.setHeaderCalls.push([name, value]);
      return this;
    },
    locals: { requestId: 'req-abc' },
  };
  return res;
}

describe('errorHandler(架构文档 §8.1 错误边界, openapi.yaml 错误码表)', () => {
  it('DomainError: 按 openapi.yaml 映射状态码与稳定消息', () => {
    const logger = new FakeLogger();
    const handler = errorHandler(logger);
    const res = makeRes() as never;
    handler(
      new DomainError('INVALID_FILE', 'raw detail'),
      {} as never, // eslint 风格: 未用参数命名 _req
      res,
      (() => {
        throw new Error('next must not be called');
      }) as never,
    );
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect((res as { body: unknown }).body).toEqual({
      error: { code: 'INVALID_FILE', message: 'Invalid audio file' },
      requestId: 'req-abc',
    });
  });

  it('QUEUE_FULL: 503 且携带 Retry-After 头', () => {
    const handler = errorHandler(new FakeLogger());
    const res = makeRes() as never;
    handler(new DomainError('QUEUE_FULL', 'raw'), {} as never, res, (() => {
      throw new Error('next must not be called');
    }) as never);
    expect((res as { statusCode: number }).statusCode).toBe(503);
    expect((res as { setHeaderCalls: Array<[string, string]> }).setHeaderCalls).toContainEqual([
      'Retry-After',
      '1',
    ]);
  });

  it('MulterError LIMIT_FILE_SIZE → 413 FILE_TOO_LARGE', () => {
    const handler = errorHandler(new FakeLogger());
    const res = makeRes() as never;
    handler(new multer.MulterError('LIMIT_FILE_SIZE'), {} as never, res, (() => {
      throw new Error('next must not be called');
    }) as never);
    expect((res as { statusCode: number }).statusCode).toBe(413);
    expect((res as { body: unknown }).body).toMatchObject({ error: { code: 'FILE_TOO_LARGE' } });
  });

  it('MulterError LIMIT_UNEXPECTED_FILE(缺 file 字段) → 400 INVALID_FILE', () => {
    const handler = errorHandler(new FakeLogger());
    const res = makeRes() as never;
    handler(new multer.MulterError('LIMIT_UNEXPECTED_FILE'), {} as never, res, (() => {
      throw new Error('next must not be called');
    }) as never);
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect((res as { body: unknown }).body).toMatchObject({ error: { code: 'INVALID_FILE' } });
  });

  it('未知错误 → 500 INTERNAL_ERROR, 日志记录原始错误', () => {
    const logger = new FakeLogger();
    const handler = errorHandler(logger);
    const res = makeRes() as never;
    handler(new Error('boom'), {} as never, res, (() => {
      throw new Error('next must not be called');
    }) as never);
    expect((res as { statusCode: number }).statusCode).toBe(500);
    expect((res as { body: unknown }).body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    // 日志须携带实际错误消息(固定"已记录具体错误", 而非空对象/占位)
    expect(
      logger.calls.some(
        (c) => c.level === 'error' && c.error === 'boom' && c.errorCode === 'INTERNAL_ERROR',
      ),
    ).toBe(true);
  });

  it('B4 天气错误: INVALID_LOCATION/WEATHER_UNAVAILABLE 使用稳定业务响应', () => {
    const handler = errorHandler(new FakeLogger());
    for (const [code, status, message] of [
      ['INVALID_LOCATION', 422, 'Invalid location'],
      ['WEATHER_UNAVAILABLE', 503, 'Weather service is unavailable'],
    ] as const) {
      const res = makeRes() as never;
      handler(new DomainError(code, 'wttr raw body: secret'), {} as never, res, (() => {
        throw new Error('next must not be called');
      }) as never);
      expect((res as { statusCode: number }).statusCode).toBe(status);
      expect((res as { body: unknown }).body).toEqual({
        error: { code, message },
        requestId: 'req-abc',
      });
      expect(JSON.stringify((res as { body: unknown }).body)).not.toContain('secret');
    }
  });

  it('畸形 JSON body → 422 INVALID_LOCATION 且不泄漏解析细节', () => {
    const handler = errorHandler(new FakeLogger());
    const res = makeRes() as never;
    handler(
      { status: 400, type: 'entity.parse.failed', message: 'private parser detail' },
      {} as never,
      res,
      (() => {
        throw new Error('next must not be called');
      }) as never,
    );
    expect((res as { statusCode: number }).statusCode).toBe(422);
    expect((res as { body: unknown }).body).toEqual({
      error: { code: 'INVALID_LOCATION', message: 'Invalid location' },
      requestId: 'req-abc',
    });
  });
  it('所有契约错误码都有稳定的 message 映射', () => {
    const handler = errorHandler(new FakeLogger());
    for (const code of [
      'AUDIO_TOO_LONG',
      'IDEMPOTENCY_CONFLICT',
      'FILE_TOO_LARGE',
      'UNSUPPORTED_MEDIA_TYPE',
      'QUEUE_FULL',
    ] as const) {
      const res = makeRes() as never;
      handler(new DomainError(code, 'raw'), {} as never, res, (() => {
        throw new Error('next must not be called');
      }) as never);
      const body = (res as { body: { error: { code: string; message: string } } }).body;
      expect(body.error.code).toBe(code);
      expect(body.error.message.length).toBeGreaterThan(0);
    }
  });
});
