# API 演示检验记录(2026-08-24)

> 日期:2026-08-24 ｜ 检验对象:B1 上传受理 + B2 查询/转录下载(契约见 `src/interfaces/http/openapi.yaml`)
> 方法:一键脚本 `docs/evidence/release-cbafff1/2026-08-24-api-demo-check.ps1`(`pwsh`)+ 手动 curl,服务 `npm run dev`(Node 24.15,PowerShell 7.6.3,openai-hk 直连)
> 结果:**6/6 场景通过**;①/②/⑧ 主链路实跑见 [demo-1 截图](2026-08-24-api-demo-1-submit-query-download.png)与 [demo-2 状态机日志截图](2026-08-24-api-demo-2-server-log.png)

## 检验结果

| # | 场景 | 请求要点 | 预期 | 实测(关键字段) | 结果 |
| --- | --- | --- | --- | --- | --- |
| ① | 上传受理 | `POST /api/v1/audio-jobs` + `Idempotency-Key` + `audio/mpeg` | `202` | `status: queued`,`replayed: false`,`queryUrl` 正确,`X-Request-Id` 体头一致 | ✅ |
| ② | 查询任务 | `GET /api/v1/audio-jobs/{id}` | `200` | `status`:均按状态返回;`data.requestId`=创建时请求标识(与当前响应 `requestId` 不同) | ✅ |
| ③ | 幂等重放 | 同 key + 同文件重传 | `200`, `replayed: true`,同 id | 首传 `replayed: false/queued` → 重放 `replayed: true/transcribing`,`id 相同=True`(重放不重入队,返回实时进度) | ✅ |
| ④ | 幂等冲突 | 同 key + 不同文件(node 生成最小合法 WAV) | `409` | `error.code: IDEMPOTENCY_CONFLICT` | ✅ |
| ⑤ | 非法媒体类型 | 文本文件冒充 `audio/mpeg` | `415` | `error.code: UNSUPPORTED_MEDIA_TYPE` | ✅ |
| ⑥ | 任务不存在 | 合法 UUID 但无任务 | `404` | `error.code: JOB_NOT_FOUND`,`message: Job not found` | ✅ |
| ⑦ | 路径注入防御 | `GET /audio-jobs/..%2F..%2Fetc%2Fpasswd` | `404` | `error.code: JOB_NOT_FOUND`(不 500、不泄路径、不暴露格式) | ✅ |
| ⑧ | 轮询至完成 | 等 30~90 秒再次查询 | `succeeded` | `summary` + `transcriptUrl` + `model: whisper-1`;服务端日志 `queued→transcribing→summarizing→succeeded`,whisper-1 **9009ms**、gpt-4o **3276ms`、`retryCount: 0` | ✅ |
| ⑨ | 转录下载 | `GET /audio-jobs/{id}/transcript` | `200 text/plain` | 返回 103 字符转录全文(JSON envelope 的契约例外;`X-Request-Id` 头照常) | ✅ |

## 检验中发现并修复的问题(演示价值点)

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 上传后台 48ms 即 `failed`(`job.failed` 日志 `error:{}` 吞错因) | `OpenAITranscriber` 用 `openAsBlob` 裸 Blob 上传 → openai SDK v7 表单构造拒绝("Invalid value given to form") | `File([blob], basename(path))` 包装(保留流式读取;1ff7665) |
| Windows 上 `rename` 偶发 `EPERM`(当日两次,非本次但属演示稳定性) | 杀毒/索引器对目标文件瞬时短锁 | `writeJobFile` 加 EPERM 短退避重试(0d9eca2) |

两修复合并提交 `cbafff1`;修复后 ⑧ 链路实跑成功(见截图)。

## 附:如何复检

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File docs\evidence\demo\2026-08-24-api-demo-check.ps1
```

(需服务已启动;脚本自建幂等 key 和 WAV,每次运行独立;所有场景输出 `PASS/FAIL` 与汇总退出码。)

## 环境记录

- 服务:本地 `npm run dev`(tsx watch,port 3000);`TEMP_DIR=temp`,25MB 上限,TTL 24h
- 上游:openai-hk 中转站(`whisper-1` 转录 + `gpt-4o` 摘要),国内直连无需代理
- 数据:任务文件与产物位于 `temp/`(gitignored);示例音频 `fixtures/audio-sample.mp3`(435KB,id3 mp3)
