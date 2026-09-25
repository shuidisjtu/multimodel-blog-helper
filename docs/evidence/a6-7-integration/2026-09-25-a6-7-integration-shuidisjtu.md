# A6-7 真实服务联调与验收 · 证据记录

> 日期：2026-09-25 ｜ 执行人：shuidisjtu ｜ 任务：[A6-7](../../records/2026-09-23-qwen-asr-implementation-plan.md)（Qwen-ASR 接入）
> 前置：[A6-5](../a6-3-qwen-transcriber/2026-09-25-a6-3-qwen-transcriber-shuidisjtu.md) ✅（组合根已切换）
> 环境：阿里云百炼**业务空间专属域名**（华北2北京，域名含 WorkspaceId，本文不记录其值）· 模型 `qwen-audio-3.1-asr-flash`
> 脚本：`temp/a6-7-e2e.py`（一次性，未入库）

## 1. 验收标准对照

| # | 验收标准（计划 §4 A6-7） | 结果 |
| --- | --- | --- |
| 1 | 全链路真实跑通（上传→转录→摘要→下载） | ✅ 两个真实样本均 `succeeded` |
| 2 | 核对 Job 终态 | ✅ `queued→transcribing→summarizing→succeeded` |
| 3 | 转录文本完整无截断 | ✅ 与纯文本产物一致 |
| 4 | 句级时间戳：单调递增、覆盖完整、无重叠、粒度合理 | ✅ 程序化校验通过（§4） |
| 5 | 上传超限返回明确业务错误 | ✅ 两条上限分别验证（§5） |
| 6 | 核对指标落盘 | ✅ `usage.jsonl` 各字段非空且合理（§6） |
| 7 | 检查日志关联与错误脱敏 | ✅ 无密钥/路径/音频文本（§7） |
| 8 | 证据中区分 fake 与真实联调结果 | ✅ 本文全部为**真实服务**结果 |
| 9 | 联调使用业务空间专属域名 | ✅ 未使用通用 DashScope 域名 |

## 2. 运行方式

服务以**进程环境变量**覆盖启动，未改动本地 `.env`（避免触碰密钥文件）：

```bash
QWEN_ASR_ENDPOINT="https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation" \
MAX_AUDIO_DURATION_SECONDS=300 MAX_UPLOAD_BYTES=15728640 PORT=3100 TEMP_DIR=temp/a6-7 LOG_LEVEL=info npm run dev
```

域名取自「业务空间管理」的 API Host 列，路径与通用域名相同（官方迁移指引：仅替换域名）。

> 说明：本地 `.env` 的 `MAX_*` 仍是旧值（26214400 / 3600）。因这两个键不在开发环境覆盖名单内，进程环境变量优先，故本次生效的是 15 MiB / 300s。

## 3. 全链路实跑结果

### 3.1 样本一：`audio-sample.mp3`（15.0 s，中文）

| 环节 | 结果 |
| --- | --- |
| 上传 | `202` → `queued` |
| 转录 | `qwen-audio-3.1-asr-flash`，1089 ms，`retryCount: 0`，**`segmentCount: 3`** |
| 摘要 | `gpt-4o`，3202 ms |
| 终态 | `succeeded`，`transcriptUrl: /api/v1/audio-jobs/{id}/transcript` |
| 纯文本下载 | `200`，71 字符 |
| **带时间戳下载** | **`200`**，3 行 |

### 3.2 样本二：`video2.mp3`（170.9 s，英文）

| 环节 | 结果 |
| --- | --- |
| 转录 | 5718 ms，`retryCount: 0`，**`segmentCount: 31`** |
| 摘要 | `gpt-4o`，4910 ms |
| 端到端 | 10645 ms |
| 带时间戳下载 | `200`，**31 行** |

**格式示例**（每份样本仅摘一条；识别文本全文不入档）：

```text
[00:00.00 → 00:04.16] 程序员、工程师都想把自己做成艺术家。
[00:16.72 → 00:20.24] Now a good question is, what are those preferences?
```

## 4. 时间戳质量校验（程序化）

对 171 s 样本的下载结果逐行解析后断言：

| 指标 | 结果 |
| --- | ---: |
| 段数 | **31** |
| 时长 最短 / 中位 / 最长 | 1.19 s / 4.52 s / 14.31 s |
| 相邻段重叠 | **0 处** |
| 时间非递增 | **0 处** |
| 覆盖范围 | 0.00 s → 170.08 s（音频总长 170.9 s） |
| 文本拼接与纯文本产物一致 | ✅ |

**与 A6-1 的对照**：A6-1 在通用域名上用同一个 171 s 样本测得「VAD 10 段 → 重组 31 句，1.2 / 4.5 / 14.3 秒」。本次在专属域名上为 **31 段、1.19 / 4.52 / 14.31 秒**——逐项吻合。这同时验证了两件事：**专属域名行为与通用域名一致**，以及**§2.3 的粒度陷阱在真实链路上确实被绕过**（若直接采用上游 `sentences`，这里会是 10 段、最长 57 s）。

## 5. 上限行为验证（两条上限分别验证）

`fixtures/video1.mp3`（18.54 MiB / 27 分钟）同时超过两条上限，故分两次运行以**隔离**各自的判定：

| 场景 | 配置 | 结果 |
| --- | --- | --- |
| 大小超限 | `MAX_UPLOAD_BYTES=15 MiB`（默认） | `413` · `FILE_TOO_LARGE` · `File is too large` |
| 时长超限 | 放宽至 `MAX_UPLOAD_BYTES=30 MiB`，时长仍 300 s | `400` · `AUDIO_TOO_LONG` · `Audio duration exceeds limit` |

第二次运行中大小限制已被放宽，故 `AUDIO_TOO_LONG` **确由时长校验触发**，不是大小错误的连带结果。两者都发生在**受理阶段**，返回稳定业务错误码与消息，无上游报错穿透、无静默失败。

## 6. 指标落盘

`<tempDir>/metrics/usage.jsonl` 追加两行（转录字数/时长 + 摘要 token + 端到端延迟，即 C5 落盘契约）：

```jsonc
{"jobId":"…","transcribeModel":"qwen-audio-3.1-asr-flash","transcribeCharacterCount":71,
 "transcribeDurationSeconds":15,"transcribeDurationMs":1228,
 "summaryModel":"gpt-4o","summaryInputTokens":87,"summaryOutputTokens":124,
 "summaryDurationMs":2721,"totalDurationMs":3969}

{"jobId":"…","transcribeModel":"qwen-audio-3.1-asr-flash","transcribeCharacterCount":2673,
 "transcribeDurationSeconds":170,"transcribeDurationMs":5718,
 "summaryModel":"gpt-4o","summaryInputTokens":551,"summaryOutputTokens":276,
 "summaryDurationMs":4910,"totalDurationMs":10645}
```

**要点**：`transcribeCharacterCount` 与 `transcribeDurationSeconds` 均为真实值。后者取自上游顶层 `usage.duration`——若解析时误读 `output.usage`，这两列会静默为空（A6-1 §8.2 记录的陷阱），此处非空即为该修复生效的证据。

## 7. 日志与脱敏

服务端结构化日志（片段）：

```jsonc
{"event":"qwen.transcribed","model":"qwen-audio-3.1-asr-flash","durationMs":1089,"retryCount":0,"segmentCount":3,"level":"info"}
{"event":"job.status","from":"transcribing","to":"summarizing","level":"info"}
{"event":"openai.summarized","model":"gpt-4o","durationMs":3202,"retryCount":0,"level":"info"}
{"event":"http.access","method":"GET","route":"/api/v1/audio-jobs/:id/transcript/timed","status":200,"durationMs":2,"level":"info"}
```

**脱敏自检**：对完整日志文件检索 `sk-ws-`、`DASHSCOPE_API_KEY`、`uploads`、音频原文，命中数**均为 0**。`jobId` 与 `requestId` 贯穿全链路，可关联。

## 8. 与历史基线的对照

`whisper-1` 已不可用、无法现场复跑，故**不做实时 A/B**，仅对照归档记录（2026-08-24 whisper-1 实测：转录 9009 ms / 摘要 3276 ms）：

| 指标 | whisper-1（2026-08-24，已归档） | Qwen-ASR（本次） |
| --- | ---: | ---: |
| 转录耗时 | 9009 ms | 1089 ms（15 s 音频） / 5718 ms（171 s 音频） |
| 摘要耗时 | 3276 ms | 3202 ms / 4910 ms |

两者音频样本不同，**耗时不可直接相减**，仅作为数量级参照；摘要链路未改动，耗时差异主要来自输入文本长度。

## 9. 遗留与提醒

1. **时间戳粒度已达标但仍是启发式**：31 段/中位 4.52 s 来自标点重组。若后续样本出现「无标点长段」，片段会偏长——那是**有意不臆造边界**的结果，必要时可引入上游 VAD 边界作二级切分（当前未实现，见 ADR-0007 复审条件）。
2. **本地 `.env` 的 `MAX_*` 仍是旧值**，且仍保留已被移除的 `OPENAI_TRANSCRIBE_MODEL` / `OPENAI_TRANSCRIBE_TIMEOUT_MS`（现已不被读取，无害但易误导）。建议手工清理。
3. **本地 `.env` 未设 `QWEN_ASR_ENDPOINT`**：不设则走通用域名（仍可用，但 2026-09-30 起停止新特性）。正式/演示环境应补上专属域名。
4. **本次联调未覆盖重试路径**：两次运行 `retryCount` 均为 0，429/5xx 重试由 A6-3 单测覆盖，真实触发未复现。
5. **费用**：本次共消耗 3 次真实转录（15 s、171 s、两次超限均在受理阶段未调用上游）与 2 次摘要，属正常测试开销。
