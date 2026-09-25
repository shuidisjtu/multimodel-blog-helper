import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // fork 池在 Windows 高并发 + 覆盖率下偶发 worker 猝死: 测试全绿却报
    // "Worker exited unexpectedly" 并以退出码 1 收场(实测 7 次复现 2 次)。
    // 换 threads 池后 20 次连续运行 0 复现, 耗时持平。
    // 引入原生模块依赖时需重估——官方建议原生模块走 forks。
    pool: 'threads',
    include: ['tests/**/*.test.ts'],
    // 默认 5000ms 对走真实 HTTP 与状态轮询的 B7 E2E 偏紧, 全量并发运行时会偶发超时。
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
