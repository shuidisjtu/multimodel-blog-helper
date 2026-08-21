/**
 * FileJobRepository 集成测试(架构文档 §9):真实临时目录 + fake 时钟/ID 生成器。
 * 覆盖: create/get/update 原子写、createOrGet 幂等三角色(created/replayed/conflict)、
 * 列表方法(含损坏文件容忍)与 remove。
 */

import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../src/domain/errors.js';
import type { BlogJob } from '../../src/domain/job.js';
import type { CreateJobParams } from '../../src/domain/ports.js';
import { FileJobRepository } from '../../src/infrastructure/repository/file-job-repository.js';
import type { Clock } from '../../src/shared/clock.js';
import type { IdGenerator } from '../../src/shared/ids.js';

/** 可控时钟: now() 返回可手动推进的固定值。 */
class FakeClock implements Clock {
  value = '2026-08-12T08:00:00.000Z';
  now(): string {
    return this.value;
  }
}

/** 确定性 ID 序列: job-1, job-2, ... */
class FakeIds implements IdGenerator {
  private n = 0;
  nextId(): string {
    this.n += 1;
    return `job-${this.n}`;
  }
}

const INPUT_SHA = createHash('sha256').update('audio bytes').digest('hex');

function makeParams(overrides: Partial<CreateJobParams> = {}): CreateJobParams {
  return {
    requestId: 'req-1',
    input: {
      path: '/tmp/uploads/job-1/input.mp3',
      originalName: 'demo.mp3',
      mimeType: 'audio/mpeg',
      bytes: 11,
      sha256: INPUT_SHA,
    },
    expiresAt: '2026-08-13T08:00:00.000Z',
    ...overrides,
  };
}

function makeRepo(clock = new FakeClock(), ids = new FakeIds()): FileJobRepository {
  return new FileJobRepository(tempDir, clock, ids);
}

function sha256Of(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'blog-helper-repo-'));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('FileJobRepository(架构文档 §4.2/§5/§7.1)', () => {
  it('create: 生成 id/createdAt/updatedAt, 文件落盘且含全部字段, expiresAt 使用传入值', async () => {
    const clock = new FakeClock();
    const repo = makeRepo(clock);
    const job = await repo.create(makeParams());
    expect(job.id).toBe('job-1');
    expect(job.status).toBe('queued');
    expect(job.createdAt).toBe(clock.value);
    expect(job.updatedAt).toBe(clock.value);
    expect(job.expiresAt).toBe('2026-08-13T08:00:00.000Z');
    const onDisk = JSON.parse(
      await readFile(join(tempDir, 'jobs', 'job-1.json'), 'utf8'),
    ) as unknown;
    expect(onDisk).toEqual(job);
  });

  it('create 带 params.id 时使用该 id', async () => {
    const repo = makeRepo();
    const job = await repo.create(makeParams({ id: 'custom-42' }));
    expect(job.id).toBe('custom-42');
    await expect(readFile(join(tempDir, 'jobs', 'custom-42.json'), 'utf8')).resolves.toContain(
      'custom-42',
    );
  });

  it('get: 存在返回完整 job, 不存在返回 null', async () => {
    const repo = makeRepo();
    const created = await repo.create(makeParams({ id: 'get-1' }));
    await expect(repo.get('get-1')).resolves.toEqual(created);
    await expect(repo.get('missing-1')).resolves.toBeNull();
  });

  it('get: JSON 损坏或缺失必填字段抛 DomainError(INTERNAL_ERROR), 不返回残缺对象', async () => {
    const repo = makeRepo();
    await writeFile(join(tempDir, 'jobs', 'bad-syntax.json'), '{ not valid json', 'utf8');
    await writeFile(join(tempDir, 'jobs', 'bad-fields.json'), '{"id": 1}', 'utf8');
    await expect(repo.get('bad-syntax')).rejects.toBeInstanceOf(DomainError);
    await expect(repo.get('bad-fields')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('get: 损坏文件错误 message 不含内部路径(§8.1), path 仅在 details 中', async () => {
    const repo = makeRepo();
    const filePath = join(tempDir, 'jobs', 'bad-syntax.json');
    await writeFile(filePath, '{ not valid json', 'utf8');
    const err = (await repo.get('bad-syntax').catch((e: unknown) => e)) as DomainError;
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.message).toBe('Corrupt job file');
    expect(err.message).not.toContain(tempDir);
    expect(err.message).not.toContain('/');
    expect(err.details).toMatchObject({ path: filePath });
  });

  it('update: mutator 修改 status/result 后落盘, updatedAt 强制刷新为最新, 缺失 id 抛 JOB_NOT_FOUND', async () => {
    const clock = new FakeClock();
    const repo = makeRepo(clock);
    await repo.create(makeParams({ id: 'upd-1' }));
    clock.value = '2026-08-12T09:00:00.000Z';
    const updated = await repo.update('upd-1', (j) => ({
      ...j,
      status: 'succeeded',
      result: { transcriptPath: '/tmp/o/upd-1/transcript.txt', summary: 's', model: 'whisper-1' },
    }));
    expect(updated.status).toBe('succeeded');
    expect(updated.updatedAt).toBe('2026-08-12T09:00:00.000Z');
    const onDisk = JSON.parse(
      await readFile(join(tempDir, 'jobs', 'upd-1.json'), 'utf8'),
    ) as BlogJob;
    expect(onDisk.status).toBe('succeeded');
    expect(onDisk.updatedAt).toBe('2026-08-12T09:00:00.000Z');
    expect(onDisk.result).toEqual({
      transcriptPath: '/tmp/o/upd-1/transcript.txt',
      summary: 's',
      model: 'whisper-1',
    });
    await expect(repo.update('no-such', (j) => j)).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' });
  });

  it('update 原子写: 写后目录不残留 .tmp 文件', async () => {
    const repo = makeRepo();
    await repo.create(makeParams({ id: 'tmp-1' }));
    await repo.update('tmp-1', (j) => ({ ...j, status: 'transcribing' }));
    const entries = await readdir(join(tempDir, 'jobs'));
    expect(entries.filter((e) => e.includes('.tmp'))).toEqual([]);
    await expect(readFile(join(tempDir, 'jobs', 'tmp-1.json'), 'utf8')).resolves.toContain(
      'transcribing',
    );
  });

  it('createOrGet 幂等: 同 key 同 sha256 → 第二次 replayed 且 job.id 与首次一致, 文件仍只有一份', async () => {
    const repo = makeRepo();
    const first = await repo.createOrGetByIdempotencyKey(
      makeParams({ idempotencyKey: 'key-triangle' }),
    );
    expect(first.outcome).toBe('created');
    const second = await repo.createOrGetByIdempotencyKey(
      makeParams({ idempotencyKey: 'key-triangle' }),
    );
    expect(second.outcome).toBe('replayed');
    expect(second.job.id).toBe(first.job.id);
    expect(second.job).toEqual(first.job);
    // 占位文件内容仍指向首次 job, 且无 .tmp 残留
    const placeholder = JSON.parse(
      await readFile(join(tempDir, 'jobs', 'by-key', `${sha256Of('key-triangle')}.json`), 'utf8'),
    ) as { jobId: string; sha256: string };
    expect(placeholder.jobId).toBe(first.job.id);
    expect(placeholder.sha256).toBe(INPUT_SHA);
    const keysDir = await readdir(join(tempDir, 'jobs', 'by-key'));
    expect(keysDir.filter((e) => e.includes('.tmp'))).toEqual([]);
  });

  it('createOrGet 幂等: 同 key 不同 sha256 → conflict, 返回首次 job', async () => {
    const repo = makeRepo();
    const first = await repo.createOrGetByIdempotencyKey(
      makeParams({ idempotencyKey: 'key-conflict' }),
    );
    const otherSha = createHash('sha256').update('other bytes').digest('hex');
    const second = await repo.createOrGetByIdempotencyKey(
      makeParams({
        idempotencyKey: 'key-conflict',
        input: { ...makeParams().input, sha256: otherSha },
      }),
    );
    expect(second.outcome).toBe('conflict');
    expect(second.job.id).toBe(first.job.id);
  });

  it('createOrGet 幂等: 不同 key → 各自 created, 两个独立 job', async () => {
    const repo = makeRepo();
    const a = await repo.createOrGetByIdempotencyKey(makeParams({ idempotencyKey: 'key-a' }));
    const b = await repo.createOrGetByIdempotencyKey(makeParams({ idempotencyKey: 'key-b' }));
    expect(a.outcome).toBe('created');
    expect(b.outcome).toBe('created');
    expect(a.job.id).not.toBe(b.job.id);
    await expect(readFile(join(tempDir, 'jobs', `${a.job.id}.json`), 'utf8')).resolves.toContain(
      a.job.id,
    );
    await expect(readFile(join(tempDir, 'jobs', `${b.job.id}.json`), 'utf8')).resolves.toContain(
      b.job.id,
    );
  });

  it('createOrGet: 占位指向 tombstone(已清空 input)时 → replayed 返回原 Job, 不比对 sha256', async () => {
    const repo = makeRepo();
    await repo.createOrGetByIdempotencyKey(
      makeParams({ idempotencyKey: 'key-tomb', id: 'tomb-1' }),
    );
    // 模拟清理: 任务转为最小 tombstone(清空 input/idempotencyKey, §4.2)
    await repo.update('tomb-1', (j) => ({
      id: j.id,
      requestId: j.requestId,
      status: 'expired',
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      expiresAt: j.expiresAt,
    }));
    const outcome = await repo.createOrGetByIdempotencyKey(
      makeParams({ idempotencyKey: 'key-tomb' }),
    );
    expect(outcome.outcome).toBe('replayed');
    expect(outcome.job.id).toBe('tomb-1');
    expect(outcome.job.status).toBe('expired');
  });

  it('createOrGet: idempotencyKey 持久化到 job 元数据(文件落盘可见)', async () => {
    const repo = makeRepo();
    const { job } = await repo.createOrGetByIdempotencyKey(
      makeParams({ idempotencyKey: 'key-meta', id: 'meta-1' }),
    );
    expect(job.idempotencyKey).toBe('key-meta');
    const onDisk = JSON.parse(
      await readFile(join(tempDir, 'jobs', 'meta-1.json'), 'utf8'),
    ) as BlogJob;
    expect(onDisk.idempotencyKey).toBe('key-meta');
  });

  it('create 带 idempotencyKey 时同步写占位, 后续 createOrGet 同 key 同 sha256 → replayed(两条路径一致)', async () => {
    const repo = makeRepo();
    const created = await repo.create(makeParams({ idempotencyKey: 'key-create-path', id: 'c1' }));
    expect(created.id).toBe('c1');
    const placeholder = JSON.parse(
      await readFile(
        join(tempDir, 'jobs', 'by-key', `${sha256Of('key-create-path')}.json`),
        'utf8',
      ),
    ) as { jobId: string };
    expect(placeholder.jobId).toBe('c1');
    const outcome = await repo.createOrGetByIdempotencyKey(
      makeParams({ idempotencyKey: 'key-create-path' }),
    );
    expect(outcome.outcome).toBe('replayed');
    expect(outcome.job.id).toBe('c1');
  });

  it('createOrGet: 占位孤儿(job 已删除)被清理并重试完整创建', async () => {
    const repo = makeRepo();
    const keyPath = join(tempDir, 'jobs', 'by-key', `${sha256Of('key-orphan')}.json`);
    await writeFile(keyPath, JSON.stringify({ jobId: 'ghost-job', sha256: INPUT_SHA }), 'utf8');
    const { outcome, job } = await repo.createOrGetByIdempotencyKey(
      makeParams({ idempotencyKey: 'key-orphan' }),
    );
    expect(outcome).toBe('created');
    expect(job.id).not.toBe('ghost-job');
    const placeholder = JSON.parse(await readFile(keyPath, 'utf8')) as { jobId: string };
    expect(placeholder.jobId).toBe(job.id);
  });

  it('createOrGet: 占位文件为空/JSON 损坏/字段缺失 → INTERNAL_ERROR(保守失败)', async () => {
    const repo = makeRepo();
    await writeFile(join(tempDir, 'jobs', 'by-key', `${sha256Of('key-empty')}.json`), '', 'utf8');
    await writeFile(
      join(tempDir, 'jobs', 'by-key', `${sha256Of('key-corrupt')}.json`),
      '{oops',
      'utf8',
    );
    await writeFile(
      join(tempDir, 'jobs', 'by-key', `${sha256Of('key-shape')}.json`),
      '{"foo": 1}',
      'utf8',
    );
    for (const key of ['key-empty', 'key-corrupt', 'key-shape']) {
      await expect(
        repo.createOrGetByIdempotencyKey(makeParams({ idempotencyKey: key })),
      ).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
      });
    }
  });

  it('createOrGet: 占位损坏错误 message 不含路径与 key(§8.1), 细节仅在 details 中', async () => {
    const repo = makeRepo();
    const key = 'key-secret-value';
    const keyPath = join(tempDir, 'jobs', 'by-key', `${sha256Of(key)}.json`);
    await writeFile(keyPath, '{oops', 'utf8');
    const err = (await repo
      .createOrGetByIdempotencyKey(makeParams({ idempotencyKey: key }))
      .catch((e: unknown) => e)) as DomainError;
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.message).toBe('Idempotency placeholder corrupt');
    expect(err.message).not.toContain(tempDir);
    expect(err.message).not.toContain('/');
    expect(err.message).not.toContain(key);
    expect(err.details).toMatchObject({ path: keyPath });
  });

  it('createOrGet 无 idempotencyKey 时退化为普通 create', async () => {
    const repo = makeRepo();
    const { outcome, job } = await repo.createOrGetByIdempotencyKey(makeParams({ id: 'no-key-1' }));
    expect(outcome).toBe('created');
    expect(job.id).toBe('no-key-1');
  });

  it('listRecoverable: 只含 queued(transcribing/succeeded 被排除)', async () => {
    const repo = makeRepo();
    await repo.create(makeParams({ id: 'rec-q1' }));
    await repo.create(makeParams({ id: 'rec-t' }));
    await repo.update('rec-t', (j) => ({ ...j, status: 'transcribing' }));
    await repo.create(makeParams({ id: 'rec-s' }));
    await repo.update('rec-s', (j) => ({
      ...j,
      status: 'succeeded',
      result: { transcriptPath: 't', summary: 's', model: 'm' },
    }));
    const list = await repo.listRecoverable();
    expect(list.every((j) => j.status === 'queued')).toBe(true);
    expect(list.map((j) => j.id)).toEqual(expect.arrayContaining(['rec-q1']));
  });

  it('listInProgress: 只含 transcribing/summarizing', async () => {
    const repo = makeRepo();
    await repo.create(makeParams({ id: 'prog-t' }));
    await repo.update('prog-t', (j) => ({ ...j, status: 'transcribing' }));
    await repo.create(makeParams({ id: 'prog-s' }));
    await repo.update('prog-s', (j) => ({ ...j, status: 'summarizing' }));
    await repo.create(makeParams({ id: 'prog-q' }));
    const list = await repo.listInProgress();
    expect(list.every((j) => j.status === 'transcribing' || j.status === 'summarizing')).toBe(true);
    expect(list.map((j) => j.id)).toEqual(expect.arrayContaining(['prog-t', 'prog-s']));
  });

  it('listExpired: expiresAt 已过(含 expired tombstone)列出, 未过期不列出', async () => {
    const repo = makeRepo();
    await repo.create(makeParams({ id: 'exp-past', expiresAt: '2026-01-01T00:00:00.000Z' }));
    await repo.create(makeParams({ id: 'exp-future', expiresAt: '2099-01-01T00:00:00.000Z' }));
    await repo.create(makeParams({ id: 'exp-tomb', expiresAt: '2026-01-01T00:00:00.000Z' }));
    await repo.update('exp-tomb', (j) => ({ ...j, status: 'expired' }));
    const list = await repo.listExpired('2026-08-12T08:00:00.000Z');
    const ids = list.map((j) => j.id);
    expect(ids).toEqual(expect.arrayContaining(['exp-past', 'exp-tomb']));
    expect(ids).not.toContain('exp-future');
    expect(list.every((j) => j.expiresAt < '2026-08-12T08:00:00.000Z')).toBe(true);
  });

  it('remove: 删除 job 文件与对应幂等占位文件; 再次 remove 不抛错', async () => {
    const repo = makeRepo();
    await repo.createOrGetByIdempotencyKey(makeParams({ idempotencyKey: 'key-rm', id: 'rm-1' }));
    await repo.remove('rm-1');
    await expect(readFile(join(tempDir, 'jobs', 'rm-1.json'))).rejects.toThrow();
    await expect(
      readFile(join(tempDir, 'jobs', 'by-key', `${sha256Of('key-rm')}.json`)),
    ).rejects.toThrow();
    await expect(repo.remove('rm-1')).resolves.toBeUndefined();
  });

  it('remove: job 文件损坏时仍尽力删除且不抛错(清理不可中断)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const repo = makeRepo();
    await writeFile(join(tempDir, 'jobs', 'rm-broken.json'), '{broken', 'utf8');
    await expect(repo.remove('rm-broken')).resolves.toBeUndefined();
    await expect(readFile(join(tempDir, 'jobs', 'rm-broken.json'))).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('损坏 JSON / .tmp 残留: list* 跳过不抛错, 其他任务正常返回, 且记录日志', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const repo = makeRepo();
    await repo.create(makeParams({ id: 'ok-1' }));
    await writeFile(join(tempDir, 'jobs', 'broken.json'), '{ not valid json', 'utf8');
    await writeFile(join(tempDir, 'jobs', 'leftover.json.tmp'), 'garbage', 'utf8');
    const recoverable = await repo.listRecoverable();
    expect(recoverable.map((j) => j.id)).toEqual(expect.arrayContaining(['ok-1']));
    await expect(repo.listInProgress()).resolves.toBeDefined();
    await expect(repo.listExpired('2099-01-01T00:00:00.000Z')).resolves.toBeDefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
