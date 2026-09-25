# Qwen-ASR 接入实施计划

> 日期：2026-09-23（2026-09-25 按 A6-1 实测结果更新）  
> 状态：**A6-1、A6-2 已完成**，进入实施（A6-3 起）  
> 目标模型：`qwen-audio-3.1-asr-flash`（同步识别）  
> 计划分支：`feature/qwen-asr-migration`  
> 实测依据：[A6-1 可行性确认证据](../evidence/a6-1-qwen-asr-feasibility/2026-09-25-a6-1-qwen-asr-feasibility-shuidisjtu.md)

> **平台限定**：本项目部署在国内**阿里云百炼（Model Studio）**，本计划的全部依据均取自 `help.aliyun.com/zh/model-studio/` 国内站文档。海外 QwenCloud 文档的模型命名、端点与字段均**不作为依据**（参见 §10）。

## 1. 背景与目标

### 1.1 为什么必须做

**中转站的 `whisper-1` 已不可用（issue #16），本项目当前没有任何可用的转录能力。** 因此本次改造的首要目标是**恢复转录可用**，而非叠加新能力。

目标模型从 OpenAI Whisper (`whisper-1`) 切换为 Qwen-ASR，同时保留项目既有的异步任务体验：用户上传完整音频，服务端后台识别，用户通过现有 Job API 查询最终转录与摘要。

本计划**不做前端实时字幕**。所选接口是在上传完成后一次性调用的，没有「用户说话时实时看到字幕」的产品能力。

### 1.2 需求优先级

本次选型按以下顺序满足：

1. **能转录**（P0）——当前完全不可用，必须先恢复。**A6-1 已证实方案 C 可行。**
2. **对现有模块改动最小**（P1）——不引入新协议栈、不引入新基建依赖、不改变安全边界。方案 C 满足。
3. **时间戳**（P2）——**A6-1 实测证实方案 C 原生返回词级时间戳**，因此本次**一并交付**，无需为它改用更重的方案。

> **答辩口径**：老师要求「核心功能展示以**音频转录为带时间戳文本**和摘要生成为主」。A6-1 的结论使该要求可以原样满足——「改动最小」与「带时间戳」不再二选一。

### 1.3 目标与非目标

**目标**

- 恢复转录可用（P0）。
- 以 Qwen-ASR 替换现有 Whisper 转录适配器，删除旧适配器，单 provider。
- **转录结果携带句级时间戳**，由 API 返回的词级数据重组得到（§2.3、§4 A6-3）。
- 保持 Job 状态机、HTTP API、OpenAPI 与 Web 前端交互流程不变。

**非目标**

- 不向浏览器开放 DashScope API Key，不由浏览器直连模型服务。
- 不新增实时字幕或实时进度协议。
- 不改摘要模型（保持 `gpt-4o`，见 §2.4）。
- 不改天气服务、上传 DTO、文件保留策略。
- 不把音频全文、密钥、上游原始错误或本地文件路径写入日志。
- 不默认加入第三方音频转码程序（如 FFmpeg）。

## 2. 选型

### 2.1 三种接入形态

Qwen-ASR 不是当前 `client.audio.transcriptions.create({ file, model })` 的直接模型名替换。国内百炼提供三种接入形态：

| 方案 | 接口形态 | 时长上限 | 时间戳 | 说话人分离 | 本地文件 | 新增依赖 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **C. 同步识别**<br>`qwen-audio-3.1-asr-flash` | DashScope HTTP 同步 | **300 s**（硬限） | ✅ 词级 + 句级 | ✅ | ✅ base64 内联 | **无**（Node 内置 `fetch`） | **选定** |
| B. 异步文件转写<br>`qwen-audio-3.1-asr-flash-filetrans` | DashScope 异步 + 轮询 | 12 小时 / 2GB | ✅ 句级 + 词级 | ✅ | ❌ **需公网 URL** | 音频公网托管 | 不可用 |
| A. WebSocket 实时流式<br>`qwen-audio-3.1-asr-flash-streaming` | WebSocket 双向协议 | 无限制 | ✅ VAD 事件 | ❌ | ✅ 分块 | 整套协议栈 | 代价过高 |

### 2.2 选定方案 C

方案 C 只需一次 HTTP 调用（Node 内置 `fetch`），**不引入新依赖、新协议、新基建，也不改变安全边界**，同时满足全部三项判据（§1.2）。

被否掉的两条路径：

- **方案 B 不可用**：filetrans 提交参数为 `input.file_urls`（URL 数组）。官方明确「**仅接受公网音频文件 URL（不支持本地文件上传）**」。本项目音频存于本地 `temp/`、单机部署无公网地址，要用它就必须引入音频公网托管。见参考资料 [2]。
- **方案 A 代价过高**：需要实现完整的 WebSocket 会话、事件聚合与清理语义（增量与最终片段处理、`session.finish` 顺序、断连与超时清理），显著高于方案 C。

实测确认的关键事实（详见 A6-1 证据）：

- 通用域名 `dashscope.aliyuncs.com` **可用**（开通阶段用它快速验证即可；该域名有时效性，正式环境改用业务空间专属域名，见 §2.6）
- 响应**无 `choices` 字段**，文本在**顶层 `text`**；`json.output` 是同名字段的冗余副本，且**不含 `usage`**、不存在 `output.output`（结构以 [A6-1 §8.2](../evidence/a6-1-qwen-asr-feasibility/2026-09-25-a6-1-qwen-asr-feasibility-shuidisjtu.md) 为准）
- 端点：`POST /api/v1/services/aigc/multimodal-generation/generation`；`parameters.format` **必填**
- **顶层** `usage` 返回 `{duration, input_tokens, output_tokens, total_tokens}`，直接供 C5 指标（注意：只在顶层，`output` 内没有）

### 2.3 时间戳：本次交付，但必须重组

**结论：本次交付句级时间戳。** API 原生返回词级时间戳，但**返回的 `sentences` 不能直接用作句级时间戳**——它是 VAD 片段，不是语言学句子。

**可用数据**（实测）：

| 字段 | 内容 |
| --- | --- |
| `output.sentence` | 默认（不开说话人分离）返回单个对象，覆盖整段音频，含 `begin_time` / `end_time` / `words[]` |
| `output.sentences[]` | 开启 `speaker_diarization_enabled` 后返回多段，每段含 `begin_time` / `end_time` / `speaker_id` / `words[]` |
| `words[]` | **词级**：`{ begin_time, end_time, text, punctuation, fixed }`（毫秒） |

**粒度陷阱（实测对照）**：API 的 `sentences` 按**静音**切分，说话人连续讲话时会合并成长段。

| 指标 | API 的 `sentences` | 用 `words[].punctuation` 重组 |
| --- | ---: | ---: |
| 段数（171 s 样本） | 10 | **31** |
| 时长中位 | 9.6 s | **4.5 s** |
| 最长 | **57.0 s**（197 词，内含 12 个完整句子） | 14.3 s |

**实施要求**：`Transcript.segments` **从 `words[]` 按标点重组**，不得直接采用 API 的 `sentences`。

**重组是启发式，三处须兜底**：

1. **标点稀疏**：实测 528 词中仅 28 个带句号、480 个标点为空——切分依赖「恰好带标点的词」
2. **中英文标点集不同**（`。！？` vs `.!?`），须同时匹配
3. **会产生极短片段**（最小 1.2 s），需设最小长度阈值，否则时间轴过碎

> 说话人分离（`speaker_diarization_enabled`）**已定默认开启**（A6-2，配置项 `QWEN_ASR_SPEAKER_DIARIZATION`）：关闭时全程只返回 1 段、没有任何静音或说话人边界可用，只有开启才拿得到 `sentences[]` 与 `speaker_id`。代价仅为请求多一个参数，可随时经环境变量关闭。

### 2.4 摘要模型保持 GPT-4o

**本次不改摘要模型。** 即便「统一供应商」看起来更整齐，代价不在工时而在答辩价值：

- 与 **ADR-0001**（迁移到 Responses API）直接冲突。DashScope 兼容模式大概率不支持 Responses API，需把 `responses.create` 改写为 `chat.completions.create`，并做 usage 字段映射。
- **A5「核心技术说明」答辩点会失效**——其验收标准原文是「可说明 Assistants API 迁移为 Responses API 的原因与影响」，这是现有技术主线之一。
- 工作量约 0.5–1 人日，但会在答辩前给核心功能引入未评估的质量变量，而 `gpt-4o` 当前可用 → 零收益。

**风险缓解已由架构提供**：`Summarizer` 端口已隔离上游实现。若中转站 `gpt-4o` 后续也失效，只需新增一个 chat-completions 适配器 + 改配置，**不需改动 domain**。

### 2.5 硬约束：时长 300 秒（实测）

A6-1 实测推翻了原计划「因 base64 10MB 限制而须把上传上限降至 ≤7.5 MB」的结论。

**时长是硬限，精确落在 300 秒**：

| 输入时长 | 结果 |
| --- | --- |
| 300 s | ✅ HTTP 200 |
| 301 s | ❌ `AUDIO_DURATION_TOO_LONG` · `audio duration (301008.0ms) over service process (300s)` |

**大小上限与文档不符**——官方称「编码后 10MB」，实测并非拒绝阈值：

| base64 大小 | 结果 |
| --- | --- |
| 12.0 MB | 通过大小检查 |
| **20.0 MB** | ❌ `BadRequest.TooLarge` · `max bytes per data-uri item : 20971520`（**20 MiB**） |
| 28.0 MB | ❌ 字符串长度超 `28,000,000` |

**据此设定配置**：

| 配置项 | 现值 | 改为 | 依据 |
| --- | --- | --- | --- |
| `MAX_AUDIO_DURATION_SECONDS` | 3600 | **300** | 实测硬限 |
| `MAX_UPLOAD_BYTES` | 25 MB | **15 MiB**（15,728,640） | base64(15 MiB) = 20 MiB，恰为实测上限；留出余量避免上游报错穿透 |

> 换算关系：base64 膨胀 4/3，故「原始 ≤15 MiB」等价于「编码后 ≤20 MiB」。设为上传上限可让超限在**上传阶段**即被拒（413），而不是等到转录时才由上游拒绝。

**内存取舍**：base64 需整文件读入内存，与现有 `openAsBlob` 流式读取不同。上限下调即是保护；适配器内需注释说明该取舍。

### 2.6 接入域名：DashScope 域名自 2026-09-30 起停止新特性

**官方公告**：[【产品变更】百炼 DashScope 域名进入维护状态通知](https://www.aliyun.com/notice/118679)（2026-09-20 发布，影响时间 2026-09-30）。官方帮助文档对应表述见参考资料 [8]：

> DashScope 域名（`dashscope.aliyuncs.com`）自 2026 年 9 月 30 日起**不再支持新特性**。存量业务兼容，建议迁移至业务空间专属域名。

**这不是下线。** 官网明确「存量业务兼容」，既有调用继续可用。因此 §2.1 的三种接入形态选型**全部不变**——它们走同一套域名规则，本次不需要重做选型。

**两种接入域名的差异**（官方对照表，仅列影响本项目的项）：

| 对比项 | 业务空间专属域名（推荐） | DashScope 域名（现有） |
| --- | --- | --- |
| 域名格式 | `{WorkspaceId}.{region}.maas.aliyuncs.com` | `dashscope.aliyuncs.com` |
| 鉴权范围 | 仅访问当前业务空间 | 可访问所有业务空间 |
| 请求超时 | 3600 秒 | **600 秒** |
| 新特性 | 持续支持 | **2026-09-30 起不再支持** |
| SLA | 99.9% | 99.9% |

**迁移代价对本项目几乎为零**：官方迁移指引为「替换 Base URL 中的域名，**无需修改业务逻辑代码**」。DashScope 接口从 `https://dashscope.aliyuncs.com/api/v1` 换为 `https://llm-xxx.cn-beijing.maas.aliyuncs.com/api/v1`——**路径完全不变**，故只需改 `QWEN_ASR_ENDPOINT` 一个配置项（A6-2 已预留），无需改任何代码。同一把 API Key 可继续使用，迁移指引未要求换 Key。

**对本项目的处置**：

- `QWEN_ASR_ENDPOINT` **默认值保留通用域名**。理由：业务空间专属域名必须填入使用者自己的 `WorkspaceId`，做成必填会让任何人 clone 后无法直接启动；通用域名当前仍可用，作为开箱默认更合适。
- **A6-7 联调与答辩演示环境必须使用业务空间专属域名**。不是赌旧域名会挂，而是不应把一个即将停止演进、且超时上限只有 600 秒的域名放在答辩现场（该要求已写进 A6-7 验收标准）。
- `QWEN_ASR_TIMEOUT_MS` 默认 300000 ms 低于两种域名的超时上限，无需随域名调整。
- 迁移后须在真实环境重新验证一次转录（A6-7 已含该环节）。

**时效风险（本次真正需要关注的）**：`qwen-audio-3.1-asr-flash` 与 `speaker_diarization_enabled` 在旧域名上于 2026-09-25 实测可用（A6-1），但旧域名自此冻结——**后续 ASR 的新模型与新参数不会再落到该域名**。今天的可用性不等于答辩当天及之后的可用性，故按上述处置迁移。

## 3. 当前架构与改造边界

当前链路（`→` 标注本次变化）：

```text
HTTP 上传（MAX_UPLOAD_BYTES 收敛到 15 MiB）
  → 本地文件与 queued Job
  → Worker / ProcessJob
  → OpenAITranscriber（删除）
  → QwenAsrTranscriber（新建）
  → DashScope 同步识别（base64 + format + 说话人分离）
  → Transcript（新增 segments 句级时间戳）
  → 保存 transcript.txt（＋时间戳产物，见 A6-3）
  → Summarizer（gpt-4o，不变）
```

现有 `Transcriber` 端口已隔离上游实现，主要接入位置：

- `src/domain/ports.ts`：`Transcriber` 接口；**本次需扩展 `Transcript` 增加 `segments`**。同文件另有 `UsageMetric` / `MetricsRecorder`。
- `src/infrastructure/openai/transcriber.ts`：现有 Whisper 适配器，**本次删除**（A6-5）。
- `src/bootstrap/container.ts`：**真正的依赖组装处**——`buildContainer()` 在此 `new OpenAITranscriber(...)`（`container.ts:70`）。
- `src/bootstrap/config.ts` 与 `.env.example`：凭证、模型、超时、上传上限等配置。
- `src/application/process-job.ts`：依赖端口执行转录；需接入 `segments` 与指标字段。
- `tests/unit/openai-transcriber.test.ts`（删除）、`tests/unit/process-job.test.ts`、`tests/e2e/core-flow.test.ts`。

**与已落地的指标采集（C5）对接**：2026-09-24 已合入 `main`（`9b5b3e5`）：

- `Transcript` 现含 `characterCount`（码点）与 `durationSeconds` 两个可选字段。方案 C 须填充 `characterCount`；`durationSeconds` 可由 API **顶层** `usage.duration`（实测存在）或 segments 末值填充。
- `ProcessJob` 会把 `transcribeModel`、`transcribeCharacterCount`、`transcribeDurationSeconds`、`transcribeDurationMs` 写入指标落盘。

## 4. 实施任务分解

> A6 拆为 7 个子任务，各自可独立认领。编号沿用任务清单习惯，每条给出**状态/前置/说明/验收标准/预估**。

### A6-1 可行性确认 ✅ 已完成（2026-09-25）

**前置**：无。

**结论**：方案 C 可行。端点、鉴权、响应结构、时间戳形态、时长与大小上限均已实测确认，证据见 [A6-1 证据记录](../evidence/a6-1-qwen-asr-feasibility/2026-09-25-a6-1-qwen-asr-feasibility-shuidisjtu.md)。

**关键产出**：通用域名可用；`parameters.format` 必填；响应无 `choices`；**词级时间戳可得**；时长硬限 300s；大小实测上限 20 MiB。

**遗留提醒**：本机 `node_modules/esbuild` 曾被不完整安装破坏（`tsx` 无法加载），已用 `npm ci` 修复。若后续 `check:docs` / `verify` 报 `Cannot find module 'esbuild'`，重跑 `npm ci` 即可。

### A6-2 配置与依赖边界 ✅ 已完成（2026-09-25）

**前置**：A6-1 ✅

**说明**：在 `AppConfig` 新增独立 DashScope 配置——`DASHSCOPE_API_KEY`（独立于 `OPENAI_API_KEY`）、`QWEN_ASR_ENDPOINT`、`QWEN_ASR_MODEL`（默认 `qwen-audio-3.1-asr-flash`）、`QWEN_ASR_TIMEOUT_MS`（默认 300000）、`QWEN_ASR_SPEAKER_DIARIZATION`（默认 `true`）、`QWEN_ASR_MAX_RETRIES`（默认 2）。

按 §2.5 调整上限：`MAX_AUDIO_DURATION_SECONDS` → **300**、`MAX_UPLOAD_BYTES` → **15 MiB**，并同步更新 OpenAPI 中相关描述与 `.env.example`。

**已落地**：`AppConfig.qwen` 域；上限默认值；`.env.example` 两域分组说明；OpenAPI 中 25 MiB→15 MiB、3600→300；Web 端错误文案与上传提示同步；开发环境 `.env` 覆盖名单扩到两域（`applyDevelopmentCredentialOverrides`）；TRUST_PROXY 与新增布尔项共用 `boolEnv`。**验收证据**见 [A6-2 证据记录](../evidence/a6-2-config-boundaries/2026-09-25-a6-2-config-boundaries-shuidisjtu.md)。

**`speaker_diarization_enabled` 决定（§9 第 5 项）**：**默认开启**，配置项 `QWEN_ASR_SPEAKER_DIARIZATION`。理由：开启后返回多段 `sentences[]` 且带 `speaker_id`，segments 可天然按说话人边界断开（§2.3）；关闭时全程只返回 1 段、无静音边界可用。代价仅为请求多一个参数，可随时经环境变量关闭。

**范围调整（与计划的差异，已记录）**：`OPENAI_TRANSCRIBE_MODEL` / `OPENAI_TRANSCRIBE_TIMEOUT_MS` 的**物理移除随 A6-5 落地**，不在 A6-2 完成。原因：`OpenAITranscriber` 在 A6-5 之前仍由组合根实例化并消费这两个字段，先删字段会直接编译不过。A6-2 因此做到「新增齐全、默认值就位」，删除动作与适配器下线同批。`A6-5` 验收标准已含「全仓库不再引用 `OPENAI_TRANSCRIBE_*`」。

**验收标准**：启动时两域凭据各自校验、报错只指向自己缺失的变量名；缺失所需 key 时启动即失败；上传超过 15 MiB 或时长超过 300s 时返回**明确业务错误**而非上游报错；配置单元测试覆盖两域隔离与上限边界。

**预估** 0.5–1 人日。**可与 A6-3 并行。**

### A6-3 Qwen 转录适配器（含时间戳重组）✅ 已完成（2026-09-25）

**前置**：A6-1 ✅、A6-2（配置项定义）

**说明**：新增 `src/infrastructure/qwen/QwenAsrTranscriber`，实现现有 `Transcriber` 接口。用 Node 内置 `fetch` 发一次 HTTP 调用。

**请求**：读取音频 → 按 MIME 构造 base64 Data URL（`data:<mediatype>;base64,<data>`）→ 作为 `input.messages[].content[].input_audio.data` 提交；`parameters.format` **必填**（按实际上传格式），视需要带 `speaker_diarization_enabled`。

**响应解析**：文本在**顶层 `text`**、用量在**顶层 `usage`**（**无 `choices` 字段**，照搬 OpenAI 风格解析会取不到文本；`json.output` 是不含 `usage` 的冗余副本，见 A6-1 §8.2）；须做字段缺失的安全兜底。

**⚠️ 两个必须避开的静默失败**：
1. 读 `output.usage` 会得到 `undefined` 而不报错 → C5 的 `durationSeconds` / token 全丢。
2. 取分段读单数 `sentence`（它始终覆盖整段音频）→ 退化成「整段一句」。开启说话人分离后 `sentence` 与 `sentences[]` **同时存在**，分段必须读 `sentences[]`，字段缺失时显式判定而非回落。

**时间戳重组（本任务的核心复杂度）**：从 `words[]` 按标点重组句级 `segments`，**不得直接采用 API 的 `sentences`**（§2.3）。须处理：中英文标点集、标点稀疏（多数词 `punctuation` 为空）、极短片段的最小长度阈值、说话人边界强制断开。

**领域模型**：扩展 `Transcript` 增加 `segments: { beginMs, endMs, text, speakerId? }[]`，并决定产物落盘形态（`transcript.txt` 保持纯文本以兼容现有下载接口，时间戳另存结构化产物）。

编码前/后校验大小与时长上限，超限抛**明确的 `DomainError`**。填充 `characterCount` 与 `durationSeconds`。整文件进内存的取舍需在代码内注释说明。复用既有 `infrastructure/common/retry.ts` 的重试语义。

**验收标准**：给定本地音频返回正确文本与句级时间戳；segments 时间单调递增、覆盖完整音频、无重叠；超限输入抛明确业务错误；日志不含 API Key 与音频内容。

**已落地**：`src/infrastructure/qwen/qwen-asr-transcriber.ts`（适配器）、`src/infrastructure/qwen/segment-builder.ts`（重组器）、`src/application/transcript-text.ts`（渲染）、`Transcript.segments` 领域模型、`transcript-timed` 产物与 `GET /api/v1/audio-jobs/{id}/transcript/timed` 端点；决策记入 [ADR-0007](../adr/0007-qwen-asr-and-timestamps.md)，验收证据见 [A6-3 证据](../evidence/a6-3-qwen-transcriber/2026-09-25-a6-3-qwen-transcriber-shuidisjtu.md)。

**产物形态（§9 第 6 项）已定**：`transcript.txt` 与既有下载端点**保持不变**（其「下载即得转录全文」的不变式已被 B5 契约测试与 B7 E2E 固定），时间戳另存 `transcript.timed.txt` 并经**新增端点**交付。

**尚未生效**：适配器未接入组合根，容器仍装配 `OpenAITranscriber`——切换与旧适配器下线属 A6-5。在那之前真实任务的转录仍不可用。

**预估** 1–1.5 人日（实际含测试）。**阻塞 A6-4**。

### A6-4 自动化测试（复用 + 新增）

**前置**：A6-3

**说明**：把 `tests/unit/openai-transcriber.test.ts` 的骨架（正常调用 / 请求选项 / 429 重试 / 4xx 不重试 / 上游失败抛错）**重构搬运**为 Qwen 适配器测试。

新增用例：base64 Data URL 构造与 `parameters.format` 一致性；顶层 `text` / `usage` 响应解析（含字段缺失兜底、**`output` 内无 `usage` 时不得静默取空**）；**segments 重组**（中英文标点、标点为空、极短片段阈值、说话人边界）；超限分支（大小与时长，含边界值）；指标字段（`characterCount` 正确、`durationSeconds` 不得伪造）；错误映射与日志脱敏；配置两域隔离与上限。

**验收标准**：`npm test` 全绿，覆盖率不低于当前基线（≥80%）；`ProcessJob` 与 B7 E2E 既有断言保持通过；CI 不访问真实上游。

**预估** 0.75–1.25 人日。**阻塞 A6-5**。

### A6-5 依赖注入与旧适配器下线

**前置**：A6-2、A6-3、A6-4

**说明**：在 `src/bootstrap/container.ts` 的组合根（`container.ts:70` 处）把 `OpenAITranscriber` 替换为 `QwenAsrTranscriber`；删除 `src/infrastructure/openai/transcriber.ts` 及其 import 与实例化；`transcribeModel` 依赖项**保留**（改传 Qwen 模型名，仍写入 Job `result.model` 与指标）。更新 mock system / e2e test factory。

**验收标准**：`npm run verify` 全绿；全仓库不再引用 `OpenAITranscriber` 与 `OPENAI_TRANSCRIBE_*`；Job 状态机、HTTP API 与前端交互流程无破坏性变化。

**预估** 0.25–0.5 人日。**可与 A6-6 并行。**

### A6-6 文档同步

**前置**：A6-5（架构文档需按最终实现的类名与配置名书写）

**说明**：更新 `docs/architecture/architecture.md`（28/61/98/150 行提及 `OpenAITranscriber` / `whisper-1`）、`docs/project-structure.md`（33 行）、`.env.example`；`Transcript` 扩展与上限变更需同步 OpenAPI；必要时新增 ADR（单 provider 决策、时间戳重组策略、上限依据）；回填 `docs/project-division/task-list.md` 状态。

**验收标准**：`npm run check:docs` 与 `check:structure` 通过；文档中不再出现 `whisper-1` 作为当前实现。

**预估** 0.5–0.75 人日。

### A6-7 真实服务联调与验收

**前置**：A6-5、A6-6

**说明**：在受控环境跑通上传 → 转录 → 摘要 → 下载全链路。核对 Job 终态；确认转录文本完整无截断；**核对句级时间戳**（单调递增、覆盖完整、无重叠、粒度合理）；上传超限音频确认返回明确业务错误；核对 `metrics.jsonl` 指标落盘；检查日志关联与错误脱敏。

**对照基线的方式**：`whisper-1` 已不可用、无法现场复跑，不能做实时 A/B。改为对照 `docs/evidence/` 中归档的历史记录（2026-08-24 的 whisper-1 实测：转录 9009ms / 摘要 3276ms）。质量结论只基于同一批有授权的样本。

**域名的要求（§2.6）**：联调**必须使用业务空间专属域名**（`QWEN_ASR_ENDPOINT=https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`），而非通用 DashScope 域名。原因是后者自 2026-09-30 起停止新特性、请求超时上限 600 秒，不适合作为答辩演示环境。同时确认该业务空间下 `qwen-audio-3.1-asr-flash` 可用。通用域名的联调结果**不能**作为答辩环境的可用性依据。

**验收标准**：全链路真实跑通并留存脱敏证据；时间戳正确；超限行为明确；**联调在业务空间专属域名下完成且证据中记录所用域名（不含 WorkspaceId 等敏感值）**；证据中区分 fake 与真实联调结果。

**预估** 0.5 人日。

### 并行与关键路径

**关键路径**：A6-2 → A6-3 → A6-4 → A6-5 → A6-7。

**可并行**：A6-2 与 A6-3；A6-5 与 A6-6。

**分工建议**：A6-2 由持账号者完成（配置项依赖实测结论）；A6-3 与 A6-4 由同一人完成沟通成本最低；A6-7 需真实平台凭证。

## 5. 预计改动文件

| 区域 | 预计改动 | 关联任务 |
| --- | --- | --- |
| 配置 | `src/bootstrap/config.ts`（新增 `qwen` 域 `DASHSCOPE_API_KEY` / `QWEN_ASR_*`、上限改 300s / 15 MiB）、`tests/unit/config.test.ts`、`.env.example`、OpenAPI 描述、Web 文案 | A6-2 ✅ |
| 配置（删除） | `src/bootstrap/config.ts` 移除 `OPENAI_TRANSCRIBE_MODEL` / `OPENAI_TRANSCRIBE_TIMEOUT_MS`（须与 `OpenAITranscriber` 同时下线，故随 A6-5） | A6-5 |
| 领域模型 | **`src/domain/ports.ts`**：`Transcript` 增加 `segments`（句级时间戳） | A6-3 |
| 上传校验 | `MAX_UPLOAD_BYTES` / `MAX_AUDIO_DURATION_SECONDS` 调整（§2.5） | A6-2 |
| 适配器 | 新增 `src/infrastructure/qwen/` 下 `QwenAsrTranscriber`（含 segments 重组）；**删除 `src/infrastructure/openai/transcriber.ts`** | A6-3 / A6-5 |
| 依赖组装 | `src/bootstrap/container.ts`、`tests/unit/container.test.ts` | A6-5 |
| 用例 | `src/application/process-job.ts`：接入 `segments` 与指标字段 | A6-3 |
| 产物 | `transcript.txt` 保持纯文本；时间戳另存结构化产物（形态见 A6-3） | A6-3 |
| 通用日志/重试 | 复用既有 `infrastructure/common/retry.ts` 与错误分类 | — |
| 测试 | 删除 `tests/unit/openai-transcriber.test.ts` 并**重构搬运**；新增适配器与 segments 重组用例 | A6-4 |
| 文档 | `docs/architecture/architecture.md`、`docs/project-structure.md`、`.env.example`、OpenAPI、必要时 ADR、实施证据 | A6-6 |
| **不应变化** | HTTP 路由结构、前端交互流程、Job 状态机、摘要链路 | — |

## 6. 验收与质量门禁

### 自动门禁

```bash
npm run verify          # lint + lint:openapi + typecheck + check:docs + check:structure + 安全豁免 + 测试 + 覆盖率 + web:verify
npm run test:b7         # 核心闭环 E2E
git diff --check
```

- 既有 API contract / OpenAPI 测试仍通过。
- 不降低仓库当前覆盖率门槛；新增适配器的正常、重组、超限、错误、重试分支均覆盖。
- 不为访问真实模型而增加 CI secret 或联网集成测试。

### 人工验收

- 在 fake 上游上完成上传至摘要的全链路（A6-4）。
- 在受控环境完成真实 Qwen 服务联调（A6-7）。
- **时间戳验收**：句级时间戳单调递增、覆盖完整音频、无重叠，粒度合理（不出现整段一句的情况）。
- **上限验收**：超时长（>300s）与超大小（>15 MiB）均返回明确业务错误，不是上游报错穿透、也不是静默失败。
- **指标验收**：`metrics.jsonl` 中转录字数与耗时列非空且合理。
- 文档和证据清楚区分自动化 fake 结果与真实服务联调结果。

## 7. 工作量估算

按 §4 任务分解逐项加总（含测试与文档）：

| 任务 | 预估（人日） | 状态 |
| --- | ---: | --- |
| A6-1 可行性确认 | 0.5–1 | ✅ 已完成 |
| A6-2 配置与依赖边界 | 0.5–1 | ✅ 已完成 |
| A6-3 Qwen 转录适配器（含时间戳重组） | 1–1.5 | ✅ 已完成 |
| A6-4 自动化测试 | 0.75–1.25 | 待办 |
| A6-5 依赖注入与旧适配器下线 | 0.25–0.5 | 待办 |
| A6-6 文档同步 | 0.5–0.75 | 待办 |
| A6-7 真实服务联调与验收 | 0.5 | 待办 |
| **合计** | **约 4–6.5 人日** | 剩余约 **2–3.5 人日** |

**关于备选方案**：方案 B 为方案 C 的 **+1.5–2 人日**（OSS 基建与异步轮询），方案 A 为 **+2–4 人日**（WebSocket 协议栈）。

> 相比 A6-1 前的估算（3–5 人日），本次上调约 1–1.5 人日，来源是**时间戳由「放弃」改为「交付」**——新增 `Transcript.segments` 扩展、词级数据重组逻辑与其测试。此代价已由 §1.2 判据确认值得。估算含测试与文档，**不包含**前端实时字幕与摘要模型切换（§2.4）。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **时间戳重组质量** | 标点稀疏或标点缺失时，segments 可能过粗或过碎，影响答辩演示效果 | A6-3 须实现最小长度阈值与说话人边界断开；A6-4 覆盖中英文标点、空标点、极短片段三类用例；A6-7 用真实样本验收粒度 |
| **时长上限导致大文件失败** | 用户上传超 300s 音频时转录失败；处理不当会出现上游报错穿透或静默失败 | §2.5 已定 `MAX_AUDIO_DURATION_SECONDS=300`，在**上传阶段**即拒；A6-2 补对应业务错误与测试 |
| **整文件进内存** | base64 需整文件读入内存，与现有流式读取不同 | 上传上限收敛到 15 MiB 即是保护；适配器内注释说明取舍；联调时观察内存 |
| **响应结构非标准** | 该端点无 `choices` 字段；`usage` 只在顶层、`output` 内没有；开启分离后 `sentence` 与 `sentences[]` 并存 | 照搬 OpenAI 风格会取不到文本；读 `output.usage` 或单数 `sentence` 会**静默降级**（A6-1 §8.2）。A6-3 按顶层字段解析、分段只认 `sentences[]`，A6-4 补对应测试 |
| **编码格式与 `format` 不匹配** | 服务端拒绝或识别错误 | 按上传校验后的存储扩展名映射 `format` 与 MIME，不依赖用户文件名；真实样本验证 |
| **错误格式和重试边界不同于原上游** | Job 失败被误判或重复扣费 | 适配器内映射安全错误类别；测试 4xx 与网络/429/5xx；避免双重重试 |
| **凭证域混淆** | 启动需同时设置两家密钥 | 配置分域——转录只校验 `DASHSCOPE_API_KEY`，摘要只校验 `OPENAI_*`；日志禁止输出密钥 |
| **对照基线不可得** | 无法与 Whisper 做实时 A/B | 用 `docs/evidence/` 中归档的历史记录作参照（§4 A6-7） |
| **接入域名将于 2026-09-30 停止新特性** | 旧域名冻结后，后续 ASR 新模型/新参数不会落到该域名；答辩环境若仍用旧域名存在不确定性 | §2.6：`QWEN_ASR_ENDPOINT` 可一键切到业务空间专属域名（路径不变、无需改代码）；A6-7 验收标准已要求联调使用专属域名 |
| **本地 node_modules 易被装坏** | `tsx` 无法加载，`check:docs`/`verify` 全线失败 | 已记录于 A6-1 遗留提醒：报 `Cannot find module 'esbuild'` 时重跑 `npm ci` |

## 9. 待确认事项

1. **【已定】** 单 provider，直接替换并删除 `OpenAITranscriber`（§2.2、A6-5）。
2. **【已定】** 摘要模型保持 `gpt-4o`（§2.4）。
3. **【已定 · 2026-09-25】** 时间戳**本次交付**，由词级数据按标点重组（§2.3）。
4. **【已定 · 2026-09-25】** 上限以**实测为准**：时长 300s、大小换算为原始 15 MiB，并在证据中保留实测输出（§2.5）。
5. **【已定 · 2026-09-25】** 默认**开启** `speaker_diarization_enabled`（`QWEN_ASR_SPEAKER_DIARIZATION=true`）——开启才有 `sentences[]` 与说话人边界可用（§2.3 末段、A6-2）。
6. **【已定 · 2026-09-25】** 时间戳产物形态：`transcript.txt` 与既有端点**不变**，另存 `transcript.timed.txt` 并经**新增端点** `GET /api/v1/audio-jobs/{id}/transcript/timed` 交付（A6-3、[ADR-0007](../adr/0007-qwen-asr-and-timestamps.md)）。
7. **【默认】** 不引入 FFmpeg 或其他外部进程；需要时另行评估。
8. **【需准备】** 阿里云百炼账号的地域、API Key 权限与测试额度——**已完成**（华北2北京，凭证已配置于本地 `.env`）。

## 10. 官方参考资料

> **仅采用国内站（`help.aliyun.com/zh/model-studio/`）文档。** 海外 QwenCloud 站（`docs.qwencloud.com` / `maas.qwencloudapi.com`）与本项目所用平台不是同一产品，其模型命名（`qwen3-asr-flash*`）、端点（`/compatible-mode/v1/chat/completions`）与字段均**不作为本项目依据**。

1. [阿里云百炼：语音识别概述（模型选型）](https://help.aliyun.com/zh/model-studio/asr-model) — 模型 ID、实时/非实时、时长上限、说话人分离、语种支持；音频规格（格式与大小限制）。
2. [阿里云百炼：非实时语音识别（用户指南）](https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide) — 异步/同步模型的划分；同步模型「适用于 5 分钟以内的音频文件」；filetrans「仅接受公网音频文件 URL（不支持本地文件上传）」；同步响应结构**无 `choices` 字段**（该文档对 `output.*` 层级的描述与实际响应不一致，实际层级以 [A6-1 §8.2 实测](../evidence/a6-1-qwen-asr-feasibility/2026-09-25-a6-1-qwen-asr-feasibility-shuidisjtu.md)为准）。
3. [阿里云百炼：非实时语音识别 HTTP API（Qwen-Audio-3.x-ASR-Flash / Fun-ASR-Flash）](https://help.aliyun.com/zh/model-studio/fun-asr-flash-recorded-speech-recognition-http-api) — **方案 C 的核心依据**：端点与 `input_audio.data` 的 URL / Base64 Data URI 两种传法；`parameters.format` **必选**；`speaker_diarization_enabled` / `keep_dialect` 仅 `qwen-audio-3.1-asr-flash` 支持。
4. [阿里云百炼：语音识别 API 参考（索引）](https://help.aliyun.com/zh/model-studio/speech-recognition-api-reference/) — 实时/非实时语音识别与定制热词的 API 分类入口。
5. [阿里云百炼：Qwen-ASR-Realtime WebSocket 接入指南](https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-interaction-process) — WebSocket URL 形态、请求头鉴权、VAD 与 Manual 两种模式；「推完音频必须先发 `session.finish` 再关连接」的官方警告。
6. [阿里云百炼：Qwen-ASR-Realtime 服务端事件](https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-server-events) — `input_audio_buffer.speech_started`（`audio_start_ms`）/ `speech_stopped`（`audio_end_ms`）/ `.text`（中间结果）/ `.completed`（最终结果）。
7. [阿里云百炼：实时语音识别用户指南](https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide) — 实时模型介绍与完整示例代码。
8. [阿里云百炼：选择地域、服务部署范围和接入域名](https://help.aliyun.com/zh/model-studio/regions) — **§2.6 的核心依据**：三种接入域名（业务空间专属 / DashScope / 试用）的对照表；「DashScope 域名自 2026-09-30 起不再支持新特性」；两步迁移指引（替换域名、不改业务代码）；各地域域名与限制；各地域功能支持矩阵。
9. [阿里云公告：【产品变更】百炼 DashScope 域名进入维护状态通知](https://www.aliyun.com/notice/118679)（2026-09-20 发布，影响时间 2026-09-30）— §2.6 的公告来源。正文为前端渲染，公告结论以参考 [8] 的官方文档表述为准。

> 官方文档和模型服务可能更新。上限与字段以 [A6-1 实测](../evidence/a6-1-qwen-asr-feasibility/2026-09-25-a6-1-qwen-asr-feasibility-shuidisjtu.md) 为准；本计划中的估算不代表服务商 SLA 或费用承诺。
