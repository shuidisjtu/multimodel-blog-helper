# B6 实施计划：错误中间件、结构化日志与滥用防护

> 日期：2026-08-29 ｜ 状态：已实施（2026-09-01）｜ 责任人：shuidisjtu
>
> 本文记录 B6 实施前已确认的设计决策。任务完成状态以 [`docs/project-division/task-list.md`](../project-division/task-list.md) 为唯一权威；B6a/B6b 完成证据见 [`docs/evidence/b6a-error-access-log/`](../evidence/b6a-error-access-log/2026-09-01-b6a-error-boundary-access-log-shuidisjtu.md) 与 [`docs/evidence/b6b-rate-limit-cors/`](../evidence/b6b-rate-limit-cors/2026-09-01-b6b-rate-limit-cors-shuidisjtu.md)；B6a 已合入 main（PR #5），B6b 待合并（本分支），合并后本条自动失效。

## 目标

在现有 B1、B2、B4 HTTP 能力之上，补齐统一错误边界、请求关联、结构化访问日志、上传/天气接口 IP 限流及同源 CORS 策略。B6 以独立分支和独立 PR 交付，不混入 B5 DTO/契约测试或 B7 集成测试的无关改动。

## 已确认决策

### 依赖与中间件

- 使用成熟 npm 包 `express-rate-limit` 实现限流。
- 使用成熟 npm 包 `cors` 实现 CORS，并增加 `@types/cors` 开发依赖。
- 提交更新后的 `package-lock.json`；CI 使用 `npm ci` 保证依赖可复现。
- 中间件顺序固定为：

  `requestId → CORS → JSON parser → 路由级限流 → 业务路由 → error handler`

- OPTIONS 预检由 CORS 处理，不消耗业务 POST 限额。

### 请求标识与错误边界

- `requestId` 由服务端生成并写入 `X-Request-Id`；不盲目信任客户端传入值。
- 限流响应通过自定义 handler 生成统一错误 envelope：`RATE_LIMITED` / `429`。
- 未知异常进入统一错误中间件，返回 `500 INTERNAL_ERROR`，不泄漏堆栈、路径、上游原始错误、请求体或密钥。
- 所有错误和限流日志必须可通过 `requestId` 关联。

### IP 限流

- 上传接口 `POST /api/v1/audio-jobs`：每 IP 每 60 秒 10 次。
- 天气接口 `POST /api/v1/assistant/weather`：每 IP 每 60 秒 30 次。
- 仅限制上述两个 POST 业务接口；查询接口不计入额度。
- 无效请求也计数，限流器位于业务路由入口。
- 当前采用单实例内存存储，服务重启后计数清零；不承诺跨实例或跨重启持久化。
- 默认使用 `req.socket.remoteAddress`；只有显式配置 `TRUST_PROXY` 后才使用代理解析的客户端 IP。
- IPv4-mapped IPv6 地址统一规范化，避免同一客户端获得多份额度。
- 限流响应关闭额外的 `RateLimit-*` / `X-RateLimit-*` 头，仅保留统一错误响应和 `Retry-After`。
- `Retry-After` 按当前窗口剩余时间动态计算，向上取整且最小为 1 秒；无法取得重置时间时回退到窗口剩余时间。
- 限流器内部故障采用 fail-closed，拒绝请求并记录结构化错误日志。

### CORS

- 默认同源：`CORS_ALLOWED_ORIGINS` 为空时不返回 CORS 允许头。
- 跨域通过逗号分隔的白名单配置，例如：

  `CORS_ALLOWED_ORIGINS=https://example.com,https://admin.example.com`

- 禁止 `Access-Control-Allow-Origin: *`。
- 允许方法：`GET, POST, OPTIONS`。
- 允许请求头：`Content-Type, Idempotency-Key, X-Request-Id`。
- 不在白名单中的 Origin 不返回 CORS 允许头；普通 HTTP 请求仍按正常路由处理。

### 日志与 metrics 边界

- 增加统一访问日志，至少记录方法、脱敏路径、状态码、耗时和 `requestId`。
- 不记录请求体、文件名、天气地点、响应内容或凭证。
- 日志敏感字段递归脱敏，覆盖嵌套 `path`、`text`、`content`、`transcript`、`summary`、`authorization`、API key 等字段。
- metrics 具体指标、独立监听服务和 Prometheus/Grafana 接入留给 C5；B6 不实现 metrics 服务。

## 实施步骤

1. 从远程 `main` 同步并创建 `feature/b6-error-rate-limit` 分支。
2. 安装并锁定 `express-rate-limit`、`cors`、`@types/cors`，运行类型检查确认 Express 5 兼容性。
3. 将限流、CORS、`TRUST_PROXY` 配置接入 `loadConfig` 与 `createApp`，补充 `.env.example`。
4. 实现 IP 提取/规范化和两个路由级限流器，接入统一 `429` envelope 与动态 `Retry-After`。
5. 接入白名单 CORS 与 OPTIONS 预检处理，确保默认不开放跨域。
6. 增加请求完成访问日志，并将日志脱敏扩展为递归处理。
7. 编写单元和集成测试，覆盖错误边界、requestId、限流、IP/代理、CORS、预检、Retry-After 和日志脱敏。
8. 运行 `npm run verify`，完成文档/证据记录后提交独立 PR。

## 验收标准

- `npm run verify` 全部通过。
- B6 新增或修改代码覆盖率至少 80%。
- 上传和天气接口的超限响应均为 `429 RATE_LIMITED`，带合理的 `Retry-After` 和 `X-Request-Id`。
- 默认不信任伪造的 `X-Forwarded-For`；显式配置代理后行为有测试覆盖。
- 非法 Origin 不获得 CORS 允许头，合法白名单 Origin 的预检请求成功。
- 未知异常响应不泄漏内部细节；嵌套日志字段完成脱敏。
- `.env.example`、OpenAPI/相关文档、任务清单和 B6 里程碑证据保持一致。

## 非目标与后续

- 不在 B6 引入 Redis 或其他共享限流存储；多实例部署时另行设计。
- 不在 B6 实现 metrics 指标服务（C5）。
- B5 DTO/契约测试与 B7 全量集成测试保持独立任务和 PR。
