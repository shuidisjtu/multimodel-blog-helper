# B6a 错误边界与访问日志 — 完成记录

> 日期：2026-09-01 ｜ 责任人：shuidisjtu ｜ 分支：`feature/b6-error-rate-limit`
>
> 任务状态以 [`docs/project-division/task-list.md`](../../project-division/task-list.md) 为唯一权威；实施决策见 [`docs/records/2026-08-29-B6-implementation-plan.md`](../../records/2026-08-29-B6-implementation-plan.md)。

## 目标

在 B6 实施计划的 B6a 范围内补齐：请求关联、统一错误边界、结构化访问日志与日志递归脱敏（限流/CORS 属 B6b，不在本次）。

## 实际结果

| 验收项 | 结果 |
| --- | --- |
| async 路由统一进入错误边界 | 既有 `errorHandler`（Express 5 自动转发 rejection，未知错误 500 INTERNAL_ERROR 不泄漏） |
| 响应有 `X-Request-Id` | 既有 `requestIdMiddleware`（服务端生成，不信任客户端） |
| 访问日志记录方法/脱敏路径/状态/耗时/requestId | **新增** `src/interfaces/http/middleware/access-log.ts`：请求完成时一行 `http.access`，路径为路由模式（`/api/v1/audio-jobs/:id` 等，不含具体 id/地点；未匹配路由记录原始路径） |
| 日志敏感字段递归脱敏 | **新增** `src/shared/logger.ts` 递归 `sanitizeValue`：嵌套对象/数组同步脱敏，循环引用替换 `[circular]` 防栈溢出，Date/Error/Buffer 等非纯对象原样交 JSON.stringify |
| 不记录请求体/文件名/天气地点/响应内容/凭证 | 集成测试断言日志全文不含地点与 jobId |

## 问题与解决方案

- **访问日志路径与脱敏键 `path` 冲突**：`SENSITIVE_KEYS` 中 `path` 用于防文件路径泄漏，访问日志改用字段 `route`（值是已脱敏的路由模式），两义不混。
- **`req.baseUrl` 未挂载路径时为 `undefined`**：拼路径时 `req.baseUrl ?? ''` 兜底。
- **循环引用防卫**：递归实现引入栈溢出风险，`WeakSet` 标记已访问对象并替换为占位符（现实现遇循环引用原会抛 `TypeError: Converting circular structure to JSON`）。

## 证据

- **测试**：`npm run verify` 全绿 —— lint / lint:openapi / typecheck / check:docs / check:structure / **270 项测试** / 覆盖率 92.18%（statements），新增 `tests/unit/logger.test.ts` 4 例（递归脱敏、大小写、循环引用）与 `tests/integration/access-log.test.ts` 3 例（成功/404/未匹配路由，含 requestId 与响应头一致断言）。
- 变更文件：`src/shared/logger.ts`、`src/interfaces/http/app.ts`、`src/interfaces/http/middleware/access-log.ts`（新）、`tests/unit/logger.test.ts`、`tests/integration/access-log.test.ts`（新）、`docs/project-structure.md`。

## 下一步

- B6b：上传/天气接口 IP 限流（429 + 动态 `Retry-After`）与白名单 CORS。
- B6 计划完成后随 `feature/b6-error-rate-limit` 开 PR 合并到 `main`。
