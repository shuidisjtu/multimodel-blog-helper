# B5：DTO 校验与 OpenAPI 契约测试里程碑

> 日期：2026-08-30 ｜ 责任人：ym-hello ｜ 状态：完成

## 交付内容

- 以 `src/interfaces/http/openapi.yaml` 作为 B1/B2/B4 已实现 `/api/v1` HTTP 接口的对外真相源；新增 `redocly.yaml` 与 `npm run lint:openapi`，检查 OpenAPI 3.1 结构及内部 `$ref`。
- 在 `src/interfaces/http/schemas/` 收敛天气请求、`Idempotency-Key` 与 job ID 解析。天气以原始 wire 值执行对象、非空白和 200 字符上限校验后 trim；空白幂等键按未提供处理，规范化后超过 255 字符返回 `400 INVALID_IDEMPOTENCY_KEY`；非法 job ID 继续返回 `404 JOB_NOT_FOUND`。
- 对齐 OpenAPI 的 UUID job ID、请求规范化说明、错误枚举和 `INVALID_IDEMPOTENCY_KEY` 的 400 响应示例；保留转录下载成功响应 `text/plain` 的例外。
- 新增 `tests/contract/openapi-contract.test.ts`。测试从 OpenAPI 中解析 operation、递归展开本地 `$ref`，以 Ajv 校验实际 Express 响应的状态码、响应头、媒体类型与 JSON Schema；JSON envelope 同时校验 `requestId` 与 `X-Request-Id` 一致，`QUEUE_FULL` 校验非负整数 `Retry-After`。
- CI 静态门禁增加 OpenAPI lint；测试任务继续运行所有契约测试与覆盖率检查。测试使用本地 fake weather provider 和本地文件/队列，不依赖 wttr.in、OpenAI 或其他外部服务。

## 覆盖范围与边界

覆盖音频上传（202/200/400/409/413/415/503）、任务查询（queued/succeeded/failed 的 200、404、410）、转录下载（200 text/plain、409、404、410）以及天气（200、DTO/provider 422、503）。

`429 RATE_LIMITED`、CORS、`/health/live`、`/health/ready`、`/metrics` 与 B7 跨模块闭环不属于本里程碑；OpenAPI 中后三者仍保持 `planned`。

## 验收记录

详细命令、测试数量与覆盖率见 [`2026-08-30-b5-dto-contract-tests.md`](../evidence/api-contract/2026-08-30-b5-dto-contract-tests.md)。
