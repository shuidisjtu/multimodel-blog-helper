import { describe, expect, it } from 'vitest';
import { ProcessJob } from '../../src/application/process-job.js';
import { DomainError } from '../../src/domain/errors.js';
import type { BlogJob } from '../../src/domain/job.js';
import type {
  FileStore,
  JobRepository,
  SaveOutputParams,
  Summarizer,
  Summary,
  Transcriber,
  Transcript,
} from '../../src/domain/ports.js';
import type { LogFields, Logger } from '../../src/shared/logger.js';

const FIXED_NOW = '2026-08-12T00:00:00.000Z';

/** 记录型 fake 日志: 每个调用打上 level 便于断言。 */
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

/** 内存 fake 仓储: 记录 update 调用次数; 移除/损坏等场景可编程注入。 */
class InMemoryJobRepo implements JobRepository {
  readonly jobs = new Map<string, BlogJob>();
  updateCount = 0;

  async create(): Promise<BlogJob> {
    throw new Error('not used in ProcessJob tests');
  }

  async createOrGetByIdempotencyKey(): Promise<never> {
    throw new Error('not used in ProcessJob tests');
  }

  async get(id: string): Promise<BlogJob | null> {
    return this.jobs.get(id) ?? null;
  }

  async update(id: string, mutator: (job: BlogJob) => BlogJob): Promise<BlogJob> {
    this.updateCount++;
    const job = this.jobs.get(id);
    if (job === undefined) throw new DomainError('JOB_NOT_FOUND', `Job not found: ${id}`);
    const updated = mutator(job);
    this.jobs.set(id, updated);
    return updated;
  }

  async listRecoverable(): Promise<BlogJob[]> {
    return [...this.jobs.values()].filter((j) => j.status === 'queued');
  }

  async listInProgress(): Promise<BlogJob[]> {
    return [...this.jobs.values()].filter((j) => j.status === 'transcribing' || j.status === 'summarizing');
  }

  async listExpired(): Promise<BlogJob[]> {
    return [];
  }

  async remove(): Promise<void> {
    throw new Error('not used in ProcessJob tests');
  }
}

/** 记录型 fake 文件仓: saveOutput 固定路径并记录调用。 */
class FakeFileStore implements FileStore {
  readonly savedOutputs: SaveOutputParams[] = [];

  async saveInput(): Promise<{ path: string; sha256: string }> {
    throw new Error('not used in ProcessJob tests');
  }

  async saveOutput(params: SaveOutputParams): Promise<{ path: string }> {
    this.savedOutputs.push(params);
    return { path: `/tmp/outputs/${params.jobId}/${params.kind}.txt` };
  }

  async read(): Promise<Buffer> {
    return Buffer.alloc(0);
  }

  async deleteJobFiles(): Promise<number> {
    return 0;
  }
}

/** 可编程 fake 转录器: 可注入错误。 */
class FakeTranscriber implements Transcriber {
  calls = 0;
  error: unknown;

  async transcribe(): Promise<Transcript> {
    this.calls++;
    if (this.error !== undefined) throw this.error;
    return { text: 'transcript text' };
  }
}

/** 可编程 fake 摘要器: 可注入错误。 */
class FakeSummarizer implements Summarizer {
  calls = 0;
  error: unknown;

  async summarize(): Promise<Summary> {
    this.calls++;
    if (this.error !== undefined) throw this.error;
    return { text: 'summary text' };
  }
}

function makeJob(overrides: Partial<BlogJob> = {}): BlogJob {
  return {
    id: 'job-1',
    requestId: 'req-1',
    status: 'queued',
    input: {
      path: '/tmp/uploads/job-1/input.bin',
      originalName: 'demo.mp3',
      mimeType: 'audio/mpeg',
      bytes: 1024,
      sha256: 'abc123',
    },
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    expiresAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

function setup(overrides?: {
  transcriber?: Transcriber;
  summarizer?: Summarizer;
  files?: FileStore;
}) {
  const repo = new InMemoryJobRepo();
  const files = overrides?.files ?? new FakeFileStore();
  const transcriber = overrides?.transcriber ?? new FakeTranscriber();
  const summarizer = overrides?.summarizer ?? new FakeSummarizer();
  const logger = new FakeLogger();
  const useCase = new ProcessJob({
    jobs: repo,
    files,
    transcriber,
    summarizer,
    logger,
    transcribeModel: 'whisper-1',
  });
  // 默认场景(不带 overrides)下返回具体 fake 类型, 测试可直接访问 calls/error 等记录字段
  return {
    repo,
    files: files as FakeFileStore,
    transcriber: transcriber as FakeTranscriber,
    summarizer: summarizer as FakeSummarizer,
    logger,
    useCase,
  };
}

describe('ProcessJob(架构文档 §4.1/§6.3-§6.4)', () => {
  it('完整成功: queued→transcribing→summarizing→succeeded, 结果/产物/日志正确', async () => {
    const { repo, files, transcriber, summarizer, logger, useCase } = setup();
    repo.jobs.set('job-1', makeJob());

    await useCase.run('job-1');

    const job = repo.jobs.get('job-1')!;
    expect(job.status).toBe('succeeded');
    expect(job.result).toEqual({
      transcriptPath: '/tmp/outputs/job-1/transcript.txt',
      summary: 'summary text',
      model: 'whisper-1',
    });
    expect(transcriber.calls).toBe(1);
    expect(summarizer.calls).toBe(1);
    expect(files.savedOutputs.map((o) => o.kind)).toEqual(['transcript', 'summary']); // 产物保存两次
    expect(files.savedOutputs[0]).toMatchObject({ jobId: 'job-1', content: 'transcript text' });
    expect(files.savedOutputs[1]).toMatchObject({ jobId: 'job-1', content: 'summary text' });

    // 每次迁移有日志(event: job.status)
    const statusLogs = logger.calls.filter((c) => c.event === 'job.status');
    expect(statusLogs.map((l) => l.from)).toEqual(['queued', 'transcribing', 'summarizing']);
    expect(statusLogs.map((l) => l.to)).toEqual(['transcribing', 'summarizing', 'succeeded']);
    // 转录日志记录 durationMs 与 model
    const transcribedLog = logger.calls.find((c) => c.event === 'job.transcribed');
    expect(transcribedLog?.model).toBe('whisper-1');
    expect(typeof transcribedLog?.durationMs).toBe('number');
    expect(logger.calls.some((c) => c.event === 'job.summarized')).toBe(true);
  });

  it('转录失败(DomainError): 转 failed 且 failure.code 保留', async () => {
    const { repo, transcriber, logger, useCase } = setup();
    repo.jobs.set('job-1', makeJob());
    transcriber.error = new DomainError('WEATHER_UNAVAILABLE', 'Upstream unavailable');

    await useCase.run('job-1');

    const job = repo.jobs.get('job-1')!;
    expect(job.status).toBe('failed');
    expect(job.failure).toEqual({ code: 'WEATHER_UNAVAILABLE', safeMessage: 'Upstream unavailable' });
    expect(job.result).toBeUndefined();
    expect(logger.calls.some((c) => c.level === 'error' && c.errorCode === 'WEATHER_UNAVAILABLE')).toBe(true);
  });

  it('摘要失败(非 DomainError): 转 failed + INTERNAL_ERROR + 通用文案, logger.error 记录原始错误', async () => {
    const { repo, summarizer, logger, useCase } = setup();
    repo.jobs.set('job-1', makeJob());
    summarizer.error = new Error('boom');

    await useCase.run('job-1');

    const job = repo.jobs.get('job-1')!;
    expect(job.status).toBe('failed');
    expect(job.failure).toEqual({ code: 'INTERNAL_ERROR', safeMessage: 'Processing failed' });
    const errorLogs = logger.calls.filter((c) => c.level === 'error');
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs.some((c) => c.event === 'job.failed' && c.errorCode === 'INTERNAL_ERROR')).toBe(true);
    expect(errorLogs.some((c) => c.error !== undefined)).toBe(true);
  });

  it('job 不存在: 不抛错, 仅 warn(job.missing)', async () => {
    const { repo, useCase, logger } = setup();

    await expect(useCase.run('nope')).resolves.toBeUndefined();

    expect(logger.calls.some((c) => c.event === 'job.missing' && c.level === 'warn')).toBe(true);
    expect(repo.updateCount).toBe(0);
  });

  it('终态保护: 已 succeeded 任务再次 run 不执行任何端口调用', async () => {
    const { repo, files, transcriber, summarizer, useCase } = setup();
    repo.jobs.set(
      'job-1',
      makeJob({ status: 'succeeded', result: { transcriptPath: '/x', summary: 'y', model: 'm' } }),
    );

    await useCase.run('job-1');

    expect(transcriber.calls).toBe(0);
    expect(summarizer.calls).toBe(0);
    expect(files.savedOutputs).toHaveLength(0);
    expect(repo.updateCount).toBe(0);
  });

  it('处理失败但任务已被外部清理为 expired: 跳过转 failed, 状态保持 expired', async () => {
    const { repo, useCase } = setup({
      transcriber: {
        async transcribe() {
          // 模拟外部清理: 转录期间任务被标记 expired
          repo.jobs.set('job-1', { ...repo.jobs.get('job-1')!, status: 'expired' });
          throw new Error('boom');
        },
      },
    });
    repo.jobs.set('job-1', makeJob());

    await useCase.run('job-1');

    const job = repo.jobs.get('job-1')!;
    expect(job.status).toBe('expired'); // update 的 mutator 未把 expired 改回 failed
    expect(job.failure).toBeUndefined();
  });

  it('queued 任务缺少 input(端口违约/异常数据): 防御性跳过, 不处理不抛错', async () => {
    const { repo, files, transcriber, summarizer, logger, useCase } = setup();
    repo.jobs.set('job-1', makeJob({ input: undefined }));

    await expect(useCase.run('job-1')).resolves.toBeUndefined();

    expect(transcriber.calls).toBe(0);
    expect(summarizer.calls).toBe(0);
    expect(files.savedOutputs).toHaveLength(0);
    expect(logger.calls.some((c) => c.event === 'job.skipped' && c.reason === 'missing-input')).toBe(true);
  });

  it('处理失败且任务已被外部移除: 方法不抛错, 仅记录 warn', async () => {
    const { repo, logger, useCase } = setup({
      transcriber: {
        async transcribe() {
          repo.jobs.delete('job-1');
          throw new Error('boom');
        },
      },
    });
    repo.jobs.set('job-1', makeJob());

    await expect(useCase.run('job-1')).resolves.toBeUndefined();

    expect(logger.calls.some((c) => c.event === 'job.failed' && c.level === 'warn')).toBe(true);
  });
});
