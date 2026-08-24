# B5 OpenAPI 契约与本机验证记录

> 日期：2026-08-23 ｜ 责任人：shuidisjtu ｜ 对应任务：B5

## 实际变更

- 新增 `src/interfaces/http/openapi.yaml`。
- 契约覆盖 7 个路由：音频上传、任务查询、转录下载、天气、存活检查、就绪检查和 Prometheus 指标。
- 固定统一 JSON 成功/失败 envelope、`X-Request-Id`、`Retry-After`、任务状态枚举、错误码、上传 MIME/大小/时长限制和 `Idempotency-Key` 语义。
- 上传文件字段名固定为 `file`；转录下载成功响应明确为 `text/plain`，作为统一 JSON 成功 envelope 的例外。
- 公开任务 DTO 不暴露内部文件路径、SHA-256 和幂等键。

## 本机验证

环境：Node.js `v24.15.0`，npm `11.12.1`。

执行 `npm ci`：成功，安装 88 个依赖，npm audit 报告 0 vulnerabilities。

执行 `npm run verify`：命令退出码为 0。

- Biome lint：通过
- TypeScript typecheck：通过
- 文档检查：通过
- 结构检查：通过
- 测试：23 个测试文件、158 个测试用例全部通过
- 覆盖率：Statements 95.13%、Branches 91.32%、Functions 98.95%、Lines 96.74%

## 当前阻塞

执行 `npm run dev` 未能启动服务：`package.json` 的开发脚本指向尚未落地的 HTTP 服务启动入口，当前返回 `ERR_MODULE_NOT_FOUND`。

因此 B5 契约文件已完成，但暂时无法进行真实 HTTP 响应、OpenAPI 与路由实现的契约测试；B1 上传受理接口和 HTTP server 入口是下一步工作。

覆盖率工具在 `npm run verify` 中尝试将 YAML 当作源码解析，输出了 `Failed to parse .../openapi.yaml. Excluding it from coverage.` 提示，但不影响测试和命令退出状态。当前项目未安装专用 OpenAPI lint/parser 插件，后续可在允许添加开发依赖后补充严格 schema 校验。

## 下一步

按任务清单推进 B1：实现 HTTP server/container 和 `POST /api/v1/audio-jobs`，严格以 `src/interfaces/http/openapi.yaml` 为契约；随后补充 B2/B4/B6 及 C2/B7 的接口和契约测试。
