#!/usr/bin/env node
/** 启动制品中编译后的后端并断言其能响应 HTTP; 用于在 CI 中证明制品可运行, 而不只是清单自洽。 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STARTUP_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 2_000;
const PORT = Number.parseInt(process.env.RELEASE_SMOKE_PORT ?? '3211', 10);
// 命中真实路由而非未知路径: 只有应用装好了路由与错误信封才会返回该业务错误码,
// 借此排除"express 起来了但业务没接上"以及"端口被别的进程占着"两种假通过。
const PROBE_PATH = '/api/v1/audio-jobs/00000000-0000-4000-8000-000000000000';
const PROBE_ERROR_CODE = 'JOB_NOT_FOUND';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** 轮询直到服务响应; 子进程若已退出则立即失败, 单次请求也必须有超时(否则对端静默时会挂死)。 */
async function waitForServer(url, isServerAlive) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    assert(
      isServerAlive(),
      `Packaged server exited with code ${server?.exitCode} before answering`,
    );
    try {
      return await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  return undefined;
}

let server;
try {
  const artifact = resolve(process.argv[2] ?? '');
  assert(process.argv[2], 'Usage: node scripts/release-smoke.mjs <artifact-directory>');

  const entry = join(artifact, 'dist', 'server', 'bootstrap', 'server.js');
  assert(existsSync(entry), `Missing packaged entry point: ${entry}`);

  // 模板占位配置, 不含真实凭据; 冒烟只请求本地未知路径, 不访问任何上游。
  const envFile = join(artifact, '.env');
  if (!existsSync(envFile)) copyFileSync(join(artifact, '.env.example'), envFile);

  const installArgs = ['ci', '--omit=dev', '--no-audit', '--no-fund'];
  // Windows 上不允许直接 spawn `npm.cmd`(Node 修 CVE-2024-27980 后要求 shell),
  // 因此优先用 npm 注入的 cli 路径, 经 npm run 调用时始终可用。
  const npmCli = process.env.npm_execpath;
  const install = npmCli
    ? spawnSync(process.execPath, [npmCli, ...installArgs], { cwd: artifact, stdio: 'inherit' })
    : spawnSync('npm', installArgs, { cwd: artifact, stdio: 'inherit', shell: true });
  assert(
    install.status === 0,
    `Production dependency install failed: ${install.status ?? install.error?.message}`,
  );

  server = spawn(process.execPath, [entry], {
    cwd: artifact,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  const url = `http://127.0.0.1:${PORT}${PROBE_PATH}`;
  const response = await waitForServer(url, () => server.exitCode === null);
  assert(response, `Packaged server did not answer ${url} within ${STARTUP_TIMEOUT_MS}ms`);
  const body = await response.json().catch(() => undefined);
  assert(
    body?.error?.code === PROBE_ERROR_CODE,
    `Expected ${PROBE_PATH} to answer ${PROBE_ERROR_CODE}, received ${response.status} ${JSON.stringify(body)}`,
  );
  assert(response.headers.get('x-request-id'), 'Response is missing the X-Request-Id header');
  console.log(
    `Release smoke passed: ${artifact} answered ${PROBE_ERROR_CODE} with X-Request-Id on port ${PORT}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  server?.kill();
}
