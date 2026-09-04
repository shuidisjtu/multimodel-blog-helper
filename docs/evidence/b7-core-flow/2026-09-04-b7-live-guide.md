# B7 可选真实服务实跑指引

> 本指引只用于答辩或发布前人工演示，不是 CI 验收门禁。自动化 B7 验收使用 fake，不访问 OpenAI、wttr.in，也不产生模型费用。

## 前置

1. 在仓库根目录准备本地 `.env`，只在本机填写真实 `OPENAI_API_KEY`；不要复制、打印或提交该文件。
2. 确认 `OPENAI_BASE_URL`、模型、`TEMP_DIR` 和 `WEATHER_BASE_URL` 已配置。
3. 在一个终端启动服务：

```powershell
npm run dev
```

看到 `server.started` 后保持该终端运行。

## 执行

在第二个终端运行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\docs\evidence\b7-core-flow\2026-09-04-b7-live-check.ps1
```

脚本会使用唯一幂等键上传 `fixtures/audio-sample.mp3`，轮询到成功或失败终态，下载转录，并查询 `Shanghai` 天气。轮询最多 3 分钟；脚本只输出状态、jobId、摘要和转录长度，不输出密钥。

也可以指定已启动服务或其他音频文件：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\docs\evidence\b7-core-flow\2026-09-04-b7-live-check.ps1 `
  -BaseUrl http://localhost:3000 `
  -AudioPath .\fixtures\audio-sample.mp3
```

## 证据规则

- 真实运行成功后，才可将终端输出或截图归档到 `docs/evidence/b7-core-flow/`。
- 若未执行、网络失败、上游超时或没有可用 key，必须标记为“可选实跑未执行/失败”，不能替代自动化测试通过结论。
- 结束服务后清理本地 `temp/`；不得把 `.env`、请求头或上游原始错误写入证据。
