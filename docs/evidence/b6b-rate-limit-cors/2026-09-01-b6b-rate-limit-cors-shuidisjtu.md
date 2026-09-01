# B6b 限流与 CORS — 完成记录

> 日期：2026-09-01 ｜ 责任人：shuidisjtu ｜ 分支：`feature/b6-error-rate-limit`
>
> 任务状态以 [`docs/project-division/task-list.md`](../../project-division/task-list.md) 为唯一权威；实施决策见 [`docs/records/2026-08-29-B6-implementation-plan.md`](../../records/2026-08-29-B6-implementation-plan.md) 与 [`docs/adr/0006-rate-limit-cors.md`](../../adr/0006-rate-limit-cors.md)；B6a 部分见 [`../b6a-error-access-log/2026-09-01-b6a-error-boundary-access-log-shuidisjtu.md`](../b6a-error-access-log/2026-09-01-b6a-error-boundary-access-log-shuidisjtu.md)。

## 目标

补齐 B6 计划的限流与 CORS：上传/天气接口 IP 限流（429 + 动态 Retry-After）、同源默认与白名单 CORS、TRUST_PROXY 语义。

## 实际结果

| 验收项 | 结果 |
| --- | --- |
| 上传限流 10 次/60s、天气 30 次/60s | `express-rate-limit` 路由级限流（`src/interfaces/http/middleware/rate-limit.ts`），配置 `RATE_LIMIT_UPLOAD_PER_MINUTE`/`RATE_LIMIT_WEATHER_PER_MINUTE` |
| 超限 429 RATE_LIMITED + 动态 Retry-After + X-Request-Id | 统一 envelope；Retry-After = 窗口剩余秒数向上取整、最小 1 秒，`[1..60]` 实测；关闭 RateLimit/X-RateLimit 额外头 |
| 默认不信任伪造 XFF;TRUST_PROXY 后有测试 | 默认 `req.socket.remoteAddress`（集成测试: 伪造 XFF 打满仍 429）；`TRUST_PROXY=true` 后按 XFF 首段计（不同 XFF 独立额度测试） |
| 非法 Origin 无 CORS 允许头;合法预检成功 | 白名单精确匹配（`cors.ts`）;预检 204 + Allow-Methods/Headers;非白名单/同源无允许头 |
| 无效请求计数;查询不计入 | 限流位于业务路由入口（multer/DTO 校验前），10 次 400 后第 11 次 429；36 次 GET 无 429 |
| 不配 `*`;默认同源 | `CORS_ALLOWED_ORIGINS` 含 `*` 或无 scheme 值启动即 `ConfigError`;白名单为空不上挂 CORS 中间件 |

## 问题与解决方案

- **`express-rate-limit` 禁止 `trust proxy === true`**（验证器 `ERR_ERL_PERMISSIVE_TRUST_PROXY`，任何人可绕过 IP 限流）：不设 `app.set('trust proxy')`，改为仅限流键按 `TRUST_PROXY` 提取 X-Forwarded-For 首段，范围最小且免噪音日志。
- **v8 仅在 legacy/standard headers 开启时自动设 Retry-After**：我们关闭这两类头,由自定义 handler 按 `req.rateLimit.resetTime` 计算动态值。
- **Express 5 对非白名单 Origin 的 OPTIONS 自动响应 200**（非 404）：断言收敛为"无 CORS 允许头"这一验收点（见 `tests/integration/cors.test.ts`）。
- 新依赖 `express-rate-limit@8.7.0`、`cors@2.8.6`、`@types/cors` 已锁定进 `package-lock.json`。

## 证据

- **测试**:`npm run verify` 全绿(见任务清单状态行):lint / lint:openapi / typecheck / check:docs / check:structure / 全量测试 / 覆盖率 ≥80%。新增 `tests/unit/rate-limit.test.ts`(5 例)、`tests/integration/rate-limit.test.ts`(7 例)、`tests/integration/cors.test.ts`(6 例)、config 用例 3 例。
- 变更文件:新 `src/interfaces/http/middleware/{rate-limit,cors}.ts`;`app.ts`/`config.ts`/`server.ts`/`audio-jobs.ts`/`weather.ts`/`error-handler.ts` 接入;`.env.example` 增 `TRUST_PROXY`/`CORS_ALLOWED_ORIGINS`;`docs/adr/0006-rate-limit-cors.md`。

## 下一步

- B6 完整计划随 `feature/b6-error-rate-limit` PR 合并(待 B6b 评审通过后与 B6a 一并合入 `main`)。
- B7 核心闭环集成验证(依赖 B6a/B6b 完成)已解锁。
