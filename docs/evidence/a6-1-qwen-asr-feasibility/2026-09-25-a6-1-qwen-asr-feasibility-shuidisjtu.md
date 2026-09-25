# A6-1 可行性确认 · 证据记录

> 日期：2026-09-25 ｜ 执行人：shuidisjtu ｜ 任务：[A6-1](../../records/2026-09-23-qwen-asr-implementation-plan.md)（Qwen-ASR 接入）
> 平台：阿里云百炼（国内站）· 华北2北京 ｜ 模型：`qwen-audio-3.1-asr-flash`
> 脚本：`temp/spike-qwen-asr.mjs`、`temp/spike-size-probe.mjs`、`temp/spike-limits.mjs`（一次性脚本，未入库）

## 1. 结论汇总

| # | 待确认项 | 结论 |
| --- | --- | --- |
| 1 | 鉴权与最小调用 | ✅ 通过。通用域名 `dashscope.aliyuncs.com` 可用，无需业务空间专属域名 |
| 2 | 响应结构 | ✅ 确认**无 `choices` 字段**；文本在 `output.text`，`output.output.text` 为冗余副本 |
| 3 | **时间戳** | ✅ **可得（推翻计划原结论）**：`output.sentence` 自带 `begin_time`/`end_time` 与**词级 `words[]`** |
| 4 | 时长上限 | ✅ **硬限 300 秒**（301s 即拒），错误码 `AUDIO_DURATION_TOO_LONG` |
| 5 | 大小上限 | ⚠️ **文档所述 10MB 与实际不符**：12MB base64 仍通过，实测 data-uri 上限约 **20 MiB** |
| 6 | usage 字段 | ✅ 返回 `{duration, input_tokens, output_tokens, total_tokens}`，可直接喂 C5 指标 |

## 2. 响应结构（实测）

成功响应的 `output` 顶层键：`output` / `request_id` / `sentence` / `text` / `usage`（开启说话人分离时额外有 `sentences`）。

**无 `choices` 字段** —— 与计划 §4 A6-3 的警告一致，不得照搬 OpenAI 风格解析。

```jsonc
{
  "output": {
    "text": "…识别文本…",              // 与 output.output.text 内容相同（冗余）
    "sentence": {                      // 单数：不开启说话人分离时存在
      "begin_time": 360, "end_time": 15024,
      "sentence_id": 1, "sentence_end": true, "channel_id": 0,
      "text": "…", "words": [ … ]
    },
    "usage": { "duration": 15, "input_tokens": 245, "output_tokens": 35, "total_tokens": 280 }
  },
  "request_id": "…"
}
```

**词级时间戳 `words[]` 元素结构**（毫秒）：

```json
{ "begin_time": 360, "end_time": 1320, "fixed": true, "punctuation": "、", "text": "程序员" }
```

## 3. 时间戳可得性（重要 — 推翻计划原结论）

计划 §2.3 原判定「方案 C 无时间戳」，**实测为误**。两种形态：

| 是否开启 `speaker_diarization_enabled` | 返回 | 时间戳 |
| --- | --- | --- |
| 否（默认） | 单个 `output.sentence` 覆盖整段音频 | ✅ `begin_time`/`end_time` + **词级 `words[]`** |
| 是 | 额外返回 `output.sentences[]`（多句） | ✅ 每句含 `begin_time`/`end_time`/`speaker_id` + `words[]` |

实测样本：

- 18s 音频（默认）：1 句 360~15024 ms，38 个词
- 171s 音频（开启分离）：10 句，首句 0~14320，末句 end_time 170080（音频总长 170900 ms），每句带 `speaker_id`
- 300s 音频（默认）：1 句 0~264000 ms，896 个词

**含义**：方案 C 同时满足「改动最小」与「可交付时间戳」，§1.2 中「为时间戳放弃最小改动」的取舍**不再必要**。若要交付多句分段（而非整段一句），需开启 `speaker_diarization_enabled`。

> 说明：本记录不含识别文本全文（属测试音频内容）。文本正确性已人工确认，中文与英文样本均识别正常。

## 4. 上限实测

### 4.1 时长：硬限 300 秒

| 输入时长 | 结果 |
| --- | --- |
| 300 s | ✅ HTTP 200 |
| 301 s | ❌ HTTP 400 `AUDIO_DURATION_TOO_LONG` · `audio duration (301008.0ms) over service process (300s)` |
| 305 s | ❌ 同上 |
| 330 s | ❌ 同上 |

**边界精确落在 300s**，错误信息明确给出实际时长与服务上限。

### 4.2 大小：文档 10MB 与实际不符

官方文档称「确保编码后仍符合输入音频大小限制（10MB）」，实测**并非硬性拒绝阈值**：

| base64 大小 | 结果 |
| --- | --- |
| 9.77 MB | 通过大小检查（因合成音频无语音，报内容错误） |
| 12.0 MB | **通过大小检查**（同上） |
| 16.0 MB | 通过大小检查，因时长超限被拒 |
| **20.0 MB** | ❌ `BadRequest.TooLarge` · `Exceeded limit on max bytes per data-uri item : 20971520` |
| 28.0 MB | ❌ `InvalidParameter` · `String value length (28049408) exceeds the maximum allowed (28000000, …)` |

**实测天花板**：data-uri 项上限 **20,971,520 字节（20 MiB）**；字符串长度上限 **28,000,000 字符**（与前者量级一致）。

> 探测方法：合成非语音 WAV（正弦音）。若通过大小检查会返回内容类错误 `ASR_RESPONSE_HAVE_NO_WORDS`，与大小类错误码不同，据此可夹逼阈值并区分两种拒绝原因。

### 4.3 两个上限的实际关系

在时长硬限 300s 之下，常见格式的 base64 体积：

| 格式/码率 | 300s 原始 | 300s base64 | 是否触及 20 MiB |
| --- | --- | --- | --- |
| MP3 128 kbps | 4.6 MB | 6.1 MB | 否 |
| MP3 192 kbps | 6.9 MB | 9.2 MB | 否 |
| WAV 16 kHz 单声道 16-bit | 9.6 MB | 12.8 MB | 否 |
| WAV 48 kHz 立体声 16-bit | 55.3 MB | 73.7 MB | **是**（但已被 25MB 上传上限挡住） |

**结论：实际约束以「时长 ≤300s」为主**；大小仅在极高码率或未压缩音频时才可能触及，且 20 MiB 阈值高于此前假设。

## 5. 对实施计划的影响

| 计划位置 | 原结论 | 应改为 |
| --- | --- | --- |
| §1.2 / §2.3 | 方案 C 无时间戳，为最小改动而放弃时间戳 | **方案 C 可得时间戳**（含词级），取舍不再必要；是否交付转为范围决策 |
| §2.5 | 上传上限须降至 ≤7.5 MB（因 base64 10MB 限制） | 硬约束是**时长 300s**；大小阈值实测 20 MiB，原「≤7.5 MB」依据不成立 |
| §4 A6-2 | 调整 `MAX_AUDIO_DURATION_SECONDS`（原 3600） | 改为 **300**（已实测确认） |
| §4 A6-3 | 响应解析仅取 `output.text` | 需同时解析 `output.sentence`（时间戳与词级数据） |

## 6. 环境与复现

- Node v24.15.0；使用 Node 内置 `fetch`，**未新增任何依赖**
- 端点：`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
- 请求头：`Authorization: Bearer <DASHSCOPE_API_KEY>`、`Content-Type: application/json`、`X-DashScope-SSE: disable`
- 请求体：`input.messages[].content[].input_audio.data` 传 `data:<mediatype>;base64,<data>`；`parameters.format` **必填**
- 测试音频：`fixtures/audio-sample.mp3`（18s）、`fixtures/video2.mp3`（2m51s）、`fixtures/video1.mp3`（27m，用于切片探测）

**密钥处理**：`DASHSCOPE_API_KEY` 由项目成员自行写入 `.env`（已被 gitignore），全程未打印、未记录、未传输。
