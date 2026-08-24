# B2 里程碑总结：任务查询与转录下载

> 日期：2026-08-24 ｜ 责任人：shuidisjtu ｜ 里程碑：任务清单 B2 完成（`feature/b2-query-transcript`，待 PR 合并）
>
> 里程碑式编写机制：本文档为 B2 节点的过程证据；任务状态以任务清单（task-list.md）为唯一权威。

## 目标

实现任务查询与转录下载接口：`GET /api/v1/audio-jobs/{id}`（查询状态与摘要）与 `GET /api/v1/audio-jobs/{id}/transcript`（下载转录文本）；按 B5 已落地的 OpenAPI 契约实现（200 全字段、text/plain 例外、404/409/410 错误语义）。

## 实际结果

- **两路由按 openapi 契约实现**（`src/interfaces/http/routes/audio-job-query.ts`）：查询走 JSON 信封 + `jobView` 序列化（transcriptUrl/summary/model 仅 succeeded、failure 仅 failed，不暴露 input/路径/哈希）；转录为 `text/plain` 纯文本响应（契约明确例外），`X-Request-Id` 由 requestId 中间件统一写入
- **QueryJob 复用 A3 用例**；**GetTranscript 新增**（`src/application/get-transcript.ts`）：FileStore 经端口访问，interfaces 不直接碰文件系统；错误消息复用 `MESSAGE_BY_CODE`，稳定不泄漏
- **错误语义与契约一致**：不存在/非法 id → `404 JOB_NOT_FOUND`；未就绪/产物缺失 → `409 JOB_NOT_READY`；过期 tombstone → `410 JOB_EXPIRED`
- **容器接线完成**（container.ts / server.ts）：`queryJob`、`getTranscript` 注入 AppDeps；`npm run verify` 全绿

## 问题与解决方案

| 问题 | 解决方案 |
| --- | --- |
| B2 唯一新增安全面：URL jobId 路径注入（如 `../../etc/passwd` 落入文件读取） | 路由层 UUID 格式校验（`JOB_ID_PATTERN`），非法一律按不存在处理返回 404，不暴露格式、不 500（提交 e9133f2；集成测试含注入用例） |
| 转录下载日志不得带路径（架构文档 §8.2） | GetTranscript 日志只记稳定错误码（`errorCode`/`ioError`），不记 `err.message` 与文件路径；产物缺失（ENOENT）归 `409 JOB_NOT_READY` 由客户端重试 |

## 证据链接

- 门禁：`npm run verify` 全绿——207 测试（29 文件）、覆盖率 Statements 92% / Branches 89.74% / Functions 92.8% / Lines 93.83%，lint/typecheck/check:docs/check:structure 通过；输出见 [2026-08-24-verify-output.txt](../evidence/2026-08-24-verify-output.txt)
- 转录下载实跑：集成测试 `tests/integration/audio-job-query.test.ts` 用真实 HTTP 服务 + 真实仓储/文件落盘，断言 text/plain 内容与 404/409/410 全场景
- 提交：`feature/b2-query-transcript` 6 个代码提交（GetTranscript 用例 → jobView 序列化 → 查询/下载路由 → 测试与格式 → 容器接线）

## 下一步

按分工 shuidisjtu → **B6**（错误中间件、结构化日志与滥用防护）：async 路由已进入统一错误边界，需补上传/天气 IP 限流（`429` 带 `Retry-After`）、CORS 同源策略与 metrics 访问边界；其前置 B4（ym-hello）与 B5 DTO 校验并行推进。
