# B4 天气接口真实演示指引

> 日期：2026-08-29 ｜ 版本基线：远程 `main` 提交 `f7b79c8`（B4 已合并）
> 接口：`POST /api/v1/assistant/weather`
> 上游：真实 `https://wttr.in`，不使用 mock；自动化单元/集成测试仍注入 fake fetch/provider，不访问公网。

## 1. 准备

```powershell
cd G:\code\MultimodalBlogAssistant\multimodel-blog-helper
npm ci
Copy-Item .env.example .env -Force
# 在 .env 中填写真实运行配置；WEATHER_BASE_URL 保持 https://wttr.in
```

`OPENAI_API_KEY` 只用于服务启动配置校验，本接口不会调用 OpenAI。不要把 `.env`、密钥或运行期 `temp/` 文件加入证据。

## 2. 启动正常服务

终端 A：

```powershell
$env:WEATHER_TIMEOUT_MS = '15000'
npm run dev
```

看到 `server.started` 后保持终端运行。若 `.env` 中已配置超时，PowerShell 进程变量会覆盖它；修改 `.env` 后必须重启服务。

## 3. 在终端 B 定义安全请求助手

PowerShell 5 直接把 JSON 字符串作为 `curl.exe --data` 参数时，可能改写双引号而让服务收到畸形 JSON。以下助手将 JSON 写入临时 UTF-8 文件，再通过 `--data-binary` 原样传入；每次请求后自动删除文件。

```powershell
function Invoke-WeatherRequest {
  param([Parameter(Mandatory = $true)][string]$Location)

  $payload = @{ location = $Location } | ConvertTo-Json -Compress
  $requestFile = [System.IO.Path]::GetTempFileName()
  try {
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($requestFile, $payload, $utf8WithoutBom)
    $curlData = "@$requestFile"
    & curl.exe -sS -i -X POST 'http://localhost:3000/api/v1/assistant/weather' `
      -H 'Content-Type: application/json' `
      --data-binary $curlData
    if ($LASTEXITCODE -ne 0) { throw "curl.exe failed with exit code $LASTEXITCODE" }
  } finally {
    Remove-Item -LiteralPath $requestFile -Force -ErrorAction SilentlyContinue
  }
}
```

将每次命令及完整 HTTP 响应一起保留在终端截图中；不要截图 `.env`、密钥或服务端原始异常日志。

## 4. 成功查询（真实 wttr.in）

终端 B：

```powershell
Invoke-WeatherRequest 'Shanghai'
```

预期：`200 OK`，响应体只有 `data.location`、`data.tempC`、`data.description` 和 `requestId`；`requestId` 必须与 `X-Request-Id` 相同。地点名称由 wttr 返回的 `nearest_area` 决定，可能是 `Pootung`、`Yangpu` 等标准化名称。

## 5. 无效地点（真实 wttr.in）

```powershell
Invoke-WeatherRequest 'this-location-does-not-exist-zzzz-987654'
```

预期：`422 Unprocessable Entity`：

```json
{"error":{"code":"INVALID_LOCATION","message":"Invalid location"},"requestId":"..."}
```

真实 wttr.in 当前会以 `500 text/plain` 返回 `location not found`；适配器只识别这条明确的地点语义，并将它安全转换为 422，不向客户端透传原文。

## 6. 真实上游超时

先停止终端 A 中的服务，然后只为当前进程设置 1 ms 超时，不修改提交的 `.env`：

```powershell
$env:WEATHER_TIMEOUT_MS = '1'
npm run dev
```

服务就绪后在终端 B 执行：

```powershell
Invoke-WeatherRequest 'Shanghai'
```

预期：`503 Service Unavailable`：

```json
{"error":{"code":"WEATHER_UNAVAILABLE","message":"Weather service is unavailable"},"requestId":"..."}
```

1 ms 仅用于稳定触发本地 AbortController；上游地址仍是 `https://wttr.in`，没有伪造天气结果。

## 7. 一键检查脚本

正常服务运行时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docs\evidence\release-b4-20260829\2026-08-29-weather-demo-check.ps1 -Mode normal
```

超时服务运行时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docs\evidence\release-b4-20260829\2026-08-29-weather-demo-check.ps1 -Mode timeout
```

脚本从自身路径推导仓库根目录，不依赖固定磁盘盘符；每个场景检查 HTTP 状态、JSON envelope、`requestId`/`X-Request-Id` 一致性和安全响应文案。退出码为 0 才表示通过。安装 PowerShell 7 后也可将命令中的 `powershell` 替换为 `pwsh`。

## 8. 清理与排障

- 正常结束：终端 A 按 `Ctrl+C`，然后清除临时变量：`Remove-Item Env:WEATHER_TIMEOUT_MS -ErrorAction SilentlyContinue`。
- 若服务日志显示 `http.invalid_json`，说明客户端 JSON 已被改写；重新定义并使用第 3 节的 `Invoke-WeatherRequest`，不要使用内联 `curl.exe --data '{...}'` 命令作为证据。
- 看到 `500` 或原始 wttr 文本：不要把响应直接作为成功证据，先检查服务是否已重启到 B4 代码。
- 成功返回不等于固定地点标签；只要 `tempC` 是有限数值、`description` 非空且响应符合契约即可。
- 无效地点若被 wttr 改变为无法识别的上游响应，应记录原始 HTTP 状态与安全 503/实际结果，并更新 ADR/适配器判定，不伪造 422。
