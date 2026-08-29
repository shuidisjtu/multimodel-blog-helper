# B4 天气接口真实验收记录（2026-08-29）

> 验收对象：`POST /api/v1/assistant/weather`
> 版本基线：`main` 工作树（实时验证时间：2026-08-29；B4 变更尚未创建提交）
> 上游：真实 `https://wttr.in`（未使用 mock）
> 证据指南：[`2026-08-29-weather-demo-guide.md`](2026-08-29-weather-demo-guide.md)
> 自动化脚本：[`2026-08-29-weather-demo-check.ps1`](2026-08-29-weather-demo-check.ps1)
> 首轮原始终端输出：[`2026-08-29-weather-demo-live-output.txt`](2026-08-29-weather-demo-live-output.txt)

## 首轮实跑结果

| 场景 | 实测结果 | 结论 |
| --- | --- | --- |
| 真实 wttr.in 成功查询 `Shanghai` | `200 OK`；`data.location=Pootung`、`tempC=30`、`description=Patchy rain nearby`；JSON `requestId` 与 `X-Request-Id` 一致 | ✅ |
| 真实 wttr.in 无效地点 `this-location-does-not-exist-zzzz-987654` | wttr.in 原始行为为 `500 text/plain` + `location not found`；适配器识别明确地点语义并返回 `422 INVALID_LOCATION`，响应仅含 `Invalid location`，无上游原文 | ✅ |
| 真实 wttr.in 超时 | 使用 `WEATHER_TIMEOUT_MS=1` 启动同一服务进程；请求 `Shanghai` 返回 `503 WEATHER_UNAVAILABLE`，仅含稳定安全消息，未泄露 URL/堆栈/Abort 细节 | ✅ |

## 首轮原始输出摘录

```text
=== success: Shanghai ===
HTTP/1.1 200 OK
X-Request-Id: 3c3ac484-ba4e-41cb-a71d-39e6d93b9e86
{"data":{"location":"Pootung","tempC":30,"description":"Patchy rain nearby"},"requestId":"3c3ac484-ba4e-41cb-a71d-39e6d93b9e86"}

=== invalid: real wttr unknown location ===
HTTP/1.1 422 Unprocessable Entity
X-Request-Id: 57ee57f9-d478-4a78-83c0-e04f89f6b055
{"error":{"code":"INVALID_LOCATION","message":"Invalid location"},"requestId":"57ee57f9-d478-4a78-83c0-e04f89f6b055"}

=== timeout: real wttr.in with process WEATHER_TIMEOUT_MS=1 ===
HTTP/1.1 503 Service Unavailable
X-Request-Id: 74b1b750-e86b-4e93-ab37-9916bb91fc5e
{"error":{"code":"WEATHER_UNAVAILABLE","message":"Weather service is unavailable"},"requestId":"74b1b750-e86b-4e93-ab37-9916bb91fc5e"}
```

完整响应头/体保存在同目录的 [`2026-08-29-weather-demo-live-output.txt`](2026-08-29-weather-demo-live-output.txt)。

## 后续终端截图实跑

下列截图是首轮原始输出之外的独立人工实跑记录。wttr.in 会按时间和地点标准化结果，成功数据与首轮不同并不表示固定结果发生变化；每个场景均通过运行中的项目服务访问真实上游。

| 场景 | 实测结果 | 截图证据 |
| --- | --- | --- |
| 成功查询 `Shanghai` | `200 OK`；`data.location=Yangpu`、`tempC=32`、`description=Light rain shower`；`requestId` 与 `X-Request-Id` 同为 `e22f83fd-6207-4f86-921d-d99f0323ae0e` | [`2026-08-29-weather-demo-1-success.png`](2026-08-29-weather-demo-1-success.png) |
| 无效地点 | `422 INVALID_LOCATION`；固定消息 `Invalid location`；`requestId` 与 `X-Request-Id` 同为 `d764514d-6c53-4747-b039-56e789df124a`；无上游原文 | [`2026-08-29-weather-demo-2-invalid-location.png`](2026-08-29-weather-demo-2-invalid-location.png) |
| 真实上游超时 | `WEATHER_TIMEOUT_MS=1` 的独立服务进程返回 `503 WEATHER_UNAVAILABLE`；固定消息 `Weather service is unavailable`；`requestId` 与 `X-Request-Id` 同为 `a84774d1-4bd8-46aa-86b6-d979aefe4c11` | [`2026-08-29-weather-demo-3-timeout.png`](2026-08-29-weather-demo-3-timeout.png) |

三个截图中的错误响应均只包含稳定的公开 `code`、`message` 和 `requestId`，不包含 wttr.in URL、原始响应体、Abort/timeout 详情、堆栈或密钥。

## 自动化验证

- `npm run lint`：通过
- `npm run typecheck`：通过
- `npm test`：`32` 个测试文件、`237` 个测试通过
- `npm run check:structure`：通过
- `npm run check:docs`：通过
- `npm run verify`：通过；覆盖率 Statements `92.01%`、Branches `88.86%`、Functions `93.00%`、Lines `94.06%`

## 说明

- 成功响应地点由 wttr.in 的 `nearest_area` 标准化；首轮的 `Pootung` 和后续截图的 `Yangpu` 都是实时上游数据，不是固定或伪造结果。
- 1 ms 超时用于确定性触发 `AbortController`，只覆盖当前服务进程；未修改提交的 `.env`。
- PowerShell 5 直接把 JSON 内联传给 `curl.exe` 可能改写双引号而触发本地畸形 JSON 校验；演示指引和检查脚本改用临时 UTF-8 JSON 文件配合 `--data-binary`。
- 429、天气 IP 限流与动态 `Retry-After` 仍属于 B6，不在 B4 验收范围。
