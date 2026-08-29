# B4 天气接口里程碑总结

> 日期：2026-08-29 ｜ 里程碑：B4 `WeatherProvider` 与天气接口 ｜ 状态：已完成
> 任务状态唯一真相源：[`docs/project-division/task-list.md`](../project-division/task-list.md)

## 目标

实现 `POST /api/v1/assistant/weather`，通过 `WeatherProvider` 隔离 wttr.in，查询当前地点天气，并在地点无效、上游不可用或请求超时时返回稳定业务错误，不泄漏 wttr.in 原始响应、URL、堆栈或密钥。

## 实际结果

- 新增 `AskWeather` 应用用例：仅依赖 `WeatherProvider` 与结构化 `Logger`，以 `requestId` 记录成功/失败和耗时；未知 provider 异常统一为 `WEATHER_UNAVAILABLE`。
- 新增 `WttrWeatherProvider`：调用 `https://wttr.in/{URL-encoded-location}?format=j1`，按 `WEATHER_TIMEOUT_MS` 使用 `AbortController` 限时，严格转换为 `location/tempC/description` 三字段 Weather DTO。
- 新增天气 HTTP 路由：JSON DTO 只允许 `location`，校验空白、类型、长度和额外字段；成功返回 200 JSON envelope，响应体 `requestId` 与 `X-Request-Id` 一致。
- 保守错误映射落地：本地校验和 wttr 明确的 `location not found`/未知地点语义返回 `422 INVALID_LOCATION`；网络、超时、非地点类非 2xx、JSON 或字段异常返回 `503 WEATHER_UNAVAILABLE`。
- 完成 bootstrap 容器接线；不引入 B6 的 IP 限流，也不探测天气上游作为健康检查。

## 问题与解决方案

| 问题 | 解决方案 |
| --- | --- |
| wttr.in 对不存在地点返回 `500 text/plain` 而非结构化 JSON | 适配器只读取并匹配明确的 `location not found` 语义，转换为 422；错误消息仍使用固定安全文案，不透传正文 |
| Express 默认未解析天气 JSON body | 在天气路由前挂载 `express.json()`，并在统一错误边界将 `entity.parse.failed` 映射为 422 |
| 天气上游请求可能改写路径或 query | 使用 URL 构造器、单一路径段编码和固定 `format=j1` |
| PowerShell 5 直接传递内联 JSON 给 `curl.exe` 可能丢失双引号 | 演示指引和检查脚本通过临时 UTF-8 JSON 文件与 `--data-binary` 传递请求体，避免误触发畸形 JSON 校验 |

## 验证证据

- 自动门禁：`npm run verify` 全部通过；`32` 个测试文件、`237` 个测试通过，覆盖率 Statements `92.01%`、Branches `88.86%`、Functions `93.00%`、Lines `94.06%`。
- 结构与文档门禁：`npm run check:structure`、`npm run check:docs` 通过。
- 首轮真实 wttr.in 成功查询：Shanghai 返回 `200`，真实数据 `location=Pootung`、`tempC=30`、`description=Patchy rain nearby`。
- 首轮真实 wttr.in 无效地点：返回 `422 INVALID_LOCATION` 和固定 `Invalid location`，无上游原文。
- 首轮真实 wttr.in 超时：同一服务以 `WEATHER_TIMEOUT_MS=1` 启动，返回 `503 WEATHER_UNAVAILABLE` 和固定 `Weather service is unavailable`。
- 后续独立终端截图再次覆盖三个真实场景：成功请求返回 `200`（实时上游数据 `Yangpu`、`32`、`Light rain shower`）；无效地点返回 `422 INVALID_LOCATION`；1 ms 超时返回 `503 WEATHER_UNAVAILABLE`。各截图中 JSON `requestId` 与 `X-Request-Id` 一致。
- 首轮原始终端响应：[`2026-08-29-weather-demo-live-output.txt`](../evidence/release-b4-20260829/2026-08-29-weather-demo-live-output.txt)。
- 后续终端截图：[`成功 200`](../evidence/release-b4-20260829/2026-08-29-weather-demo-1-success.png)、[`无效地点 422`](../evidence/release-b4-20260829/2026-08-29-weather-demo-2-invalid-location.png)、[`超时 503`](../evidence/release-b4-20260829/2026-08-29-weather-demo-3-timeout.png)。
- 演示指引、检查脚本和结果：[`release-b4-20260829/`](../evidence/release-b4-20260829/2026-08-29-weather-demo-guide.md)。
- 完整质量门禁输出：[`2026-08-29-b4-verify-output.txt`](../evidence/verify/2026-08-29-b4-verify-output.txt)。

## 下一步

- B5：补齐基于 OpenAPI 的 DTO/契约测试。
- B6：增加天气与上传 IP 限流、动态 `Retry-After`、CORS 同源策略及 metrics 访问边界。
- B7：汇总 B1–B6 的跨模块集成测试。
