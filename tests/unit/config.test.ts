import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyDevelopmentCredentialOverrides,
  ConfigError,
  loadConfig,
} from '../../src/bootstrap/config.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV: NodeJS.ProcessEnv = {
  OPENAI_API_KEY: 'hk-test',
  OPENAI_BASE_URL: 'https://api.openai-hk.com/v1',
  OPENAI_SUMMARY_MODEL: 'gpt-4o',
  DASHSCOPE_API_KEY: 'sk-test',
  TEMP_DIR: 'temp',
  WEATHER_BASE_URL: 'https://wttr.in',
};

/** 取同步抛出的错误消息; 未抛出则判定失败。 */
function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected function to throw');
}

describe('loadConfig', () => {
  it('开发环境只允许本地 .env 覆盖两域凭据与网关地址', () => {
    const env: NodeJS.ProcessEnv = {
      OPENAI_API_KEY: 'global-key',
      OPENAI_BASE_URL: 'https://global.example/v1',
      OPENAI_SUMMARY_MODEL: 'global-model',
      DASHSCOPE_API_KEY: 'global-sk',
      QWEN_ASR_ENDPOINT: 'https://global-qwen.example/generation',
      PORT: '4000',
      WEATHER_TIMEOUT_MS: '1',
    };
    applyDevelopmentCredentialOverrides(
      env,
      {
        OPENAI_API_KEY: 'local-key',
        OPENAI_BASE_URL: 'https://local.example/v1',
        OPENAI_SUMMARY_MODEL: 'local-model',
        DASHSCOPE_API_KEY: 'local-sk',
        QWEN_ASR_ENDPOINT: 'https://local-qwen.example/generation',
        PORT: '3000',
        WEATHER_TIMEOUT_MS: '15000',
      },
      'development',
    );

    // 只有两域凭据与网关地址被 .env 覆盖; 模型名/端口/超时等仍以显式进程变量为准
    expect(env).toMatchObject({
      OPENAI_API_KEY: 'local-key',
      OPENAI_BASE_URL: 'https://local.example/v1',
      DASHSCOPE_API_KEY: 'local-sk',
      QWEN_ASR_ENDPOINT: 'https://local-qwen.example/generation',
      OPENAI_SUMMARY_MODEL: 'global-model',
      PORT: '4000',
      WEATHER_TIMEOUT_MS: '1',
    });
  });

  it('非开发环境不使用本地 .env 覆盖显式进程变量', () => {
    const env: NodeJS.ProcessEnv = {
      OPENAI_API_KEY: 'process-key',
      OPENAI_BASE_URL: 'https://process.example/v1',
    };
    applyDevelopmentCredentialOverrides(
      env,
      {
        OPENAI_API_KEY: 'local-key',
        OPENAI_BASE_URL: 'https://local.example/v1',
      },
      'production',
    );

    expect(env).toEqual({
      OPENAI_API_KEY: 'process-key',
      OPENAI_BASE_URL: 'https://process.example/v1',
    });
  });

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
    expect(config.qwen.apiKey).toBe('sk-test');
    expect(config.weather.baseUrl).toBe('https://wttr.in');
    expect(config.weather.timeoutMs).toBe(15000);
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

  it('天气配置: 显式覆盖、缺失与非法值校验', () => {
    const config = loadConfig({
      ...BASE_ENV,
      WEATHER_BASE_URL: 'http://localhost:8080',
      WEATHER_TIMEOUT_MS: '2500',
    });
    expect(config.weather).toEqual({ baseUrl: 'http://localhost:8080', timeoutMs: 2500 });
    expect(() => loadConfig({ ...BASE_ENV, WEATHER_TIMEOUT_MS: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE_ENV, WEATHER_TIMEOUT_MS: '0' })).toThrow(ConfigError);
    const missing = { ...BASE_ENV };
    delete missing.WEATHER_BASE_URL;
    expect(() => loadConfig(missing)).toThrow(/WEATHER_BASE_URL/);
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

  it('B6 安全配置: TRUST_PROXY 与 CORS 白名单默认值', () => {
    const config = loadConfig(BASE_ENV);
    expect(config.security).toEqual({ trustProxy: false, corsAllowedOrigins: [] });
  });

  it('B6 安全配置: TRUST_PROXY 白名单解析(非法值启动即失败)', () => {
    expect(loadConfig({ ...BASE_ENV, TRUST_PROXY: 'true' }).security.trustProxy).toBe(true);
    expect(loadConfig({ ...BASE_ENV, TRUST_PROXY: '1' }).security.trustProxy).toBe(true);
    expect(loadConfig({ ...BASE_ENV, TRUST_PROXY: 'false' }).security.trustProxy).toBe(false);
    expect(loadConfig({ ...BASE_ENV, TRUST_PROXY: '0' }).security.trustProxy).toBe(false);
    expect(() => loadConfig({ ...BASE_ENV, TRUST_PROXY: 'maybe' })).toThrow(/TRUST_PROXY/);
  });

  it('B6 安全配置: CORS 白名单逗号分隔解析, 空值=同源, 禁止通配符与无 scheme 项', () => {
    expect(
      loadConfig({
        ...BASE_ENV,
        CORS_ALLOWED_ORIGINS: 'https://app.example.com, https://admin.example.com',
      }).security.corsAllowedOrigins,
    ).toEqual(['https://app.example.com', 'https://admin.example.com']);
    expect(
      loadConfig({ ...BASE_ENV, CORS_ALLOWED_ORIGINS: '  ' }).security.corsAllowedOrigins,
    ).toEqual([]);
    expect(() => loadConfig({ ...BASE_ENV, CORS_ALLOWED_ORIGINS: '*' })).toThrow(
      /CORS_ALLOWED_ORIGINS/,
    );
    expect(() => loadConfig({ ...BASE_ENV, CORS_ALLOWED_ORIGINS: 'example.com' })).toThrow(
      /CORS_ALLOWED_ORIGINS/,
    );
  });

  it('A6 转录域配置: 默认值(端点/模型/超时/说话人分离/重试)', () => {
    const config = loadConfig(BASE_ENV);
    expect(config.qwen).toEqual({
      apiKey: 'sk-test',
      endpoint:
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      model: 'qwen-audio-3.1-asr-flash',
      timeoutMs: 300000,
      speakerDiarization: true,
      maxRetries: 2,
    });
  });

  it('A6 转录域配置: 显式覆盖与非法值校验', () => {
    const config = loadConfig({
      ...BASE_ENV,
      QWEN_ASR_ENDPOINT: 'https://w.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/x/generation',
      QWEN_ASR_MODEL: 'qwen-audio-custom',
      QWEN_ASR_TIMEOUT_MS: '60000',
      QWEN_ASR_SPEAKER_DIARIZATION: 'false',
      QWEN_ASR_MAX_RETRIES: '0',
    });
    expect(config.qwen.endpoint).toBe(
      'https://w.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/x/generation',
    );
    expect(config.qwen.model).toBe('qwen-audio-custom');
    expect(config.qwen.timeoutMs).toBe(60000);
    expect(config.qwen.speakerDiarization).toBe(false);
    expect(config.qwen.maxRetries).toBe(0);

    expect(() => loadConfig({ ...BASE_ENV, QWEN_ASR_TIMEOUT_MS: '0' })).toThrow(ConfigError); // min 1
    expect(() => loadConfig({ ...BASE_ENV, QWEN_ASR_MAX_RETRIES: '-1' })).toThrow(ConfigError); // min 0
    expect(() => loadConfig({ ...BASE_ENV, QWEN_ASR_SPEAKER_DIARIZATION: 'yes' })).toThrow(
      /QWEN_ASR_SPEAKER_DIARIZATION/,
    );
  });

  it('A6 两域凭据隔离: 缺失哪域只报哪域的变量名', () => {
    const noDashscope = { ...BASE_ENV };
    delete noDashscope.DASHSCOPE_API_KEY;
    expect(messageOf(() => loadConfig(noDashscope))).toBe(
      'Missing required env var: DASHSCOPE_API_KEY',
    );

    const noOpenai = { ...BASE_ENV };
    delete noOpenai.OPENAI_API_KEY;
    expect(messageOf(() => loadConfig(noOpenai))).toBe('Missing required env var: OPENAI_API_KEY');
  });

  it('A6 上限: 默认时长 300s, 上传 15 MiB(编码后约 20 MiB, 实测 data-uri 上限)', () => {
    const config = loadConfig(BASE_ENV);
    expect(config.limits.maxAudioDurationSeconds).toBe(300);
    expect(config.storage.maxUploadBytes).toBe(15728640);
  });

  it('A6 上限: 可显式放宽, 非法值启动即失败', () => {
    expect(
      loadConfig({ ...BASE_ENV, MAX_AUDIO_DURATION_SECONDS: '600', MAX_UPLOAD_BYTES: '1024' })
        .limits.maxAudioDurationSeconds,
    ).toBe(600);
    expect(loadConfig({ ...BASE_ENV, MAX_UPLOAD_BYTES: '1024' }).storage.maxUploadBytes).toBe(1024);
    expect(() => loadConfig({ ...BASE_ENV, MAX_AUDIO_DURATION_SECONDS: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...BASE_ENV, MAX_UPLOAD_BYTES: '0' })).toThrow(ConfigError);
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
