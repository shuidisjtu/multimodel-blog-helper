# B7 核心闭环集成验证里程碑

> 日期：2026-09-04 ｜ 分支：`feature/b7-core-flow` ｜ 状态：本机实现与验证完成；按要求不提交 GitHub

## 目标

以单个后端 E2E 集成测试证明音频任务从真实 HTTP 上传受理，经文件仓储、内存队列和 Worker 异步处理，最终可以查询摘要并下载转录；同时验证 B7 清单要求的错误、防护、天气和 CORS 场景。

## 实际结果

- 新增 `tests/e2e/core-flow.test.ts` 和 `tests/e2e/support/b7-test-system.ts`。
- 真实链路使用 `LocalFileStore`、`FileJobRepository`、`MemoryJobQueue`、`ProcessJob`、`ProcessJobWorker`。
- OpenAI、wttr.in 和音频时长探测均通过可控 fake 注入，不访问公网。
- `npm run test:b7` 当前 8 个测试全部通过；类型检查和 lint 通过。
- 全量 `npm run verify` 已通过：299 个后端测试、Web 9 个测试，覆盖率 Statements 93.10%、Branches 89.08%、Functions 94.44%、Lines 94.94%。
- 本次按要求不创建 PR、不提交 GitHub；远端 Actions 结果标记为 N/A。

## 证据

- [B7 本机验收记录](../evidence/b7-core-flow/2026-09-04-b7-core-flow-dorotheaqxq-code.md)
- [B7 专用测试原始输出](../evidence/b7-core-flow/2026-09-04-b7-test-output.txt)

## 下一步

1. 如需现场演示，可按 B7 可选实跑指引运行真实服务。
2. 后续 C4 若需要 CI 发布证据，应另行决定是否开放远端流水线；不属于本次 B7。
