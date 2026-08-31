# B5 DTO 与 API 契约验证记录

> 日期：2026-08-30 ｜ 责任人：ym-hello ｜ 对应任务：B5、C2

## 验证范围

- `npm run lint:openapi`：Redocly 校验 OpenAPI 3.1 文档、内部引用和规则集。
- `tests/contract/openapi-contract.test.ts`：读取 `src/interfaces/http/openapi.yaml`，递归解析本地 `$ref`，再用 Ajv 与格式扩展验证真实 Express HTTP 响应。
- 每个 JSON 响应同时验证 `Content-Type`、OpenAPI JSON Schema（含 `additionalProperties: false`、枚举与必填字段）、`X-Request-Id`，以及 envelope 内 `requestId` 与响应头一致；`503 QUEUE_FULL` 额外验证 `Retry-After` 为非负整数。
- 转录下载成功响应验证 `text/plain`，不按 JSON envelope 处理。

## 关键契约场景

| 接口 | 已验证场景 |
| --- | --- |
| `POST /api/v1/audio-jobs` | 202 创建、200 幂等重放、400 非法文件/超长音频/超长幂等键、409 冲突、413、415、503 `QUEUE_FULL` |
| `GET /api/v1/audio-jobs/{id}` | queued、succeeded、failed 的 200 DTO；404；410 |
| `GET /api/v1/audio-jobs/{id}/transcript` | 200 `text/plain`；409；404；410 |
| `POST /api/v1/assistant/weather` | 200；HTTP DTO 422；provider `INVALID_LOCATION` 422；上游不可用 503 |

## 执行结果

2026-08-31 本机执行 `npm run verify` 退出码为 0：Redocly OpenAPI lint、Biome、TypeScript、文档和结构检查均通过；36 个测试文件、263 个测试全部通过；覆盖率为 Statements **92.06%**、Branches **88.91%**、Functions **93.05%**、Lines **94.09%**，均高于 ≥80% 阈值。覆盖率配置限定为 `src/**/*.ts`，因此 OpenAPI YAML 不会被当作 JavaScript 源文件解析。

## 边界

未覆盖 B6 的 `429 RATE_LIMITED`、CORS，未实施或测试 health/metrics，也未在 CI 调用 wttr.in、OpenAI 或其他外部服务。
