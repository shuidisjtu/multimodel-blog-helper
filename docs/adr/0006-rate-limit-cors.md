# ADR-0006：IP 限流与白名单 CORS（B6）

- 状态：已接受（2026-09-01）
- 触发复审：多实例部署、引入共享限流存储、CORS 策略需要动态变更时

## 背景

开放上传/天气接口后需要滥用防护（超额请求、跨域调用）。B6 实施计划已确认的决策记录见 [`docs/records/2026-08-29-B6-implementation-plan.md`](../records/2026-08-29-B6-implementation-plan.md)，本 ADR 记录安全边界的最终形态。

## 决策

- 使用 `express-rate-limit` 做**路由级 IP 限流**：上传 `POST /api/v1/audio-jobs` 每 IP 每 60 秒 10 次；天气 `POST /api/v1/assistant/weather` 每 IP 每 60 秒 30 次；查询接口不计入。限流器位于业务路由入口（multer/DTO 校验之前），无效请求也计数。
- 超限响应统一为契约 envelope `429 RATE_LIMITED` + 动态 `Retry-After`（按窗口剩余时间向上取整、最小 1 秒）；关闭 `RateLimit-*`/`X-RateLimit-*` 额外头。限流器内部故障 fail-closed（`passOnStoreError: false`，经统一错误边界拒绝并记录）。
- 存储为**单实例内存**（`MemoryStore`）：重启计数清零，不承诺跨实例/跨重启持久化。
- IP 提取：默认 `req.socket.remoteAddress`（不信任 `X-Forwarded-For` 伪装）；仅显式配置 `TRUST_PROXY`（仅接受 `true/1`，其余非法值启动即失败）后取 X-Forwarded-For 首段。IPv4-mapped IPv6 由 `ipKeyGenerator` 规范化，避免同一客户端获得多份额度。
- CORS：`CORS_ALLOWED_ORIGINS` 逗号分隔白名单；**为空 = 默认同源（不返回任何 CORS 允许头）**；禁止 `*`（白名单精确匹配 + 配置校验拒绝）。允许方法 `GET,POST,OPTIONS`；允许请求头 `Content-Type, Idempotency-Key, X-Request-Id`。OPTIONS 预检由 cors 中间件响应（204），不进入业务路由/限流；白名单外的 Origin 不获得允许头，普通请求仍正常处理。

## 备选方案

- **Redis 等共享限流存储**：多实例一致性更强，但单机答辩场景引入额外运维组件。按 YAGNI 不引入，多实例部署时另立方案。
- **`app.set('trust proxy', true)` 直接信任代理解析 IP**：`express-rate-limit` 的验证器会报告 `ERR_ERL_PERMISSIVE_TRUST_PROXY`（任何客户端可绕过 IP 限流），且影响全局 `req.ip` 语义。改为仅限流键按 `TRUST_PROXY` 提取 XFF 首段，范围最小。
- **`Access-Control-Allow-Origin: *`**：违反"允许任意来源"滥用面，禁止。

## 后果

- 限流/CORS 配置（`RATE_LIMIT_UPLOAD_PER_MINUTE`、`RATE_LIMIT_WEATHER_PER_MINUTE`、`TRUST_PROXY`、`CORS_ALLOWED_ORIGINS`）集中在 `loadConfig` 校验，非法值启动即失败（与既有配置策略一致）。
- 单实例部署下伪造 IP 无法绕过限流；部署在反向代理后必须显式设置 `TRUST_PROXY=true`。
- 契约已先行：OpenAPI 中 429/Retry-After 定义与实现一致，无需修改接口文档。

## 触发复审的条件

- 多实例部署或需要共享限流状态；
- CORS 白名单需要动态承载（如管理后台域名变化频繁）；
- 需要按用户/API key 维度限流而非仅 IP。
