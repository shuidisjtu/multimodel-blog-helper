# B5 里程碑总结：OpenAPI 接口契约先行

> 日期：2026-08-23 ｜ 责任人：shuidisjtu ｜ 里程碑：任务清单 B5 契约部分完成
>
> 本记录只确认 OpenAPI 契约已落地；DTO 校验、实际路由和契约测试仍需随 B1–B4 实现完成。

## 目标

在 B1 上传受理接口实现前，根据架构文档 §5 和 `src/domain/errors.ts` 固定 v1 HTTP 接口、统一响应 envelope、上传限制、幂等语义、错误码和可观测响应头，作为后续实现与契约测试的共同基准。

## 实际结果

- 新增 `src/interfaces/http/openapi.yaml`，使用 OpenAPI 3.1。
- 定义 7 个路由：
  - `POST /api/v1/audio-jobs`
  - `GET /api/v1/audio-jobs/{id}`
  - `GET /api/v1/audio-jobs/{id}/transcript`
  - `POST /api/v1/assistant/weather`
  - `GET /health/live`
  - `GET /health/ready`
  - `GET /metrics`
- 固定音频 multipart 字段为 `file`，允许 `audio/mpeg`、`audio/wav`、`audio/mp4`、`audio/x-m4a`。
- 固定新任务 `202`、幂等重放 `200`、幂等冲突 `409`，以及主要 4xx/5xx 错误响应。
- 定义 `X-Request-Id` 和限流/队列满场景的 `Retry-After`。
- 任务查询 DTO 仅暴露公共信息，转录下载成功返回纯 `text/plain`。

## 验收证据

- `npm ci` 成功，npm audit 无漏洞。
- `npm run verify` 退出码为 0。
- 23 个测试文件、158 个测试用例通过。
- 覆盖率 Statements 95.13%、Branches 91.32%、Functions 98.95%、Lines 96.74%。
- 详细终端和阻塞记录见 [`docs/evidence/2026-08-23-api-contract-and-verify.md`](../evidence/2026-08-23-api-contract-and-verify.md)。

## 未完成与风险

- HTTP 服务启动入口尚未实现，`npm run dev` 当前因入口模块缺失而失败。
- `src/interfaces/http/` 当前只有契约，没有路由、DTO 校验和中间件实现。
- 专用 OpenAPI parser/linter 尚未纳入开发依赖，当前未完成严格 `$ref` 和 schema 校验。
- 因没有可运行 HTTP server，尚未执行真实接口契约测试，也未调用真实 OpenAI/wttr.in 服务。

## 下一步

实现 B1 上传受理接口和 server/container，严格对齐 `openapi.yaml`；随后推进 B2、B4、B6，并补充 C2/B7 的 HTTP 契约和集成测试。
