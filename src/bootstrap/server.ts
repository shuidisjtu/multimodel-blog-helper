/**
 * HTTP 服务启动入口(bootstrap 流程).
 * 启动顺序契约(A3 教训): RecoverJobs.run() 必须先于 worker 启动(先启 worker 会把
 * 恢复重入队的任务标 PROCESS_INTERRUPTED)。
 */
import { createApp } from '../interfaces/http/app.js';
import { startCleanupScheduler } from './cleanup-scheduler.js';
import { loadConfig } from './config.js';
import { buildContainer } from './container.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const {
    logger,
    ids,
    submitAudio,
    queryJob,
    getTranscript,
    askWeather,
    worker,
    recover,
    cleanup,
  } = buildContainer(config);
  // 1. 恢复未完成任务(queued 重入队, 进行中标记中断)
  await recover.run();
  // 2. 启动时清一次过期任务(错误冒泡=启动失败, 与 recover 一致); 让刚标记 PROCESS_INTERRUPTED 的 failed 任务立即进入 tombstone
  await cleanup.run();
  // 3. 启动 worker(消费队列)
  worker.start();
  // 4. 启动 HTTP 服务
  const app = createApp({
    submitAudio,
    queryJob,
    getTranscript,
    askWeather,
    ids,
    logger,
    maxUploadBytes: config.storage.maxUploadBytes,
    trustProxy: config.security.trustProxy,
    corsAllowedOrigins: config.security.corsAllowedOrigins,
    rateLimitUploadPerMinute: config.limits.rateLimitUploadPerMinute,
    rateLimitWeatherPerMinute: config.limits.rateLimitWeatherPerMinute,
  });
  const server = app.listen(config.port, () => {
    logger.info({ event: 'server.started', port: config.port, nodeEnv: config.nodeEnv });
  });

  // 周期清理调度(首次清理已在启动序列执行)
  const scheduler = startCleanupScheduler(cleanup, {
    intervalMs: config.storage.cleanupIntervalMs,
    logger,
  });

  // 优雅关闭: 停收新连接, 等待在途请求; 超时兜底退出
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    scheduler.stop();
    logger.info({ event: 'server.shutting_down', signal });
    server.close((err) => {
      if (err !== undefined) {
        logger.error({ event: 'server.close_failed', error: String(err) });
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 60_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ event: 'server.failed', error: String(err) }));
  process.exit(1);
});
