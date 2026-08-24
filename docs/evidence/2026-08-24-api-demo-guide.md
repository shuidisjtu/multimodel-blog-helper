# 答辩演示指引:B1 上传受理 + B2 查询/转录下载

> 日期:2026-08-24 ｜ 演示对象:`POST /api/v1/audio-jobs` + `GET /api/v1/audio-jobs/{id}` + `/transcript`
> 前置:Node ≥24;`.env` 已配置(见 §1);本例基于 openai-hk 中转站(直连,请关闭系统代理)

---

## 1. 准备(一次性)

```powershell
cd D:\ClaudeCodeProject\Multimodel_Blog_Helper
Copy-Item .env.example .env
notepad .env                # 把 OPENAI_API_KEY=hk-xxxx 改为真实 key(自行填写,不写入 git)
```

- `secret-guard` hook 会阻止误提交 `.env*`;`.env` 不在 git 中。
- 演示会真实调用 API(转录+摘要),消耗少量积分。

## 2. 启动服务(终端 A)

```powershell
chcp 65001
npm run dev
```

看到 `{"event":"server.started","port":3000,...}` 即就绪。保持此终端不关闭。

## 3. 演示序列(终端 B,每步替换 <jobId>)

> ☑️ **一键检验**:`pwsh -NoProfile -ExecutionPolicy Bypass -File docs\evidence\2026-08-24-api-demo-check.ps1`
> (需 `pwsh` 而非 `powershell`——后者为 5.1,GBK 显示会乱码;脚本覆盖 ③-⑦ 与 ⑨ 快检,
> 每个场景独立 PASS/FAIL 判定,2026-08-24 实测全部通过)

### ① 上传受理 → 202(核心)

```powershell
curl.exe -s -X POST http://localhost:3000/api/v1/audio-jobs `
  -H "Idempotency-Key: demo-001" `
  -F "file=@fixtures/audio-sample.mp3;type=audio/mpeg"
```

预期:

```json
{"data":{"id":"<jobId>","status":"queued","queryUrl":"/api/v1/audio-jobs/<jobId>","replayed":false},"requestId":"..."}
```

### ② 查询任务状态

```powershell
curl.exe -s http://localhost:3000/api/v1/audio-jobs/<jobId>
```

### ③ 幂等重放(同 key 同文件)→ 200 + replayed: true

```powershell
curl.exe -s -X POST http://localhost:3000/api/v1/audio-jobs `
  -H "Idempotency-Key: demo-001" `
  -F "file=@fixtures/audio-sample.mp3;type=audio/mpeg"
```

### ④ 幂等冲突(同 key 不同文件)→ 409 IDEMPOTENCY_CONFLICT

```powershell
# 与 ①/③ 同 key;用 node 生成一个最小合法 WAV 作"不同文件"
# (注: 书例/仓库内 audio-sample.mp3 sha256 全部相同, 不能用; Add-Content/追加写在某些环境被拒, 故用整文件生成)
$wav = "$PWD\temp\demo-diff.wav"
node -e "const b=Buffer.alloc(48);b.write('RIFF',0);b.writeUInt32LE(40,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);require('fs').writeFileSync(process.argv[1],b)" $wav
curl.exe -s -X POST http://localhost:3000/api/v1/audio-jobs `
  -H "Idempotency-Key: <同 ① 的 key>" `
  -F "file=@$wav;type=audio/wav"
```

### ⑤ 非法媒体类型 → 415 UNSUPPORTED_MEDIA_TYPE

```powershell
"hello" | Out-File -Encoding ascii $env:TEMP\fake.mp3
curl.exe -s -X POST http://localhost:3000/api/v1/audio-jobs `
  -F "file=@$env:TEMP\fake.mp3;type=audio/mpeg"
```

### ⑥ 任务不存在 → 404 JOB_NOT_FOUND

```powershell
curl.exe -s http://localhost:3000/api/v1/audio-jobs/01234567-89ab-cdef-0123-456789abcdef
```

### ⑦ 路径注入尝试 → 404(防御生效,不 500、不泄路径)

```powershell
curl.exe -s http://localhost:3000/api/v1/audio-jobs/..%2F..%2Fetc%2Fpasswd
```

### ⑧ 轮询到完成(等 30~90 秒)→ succeeded + summary + transcriptUrl

```powershell
curl.exe -s http://localhost:3000/api/v1/audio-jobs/<jobId>
```

### ⑨ 下载转录(纯文本 = 统一 JSON envelope 的契约例外)

```powershell
curl.exe -s http://localhost:3000/api/v1/audio-jobs/<jobId>/transcript
```

## 4. 失败排查

任务为 `failed` 且 `errorCode: INTERNAL_ERROR`:

1. 先查 `.env` key 是否为真实 key:`findstr OPENAI_API_KEY .env`
2. 检查是否在 key 修改**后**重启过服务(旧进程持有旧环境变量,Ctrl+C → `npm run dev` 重启)
3. 已修复的两个已知问题(2026-08-24,`cbafff1`):
   - `OpenAITranscriber` 用 `openAsBlob` 裸 Blob 上传 → openai SDK v7 表单拒绝,48ms 即 `INTERNAL_ERROR`;已改为 `File([blob], basename)` 包装
   - Windows 上 `rename` 瞬态 `EPERM`(杀毒/索引器短锁)→ 已加短退避重试

| 现象 | 指向 |
| --- | --- |
| `job.failed` 的日志含 `"error":{}` | 已知日志缺口(错误对象序列化为空),真实错因在终端 A 的调用上下文或需临时脚本复现 |
| 状态长期停 `queued/transcribing` | 查看终端 A 日志(网络/超时);中转站直连,关系统代理 |

## 5. 结束与清理

```powershell
# 停服务(终端 A):Ctrl+C
# 兜底释放端口:
Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
rm diag-openai.mjs      # 删除临时诊断脚本
```

> 备注:本项目无前端 UI(纯 API 服务),答辩可视化演示(C5 Grafana 面板)在 B6 之后交付。
