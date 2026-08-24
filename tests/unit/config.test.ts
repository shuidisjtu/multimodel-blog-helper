import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig } from '../../src/bootstrap/config.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV: NodeJS.ProcessEnv = {
  OPENAI_API_KEY: 'hk-test',
  OPENAI_BASE_URL: 'https://api.openai-hk.com/v1',
  OPENAI_TRANSCRIBE_MODEL: 'whisper-1',
  OPENAI_SUMMARY_MODEL: 'gpt-4o',
  TEMP_DIR: 'temp',
  WEATHER_BASE_URL: 'https://wttr.in',
};

describe('loadConfig(架构文档 §7.2)', () => {
  it('必填缺失时抛 ConfigError', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    const env = { ...BASE_ENV };
    delete env.OPENAI_API_KEY;
    expect(() => loadConfig(env)).toThrow(/OPENAI_API_KEY/);
  });

  it('必填齐全时加载成功,可选变量用默认值', () => {
    const config = loadConfig(BASE_ENV);
    expect(config.openai.apiKey).toBe('hk-test');
    expect(config.port).toBe(3000);
    expect(config.openai.transcribeTimeoutMs).toBe(600000);
    expect(config.limits.rateLimitUploadPerMinute).toBe(10);
    expect(config.metrics.port).toBe(9100);
    expect(config.nodeEnv).toBe('development');
  });

  it('非法整数报错而非静默接受', () => {
    expect(() => loadConfig({ ...BASE_ENV, PORT: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE_ENV, PORT: '-1' })).toThrow(ConfigError);
  });

  it('显式覆盖默认值生效', () => {
    const config = loadConfig({
      ...BASE_ENV,
      PORT: '8080',
      RATE_LIMIT_UPLOAD_PER_MINUTE: '5',
      LOG_LEVEL: 'debug',
    });
    expect(config.port).toBe(8080);
    expect(config.limits.rateLimitUploadPerMinute).toBe(5);
    expect(config.logLevel).toBe('debug');
  });

  it('非法 LOG_LEVEL 报错而非静默接受', () => {
    expect(() => loadConfig({ ...BASE_ENV, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('A4 新增配置: 摘要超时与重试次数默认值生效', () => {
    const config = loadConfig(BASE_ENV);
    expect(config.openai.summaryTimeoutMs).toBe(60000);
    expect(config.openai.maxRetries).toBe(2);
  });

  it('A4 新增配置: 显式覆盖与非法值校验', () => {
    const config = loadConfig({
      ...BASE_ENV,
      OPENAI_SUMMARY_TIMEOUT_MS: '30000',
      OPENAI_MAX_RETRIES: '0',
    });
    expect(config.openai.summaryTimeoutMs).toBe(30000);
    expect(config.openai.maxRetries).toBe(0);
    expect(() => loadConfig({ ...BASE_ENV, OPENAI_SUMMARY_TIMEOUT_MS: 'abc' })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig({ ...BASE_ENV, OPENAI_SUMMARY_TIMEOUT_MS: '0' })).toThrow(ConfigError); // min 1
    expect(() => loadConfig({ ...BASE_ENV, OPENAI_MAX_RETRIES: '-1' })).toThrow(ConfigError); // min 0
  });

  it('Node 版本低于 24 时抛 ConfigError(环境自检)', () => {
    const realVersions = process.versions;
    vi.spyOn(process, 'versions', 'get').mockReturnValue({
      ...realVersions,
      node: '22.14.0',
    });
    expect(() => loadConfig(BASE_ENV)).toThrow(/Node >= 24 required/);
  });

  it('Node 版本缺失或非法时抛 ConfigError', () => {
    const realVersions = process.versions;
    const mockVersions = (node: string) =>
      vi.spyOn(process, 'versions', 'get').mockReturnValue({ ...realVersions, node });
    mockVersions('');
    expect(() => loadConfig(BASE_ENV)).toThrow(/Cannot determine Node version/);
    mockVersions('abc');
    expect(() => loadConfig(BASE_ENV)).toThrow(/Node >= 24 required/);
  });
});
