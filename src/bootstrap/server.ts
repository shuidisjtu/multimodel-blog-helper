/**
 * HTTP 服务启动入口(架构文档 §3.1 bootstrap / §6 流程).
 * 启动顺序契约(A3 教训): RecoverJobs.run() 必须先于 worker 启动(先启 worker 会把
 * 恢复重入队的任务标 PROCESS_INTERRUPTED)。
 */
import { createApp } from '../interfaces/http/app.js';
import { loadConfig } from './config.js';
import { buildContainer } from './container.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { logger, ids, submitAudio, worker, recover } = buildContainer(config);
  // 1. 恢复未完成任务(queued 重入队, 进行中标记中断)
  await recover.run();
  // 2. 启动 worker(消费队列)
  worker.start();
  // 3. 启动 HTTP 服务
  const app = createApp({
    submitAudio,
    ids,
    logger,
    maxUploadBytes: config.storage.maxUploadBytes,
  });
  const server = app.listen(config.port, () => {
    logger.info({ event: 'server.started', port: config.port, nodeEnv: config.nodeEnv });
  });

  // 优雅关闭(架构文档 §6): 停收新连接, 等待在途请求; 超时兜底退出
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
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
