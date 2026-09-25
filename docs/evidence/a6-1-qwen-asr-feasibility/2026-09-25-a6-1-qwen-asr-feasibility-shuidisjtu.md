# A6-1 可行性确认 · 证据记录

> 日期：2026-09-25 ｜ 执行人：shuidisjtu ｜ 任务：[A6-1](../../records/2026-09-23-qwen-asr-implementation-plan.md)（Qwen-ASR 接入）
> 平台：阿里云百炼（国内站）· 华北2北京 ｜ 模型：`qwen-audio-3.1-asr-flash`
> 脚本：`temp/spike-qwen-asr.mjs`、`temp/spike-size-probe.mjs`、`temp/spike-limits.mjs`（一次性脚本，未入库）

## 1. 结论汇总

| # | 待确认项 | 结论 |
| --- | --- | --- |
| 1 | 鉴权与最小调用 | ✅ 通过。通用域名 `dashscope.aliyuncs.com` 可用（**时效性见 §7**：该域名 2026-09-30 起停止新特性，正式环境须用业务空间专属域名） |
| 2 | 响应结构 | ✅ 确认**无 `choices` 字段**；文本在**顶层 `text`**（`output.text` 为冗余副本）；**修正见 §8.2** |
| 3 | **时间戳** | ✅ **可得（推翻计划原结论）**：`output.sentence` 自带 `begin_time`/`end_time` 与**词级 `words[]`** |
| 4 | 时长上限 | ✅ **硬限 300 秒**（301s 即拒），错误码 `AUDIO_DURATION_TOO_LONG` |
| 5 | 大小上限 | ⚠️ **文档所述 10MB 与实际不符**：12MB base64 仍通过，实测 data-uri 上限约 **20 MiB** |
| 6 | usage 字段 | ✅ 返回 `{duration, input_tokens, output_tokens, total_tokens}`，可直接喂 C5 指标。**位置在顶层 `usage`，不在 `output` 内**（修正见 §8.2） |

## 2. 响应结构（实测）

**⚠️ 本节结论已于 2026-09-25 修正，以 §8.2 与 §8.3 为准。** 原文描述的是**通用域名**的层级；§8.2 用专属域名复核后判定其"误记"，而 §8.3 进一步确认**两站结构互为镜像**——原文本身并无错误，§2 与 §8.2 只是各描述了一站。

**顶层键**：`text` / `sentence` / `sentences` / `request_id` / `usage` / `output`。

**无 `choices` 字段** —— 与计划 §4 A6-3 的警告一致，不得照搬 OpenAI 风格解析。

```jsonc
{
  "text": "…识别文本…",                // ★ 全文在此
  "sentence": {                        // 覆盖整段音频的单个对象(开启分离后仍存在, 见 §8.2)
    "begin_time": 360, "end_time": 15024,
    "sentence_id": 1, "sentence_end": true, "channel_id": 0,
    "text": "…", "words": [ … ]
  },
  "sentences": [ { "begin_time": 0, "end_time": 4160, "speaker_id": 0, "words": [ … ] }, … ],
  "usage": { "duration": 15, "input_tokens": 238, "output_tokens": 80, "total_tokens": 318 },  // ★ 仅顶层
  "request_id": "…",
  "output": {                          // 冗余副本: 同名字段各一份, 但**不含 usage**
    "text": "…", "sentence": { … }, "sentences": [ … ], "request_id": "…"
  }
}
```

**解析要点**：文本读顶层 `text`；`usage` 读顶层；`sentences` 与顶层同值（实测深度相等）。`json.output` 内**没有** `usage`，也不存在 `output.output`。

**词级时间戳 `words[]` 元素结构**（毫秒）：

```json
{ "begin_time": 360, "end_time": 1320, "fixed": true, "punctuation": "、", "text": "程序员" }
```

## 3. 时间戳可得性（重要 — 推翻计划原结论）

计划 §2.3 原判定「方案 C 无时间戳」，**实测为误**。两种形态：

| 是否开启 `speaker_diarization_enabled` | 返回 | 时间戳 |
| --- | --- | --- |
| 否（默认） | `sentence`（顶层，单个）覆盖整段音频 | ✅ `begin_time`/`end_time` + **词级 `words[]`** |
| 是 | 额外返回 `sentences[]`（顶层，多段）；`sentence` 单数**仍然存在且仍覆盖整段**，不可用于分段（§8.2） | ✅ 每段含 `begin_time`/`end_time`/`speaker_id` + `words[]` |

实测样本：

- 18s 音频（默认）：1 句 360~15024 ms，38 个词
- 171s 音频（开启分离）：10 句，首句 0~14320，末句 end_time 170080（音频总长 170900 ms），每句带 `speaker_id`
- 300s 音频（默认）：1 句 0~264000 ms，896 个词

**含义**：方案 C 同时满足「改动最小」与「可交付时间戳」，§1.2 中「为时间戳放弃最小改动」的取舍**不再必要**。若要交付多句分段（而非整段一句），需开启 `speaker_diarization_enabled`。

> 说明：本记录不含识别文本全文（属测试音频内容）。文本正确性已人工确认，中文与英文样本均识别正常。

### 3.1 粒度陷阱：API 的 `sentences` 是 VAD 片段，不是语言学句子

**这是接入时必须处理的问题**，否则交付的「带时间戳文本」粒度不可用。

API 返回的 `sentences` 按**静音**（VAD）切分，不按语法切分。说话人连续讲话、中间无停顿时会合并成很长一段。实测 `video2.mp3`（171s，开启说话人分离）：

| 指标 | API 返回的 `sentences` | 用 `words[].punctuation` 重组 |
| --- | ---: | ---: |
| 段数 | 10 | **31** |
| 时长中位 | 9.6 s | **4.5 s** |
| 最长 | **57.0 s**（197 词，内含 12 个完整句子） | 14.3 s |
| 最短 | 2.8 s | 1.2 s |

- 所有切分点均落在静音间隙（如 14.32s → 16.72s 为 2.4 秒停顿），证实为 VAD 行为
- 所述 57s 长段用标点重组后正确切为 12 句（5.8 / 6.2 / 1.2 / 3.9 / 11.3 / 5.8 / 2.2 / 3.3 / 4.5 / 1.5 / 2.2 / 9.2 秒）
- **两者不是"谁更准"**，而是不同粒度：VAD 片段适合作「段落」，标点重组适合作「句子」；带时间戳文本应取后者

**实施要求**：`Transcript.segments` 应从 `words[]` 按标点重组，**不得直接采用 API 的 `sentences`**。

**重组为启发式，有两处须兜底**：

1. **标点稀疏**：实测 528 个词中仅 28 个带句号、17 个带逗号，**480 个标点为空**——切分依赖「恰好带标点的词」
2. **中英文标点集不同**（`。！？` vs `.!?`），需同时匹配
3. **会产生极短片段**（最小 1.2 s），实际交付需设最小长度阈值，否则时间轴过碎

**复现**：`node temp/try-asr.mjs fixtures/video2.mp3 --diarize --resegment`（对比 `--sentences` 与 `--resegment` 两种输出）

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
| §1.2 / §2.3 | 方案 C 无时间戳，为最小改动而放弃时间戳 | **方案 C 可得时间戳**（含词级），取舍不再必要；已决定**本次交付**（见下） |
| §2.5 | 上传上限须降至 ≤7.5 MB（因 base64 10MB 限制） | 硬约束是**时长 300s**；大小阈值实测 20 MiB，原「≤7.5 MB」依据不成立 |
| §4 A6-2 | 调整 `MAX_AUDIO_DURATION_SECONDS`（原 3600） | 改为 **300**（实测确认）；大小上限按 20 MiB 换算为原始字节 **15 MiB** |
| §4 A6-3 | 响应解析仅取 `output.text` | 需解析 `output.text` + 词级 `words[]`，并**按标点重组 segments**（§3.1） |
| §4 A6-4 | 无需时间戳相关测试 | 新增 segments 重组测试（含极短片段阈值、中英文标点、空标点兜底） |

**本次范围决定（2026-09-25）**：时间戳由「机会性目标」改为**本次交付项**。理由：A6-1 证明最小改动路径同时满足时间戳需求，边际成本已很低，而它是答辩明确点名的核心功能。

## 6. 环境与复现

- Node v24.15.0；使用 Node 内置 `fetch`，**未新增任何依赖**
- 端点：`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`
- 请求头：`Authorization: Bearer <DASHSCOPE_API_KEY>`、`Content-Type: application/json`、`X-DashScope-SSE: disable`
- 请求体：`input.messages[].content[].input_audio.data` 传 `data:<mediatype>;base64,<data>`；`parameters.format` **必填**
- 测试音频：`fixtures/audio-sample.mp3`（18s）、`fixtures/video2.mp3`（2m51s）、`fixtures/video1.mp3`（27m，用于切片探测）

**密钥处理**：`DASHSCOPE_API_KEY` 由项目成员自行写入 `.env`（已被 gitignore），全程未打印、未记录、未传输。

## 7. 补充说明（2026-09-25 追加）：通用域名的时效性

本记录 §1 第 1 项「通用域名 `dashscope.aliyuncs.com` 可用」反映的是 **2026-09-25 的实测事实**，该事实仍成立（存量业务兼容），但**不应被读作长期结论**。

阿里云于 2026-09-20 发布公告，官方帮助文档对应表述为（完整处置见[实施计划 §2.6](../../records/2026-09-23-qwen-asr-implementation-plan.md)）：

> DashScope 域名（`dashscope.aliyuncs.com`）自 2026 年 9 月 30 日起**不再支持新特性**。存量业务兼容，建议迁移至业务空间专属域名 `{WorkspaceId}.{region}.maas.aliyuncs.com`。

**对本记录结论的影响**：「方案 C 可行」的结论**不变**（迁移仅替换域名，接口路径与请求体均不变），但「**无需业务空间专属域名**」这一表述应改为「**开通阶段可用通用域名快速验证；正式环境使用业务空间专属域名**」。两种域名的完整对照与处置见实施计划 §2.6。

**依据**：[阿里云公告 118679](https://www.aliyun.com/notice/118679)、[百炼：选择地域、服务部署范围和接入域名](https://help.aliyun.com/zh/model-studio/regions)。

## 8. 业务空间专属域名验证与结构修正（2026-09-25 追加）

### 8.1 专属域名实测可用（华北2北京）

依据 §7 的迁移要求，在**业务空间专属域名**（`{WorkspaceId}.cn-beijing.maas.aliyuncs.com`，WorkspaceId 不在此记录）上复跑同一批样本：

| 样本 | 结果 | 耗时 |
| --- | --- | --- |
| `audio-sample.mp3`（15.0 s，开启分离） | ✅ HTTP 200，3 段，识别正确 | 1043 ms |
| `video2.mp3`（170.9 s，开启分离） | ✅ HTTP 200，**VAD 10 段 → 重组 31 句**，最短 1.2 s / 中位 4.5 s / 最长 14.3 s | 7157 ms |

**与 §3.1 在通用域名上的实测逐项一致**（同为 10 段 → 31 句，同为 1.2 / 4.5 / 14.3 秒）。结论：**§2.3 的粒度陷阱与重组要求、§4 的上限结论均可平移到专属域名**，只需替换域名、无需改动解析逻辑。

请求路径不变：`/api/v1/services/aigc/multimodal-generation/generation`。

### 8.2 响应结构修正（更正 §2）

**本节更正 §2 原文的两处错误**，由本次专属域名验证中的字段核对发现。原文的问题在于把**顶层键误记为 `output` 的键**：

| # | §2 原表述 | 实际 |
| --- | --- | --- |
| 1 | `usage` 位于 `output` 内 | **`usage` 只在顶层**；`json.output` 内没有该字段 |
| 2 | 存在 `output.output.text` 冗余副本 | **不存在** `output.output`。`output` 是顶层的一个键，其内容为 `text`/`sentence`/`sentences`/`request_id` 的副本 |

**实测证据**（对保存的响应逐字段比对）：

```text
顶层键:            sentence, text, request_id, sentences, output, usage
json.output 的键:  sentence, text, request_id, sentences        ← 无 usage
存在 output.output: false
usage 位置:        顶层 = true,  output 内 = false
顶层 text 与 output.text: 相等（两份副本内容一致）
顶层 sentences 与 output.sentences: 深度相等
```

**另外确认 `sentence` 与 `sentences` 的关系**（开启说话人分离后**两个都在**）：

| 字段 | 15 s 样本实测 | 含义 |
| --- | --- | --- |
| `sentence`（单数） | 0 → 14880 ms，40 词，`speaker_id: 0` | **覆盖整段音频**，不是第一句 |
| `sentences[]`（复数） | 3 段：0-4160 / 4480-9680 / 9840-14880 | VAD 分段 |

**对 A6-3 的直接影响**：

1. 解析 `usage`（C5 指标所需）**必须读顶层**。按 §2 原文写 `output.usage` 会静默得到 `undefined`，导致 `transcribeCharacterCount` / `transcribeDurationSeconds` 全部缺失且不报错——属于「不可假装可用」需防的静默失败。
2. 取分段**必须读 `sentences[]`**。读单数 `sentence` 会退化成「整段一句」，正是 §3.1 要避免的粒度问题。字段缺失时的兜底应显式判定，不得回落到 `sentence`。

**复现**：`node temp/try-asr.mjs fixtures/audio-sample.mp3 --diarize --save <路径> --endpoint <专属域名>/api/v1/services/aigc/multimodal-generation/generation`（该试玩脚本已同步修正 usage 的读取位置）。

### 8.3 二次更正：两站结构互为镜像（收窄 §8.2 的适用范围）

**§8.2 的结论只对业务空间专属域名成立，当时被误当成了唯一结构。** 起因是 2026-09-25 的 WebUI 转录故障：本地 `.env` 未设 `QWEN_ASR_ENDPOINT`，走通用域名后每个任务都以 `INTERNAL_ERROR` 失败。

| 对比项 | 专属域名 `{WorkspaceId}.{region}.maas.aliyuncs.com` | 通用域名 `dashscope.aliyuncs.com` |
| --- | --- | --- |
| 顶层键 | `sentence, text, request_id, sentences, output, usage` | **`output, usage, request_id`** |
| `text` 位置 | 顶层 | **`output.text`** |
| `sentence` / `sentences` 位置 | 顶层 | **`output` 内** |
| `usage` 位置 | 顶层 | 顶层 |
| 存在 `output.output` | 否 | **是** |
| `output` 内的 `usage` | 无 | 有 |

**同一份数据，一站摊在顶层，另一站包在 `output` 里。**

**实测**（同一份 `fixtures/video2.mp3`，170.8 s，两次调用耗时 6.4 s / 6.6 s）：

```text
专属域名  顶层键: sentence, text, request_id, sentences, output, usage
          顶层 text = 2673 字,  output.text = 2673 字,  output 内含 usage: false
通用域名  顶层键: output, usage, request_id
          顶层 text = 不存在,  output.text = 2673 字,  output 内含 usage: true
          存在 output.output: true
```

**对 §2 原文的重新评价**：§2 的原始观察（顶层键即 `output` 的键、存在 `output.output`）**描述的是通用域名，本身没有错**；§8.2 用专属域名复核后将其判定为"误记"，是把**域名差异**读成了**记录错误**。两节各自正确，只是各说了一站——**这是本次故障的文档层根因**。

**§418 的连带更正**：该处称"官方文档对 `output.*` 层级的描述与实际响应不一致"——官方文档描述的正是**通用域名**结构，并非文档有误。

**对实现的直接影响**：**解析必须兼容两站层级**（A6-3 已按「顶层优先、`output` 回退」实现）。只读顶层会在通用域名下抛 `INTERNAL_ERROR`（`Transcription returned no text`），只读 `output` 则会在专属域名下失败。`usage` 两站均在顶层，无需回退；`output.usage` 仅在通用域名下存在，不作为解析来源。

**复现**：`node temp/diag-upstream.mjs fixtures/video2.mp3 [端点]`（同一份音频对比两站响应层级）。
