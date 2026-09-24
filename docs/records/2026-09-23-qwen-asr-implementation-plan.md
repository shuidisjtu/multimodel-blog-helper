# Qwen-ASR 接入实施计划

> 日期：2026-09-23（2026-09-24 定稿）  
> 状态：待实施（先做 A6-1 可行性确认）  
> 目标模型：`qwen-audio-3.1-asr-flash`（同步识别，最终以 A6-1 实测为准）  
> 计划分支：`feature/qwen-asr-migration`

> **平台限定**：本项目部署在国内**阿里云百炼（Model Studio）**，本计划的全部依据均取自 `help.aliyun.com/zh/model-studio/` 国内站文档。海外 QwenCloud 文档的模型命名、端点与字段均**不作为依据**（参见 §10）。

## 1. 背景与目标

### 1.1 为什么必须做

**中转站的 `whisper-1` 已不可用（issue #16），本项目当前没有任何可用的转录能力。** 因此本次改造的首要目标是**恢复转录可用**，而非叠加新能力。

目标模型从 OpenAI Whisper (`whisper-1`) 切换为 Qwen-ASR，同时保留项目既有的异步任务体验：用户上传完整音频，服务端后台识别，用户通过现有 Job API 查询最终转录与摘要。

本计划**不做前端实时字幕**。所选接口是在上传完成后一次性调用的，没有「用户说话时实时看到字幕」的产品能力。

### 1.2 需求优先级

本次选型按以下顺序满足，**前两项为硬性，第三项为机会性**：

1. **能转录**（P0）——当前完全不可用，必须先恢复。
2. **对现有模块改动最小**（P1）——不引入新协议栈、不引入新基建依赖、不改变安全边界。
3. **时间戳**（P2）——若所选方案恰好支持则一并交付；**若需为此显著增加工作量或复杂度，则放弃**，转为后续增强。

> **对答辩口径的影响（需知悉）**：老师原话中「核心功能展示以**音频转录为带时间戳文本**和摘要生成为主」。按本优先级若不交付时间戳，**答辩话术需相应调整**（改为以「转录 + 摘要」为核心，时间戳列为已知边界与后续方向）。

### 1.3 目标与非目标

**目标**

- 恢复转录可用（P0）。
- 以 Qwen-ASR 替换现有 Whisper 转录适配器，删除旧适配器，单 provider。
- 保持 Job 状态机、HTTP API、OpenAPI 与 Web 前端行为不变。
- 不扩展 `Transcript` 领域模型、不改产物落盘格式（时间戳为机会性目标，见 §2.3）。

**非目标**

- 不向浏览器开放 DashScope API Key，不由浏览器直连模型服务。
- 不新增实时字幕或实时进度协议。
- 不改摘要模型（保持 `gpt-4o`，见 §2.4）。
- 不改天气服务、上传 DTO、文件保留策略或 OpenAPI。
- 不把音频全文、密钥、上游原始错误或本地文件路径写入日志。
- 不默认加入第三方音频转码程序（如 FFmpeg）。

## 2. 选型

### 2.1 三种接入形态

Qwen-ASR 不是当前 `client.audio.transcriptions.create({ file, model })` 的直接模型名替换。国内百炼提供三种接入形态：

| 方案 | 接口形态 | 时长上限 | 时间戳 | 说话人分离 | 本地文件 | 新增依赖 | 工程量 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **C. 同步识别**<br>`qwen-audio-3.1-asr-flash` | DashScope HTTP 同步（multimodal-generation） | **≤5 分钟** | ❌（待 A6-1 确认，见 §2.3） | ✅（可返回 `output.sentences`） | ✅ **base64 内联** | **无**（Node 内置 `fetch`） | 见 §7 |
| B. 异步文件转写<br>`qwen-audio-3.1-asr-flash-filetrans` | DashScope 异步 + 轮询 | 12 小时 / 2GB | ✅ 句级 + 词级 | ✅ | ❌ **需公网 URL** | 音频公网托管（OSS/隧道） | C + 1.5–2 人日 |
| A. WebSocket 实时流式<br>`qwen-audio-3.1-asr-flash-streaming` | WebSocket 双向协议 | 无限制 | ✅ VAD 事件 | ❌ | ✅ 分块发送 | 整套 WebSocket 协议栈 | C + 2–4 人日 |

### 2.2 选定方案 C

方案 C 是 §1.2 判据下的最优解：**改动最小、能转录，代价是无时间戳**。它只需一次 HTTP 调用（Node 内置 `fetch`），**不引入新依赖、新协议、新基建，也不改变安全边界**。

被否掉的两条路径，各有硬性代价（均为国内百炼文档确认的事实）：

- **方案 B 不可用**：filetrans 提交参数为 `input.file_urls`（URL 数组）。官方对同类模型有明确表述——"Qwen3-ASR-Flash-Filetrans 专为音频文件异步转写设计……**仅接受公网音频文件 URL（不支持本地文件上传）**"。本项目音频存于本地 `temp/`、单机部署无公网地址，要用它就必须引入音频公网托管。见参考资料 [2]。
- **方案 A 代价过高**：需要实现完整的 WebSocket 会话、事件聚合与清理语义（增量与最终片段处理、`session.finish` 顺序、断连与超时清理），显著高于方案 C。

### 2.3 时间戳的处理

**结论：本次不交付时间戳。** 执行口径：

- **不做**：不扩展 `Transcript`、不改产物落盘格式、不改查询/下载接口。
- **连带查**：A6-1 顺带验证同步接口在开启 `speaker_diarization_enabled` 后返回的 `output.sentences` **是否含时间字段**（该参数仅 `qwen-audio-3.1-asr-flash` 支持）。若恰好含时间戳则免费获得；若需换模型或加协议才支持，则按 §1.2 放弃。
- **要记**：答辩口径需按 §1.2 的影响说明相应调整。

各形态的时间戳能力：

| 形态 | 时间戳 | 可得方式 |
| --- | --- | --- |
| 方案 C | ❓ **待实测** | 官方参数表中**无时间戳相关参数**，响应示例仅见识别文本；`speaker_diarization_enabled: true` 时会返回 `output.sentences`，其字段是否含时间待实测（见参考资料 [3]） |
| 方案 B | ✅ 句级 + 词级 | 结果为 `sentences[]`（`begin_time` / `end_time`，毫秒）与 `words[]`（词级）；`enable_words` 参数控制词级开关。见参考资料 [2] |
| 方案 A | ✅ | VAD 事件 `input_audio_buffer.speech_started.audio_start_ms` / `speech_stopped.audio_end_ms`。见参考资料 [6] |

> 若日后需要时间戳，方案 B/A 的接入要点已保留在本计划 §4 的备选路径中。

### 2.4 摘要模型保持 GPT-4o

**本次不改摘要模型。** 即便「统一供应商」看起来更整齐，代价不在工时而在答辩价值：

- 与 **ADR-0001**（迁移到 Responses API）直接冲突。DashScope 兼容模式大概率不支持 Responses API，需把 `responses.create` 改写为 `chat.completions.create`，并做 usage 字段映射。
- **A5「核心技术说明」答辩点会失效**——其验收标准原文是「可说明 Assistants API 迁移为 Responses API 的原因与影响」，这是现有技术主线之一。
- 工作量约 0.5–1 人日，但会在答辩前给核心功能引入未评估的质量变量，而 `gpt-4o` 当前可用 → 零收益。

**风险缓解已由架构提供**：`Summarizer` 端口已隔离上游实现。若中转站 `gpt-4o` 后续也失效，只需新增一个 chat-completions 适配器 + 改配置，**不需改动 domain**。因此无需预先实现。

### 2.5 方案 C 的硬约束：base64 10 MB 上限

选方案 C 必须先处理一个与现有配置的冲突，**不得静默放过**（项目原则「不可假装可用」）：

| 项 | 当前值 | 方案 C 要求 | 冲突 |
| --- | --- | --- | --- |
| `MAX_UPLOAD_BYTES` | 25 MB | base64 编码后 ≤ **10 MB**（原音频 ≈ **≤7.5 MB**） | ✅ 会超限 |
| `MAX_AUDIO_DURATION_SECONDS` | 3600（1 小时） | 同步接口 **≤5 分钟** | ✅ 会超限 |
| 文件读取方式 | `openAsBlob` **流式**（不整文件进内存） | base64 需**整文件进内存**（∝ 33% 膨胀） | ✅ 内存模型变化 |

官方原文："Base64 编码会增大体积，请控制原文件大小，确保编码后仍符合输入音频大小限制（10MB）"（见参考资料 [3]）

**处理方式（择一，建议 1）**：

1. **下调上传上限**：把 `MAX_UPLOAD_BYTES` 调到 ≤7.5 MB、`MAX_AUDIO_DURATION_SECONDS` 调到 300 秒，并把限制写进 `.env.example` 与 OpenAPI 的 413/422 描述。用户超限时得到**明确业务错误**而非上游失败。
2. **分层校验**：保留 25 MB 上传上限，但在转录前按方案 C 的实际上限校验，超限返回明确的不可处理错误。

同时确认：`DurationProbe` 已解析的音频时长可直接复用于该校验（避免重复解析）。

## 3. 当前架构与改造边界

当前链路：

```text
HTTP 上传
  → 本地文件与 queued Job
  → Worker / ProcessJob
  → OpenAITranscriber（待替换）
  → QwenAsrTranscriber（新建）
  → DashScope 同步识别（base64 + format）
  → Transcript（结构不变，仍为纯文本）
  → 保存 transcript.txt
  → Summarizer（gpt-4o，不变）
```

现有 `Transcriber` 端口已隔离上游实现，主要接入位置如下：

- `src/domain/ports.ts`：`Transcriber` 接口；**不改动**。同文件另有 `UsageMetric` / `MetricsRecorder`（见下方指标一节）。
- `src/infrastructure/openai/transcriber.ts`：现有 Whisper 适配器，**本次删除**（A6-5）。
- `src/bootstrap/container.ts`：**真正的依赖组装处**——`buildContainer()` 在此 `new OpenAITranscriber(...)`（`container.ts:70`）。
- `src/bootstrap/config.ts` 与 `.env.example`：上游凭证、模型、超时、上传上限等配置。
- `src/application/process-job.ts`：依赖端口执行转录；需确认新适配器产出的用量指标被正确接入。
- `tests/unit/openai-transcriber.test.ts`（删除）、`tests/unit/process-job.test.ts`、`tests/e2e/core-flow.test.ts`：适配器、用例与端到端覆盖。

**与已落地的指标采集（C5）对接**：2026-09-24 已合入 `main`（`9b5b3e5`）的可观测指标能力：

- `Transcript` 现含 `characterCount`（转录字数，码点）与 `durationSeconds`（音频时长）两个可选字段。方案 C 须填充 `characterCount`；`durationSeconds` 若上游响应无时长字段则保持 `undefined`（**不得伪造**），由既有 `DurationProbe` 的时长覆盖。
- `ProcessJob` 会把 `transcribeModel`、`transcribeCharacterCount`、`transcribeDurationSeconds`、`transcribeDurationMs` 写入指标落盘。

## 4. 实施任务分解

> A6 整体工作量偏大，此处拆为 7 个子任务，各自可独立认领。编号沿用任务清单习惯（A6-x），每条给出**前置**（必须先完成的任务）、**说明**、**验收标准**与**预估**。可并行项在末尾「并行与关键路径」中说明。

### A6-1 可行性确认

**前置**：无，可立即开始。

**说明**：在所用平台（阿里云百炼国内站）完成四件事，产出后续任务依赖的确定值。一是核对账号可见的模型 ID、地域与 API Key 权限、计费额度。二是确认使用业务空间专属域名 `{WorkspaceId}.cn-beijing.maas.aliyuncs.com` 还是通用域名 `dashscope.aliyuncs.com`（官方称后者仍可正常使用）。三是向 multimodal-generation 端点发一次最小调用——音频以 base64 Data URL 内联，先跑小文件——确认鉴权通过、能返回文本、`parameters.format` 的取值要求与响应结构。四是实测 base64 10 MB 与 5 分钟时长的真实边界，并确认该校验能否复用既有 `DurationProbe`。

顺带做一件零成本的事：开启 `speaker_diarization_enabled: true`，检查返回的 `output.sentences` 是否含 `begin_time` / `end_time`。若含，则时间戳可免费获得（§2.3）；若不含，按 §1.2 放弃，不追加投入。

**验收标准**：产出一份确定的端点与模型 ID、实测的大小与时长上限、`output.sentences` 是否含时间的结论；用项目 `fixtures/audio-sample.mp3` 走通一次真实识别，脱敏记录归档到 `docs/evidence/`。

**预估** 0.5–1 人日。**阻塞 A6-2、A6-3**——它们需要本任务产出的确定值与接口形态。

### A6-2 配置与依赖边界

**前置**：A6-1。

**说明**：在 `AppConfig` 中新增独立 DashScope 配置——`DASHSCOPE_API_KEY`（独立于 `OPENAI_API_KEY`）、`QWEN_ASR_ENDPOINT`、`QWEN_ASR_MODEL`（默认 `qwen-audio-3.1-asr-flash`）、`QWEN_ASR_TIMEOUT_MS`，重试次数沿用既有配置或新增。移除 `OPENAI_TRANSCRIBE_MODEL` 与 `OPENAI_TRANSCRIBE_TIMEOUT_MS`。按 §2.5 选定的方式调整 `MAX_UPLOAD_BYTES` 与 `MAX_AUDIO_DURATION_SECONDS`。更新 `.env.example`、配置单元测试与 `docs/architecture/architecture.md` 的环境变量章节。

注意 `config.ts` 当前在模块加载期即对 `OPENAI_*` 做 `requireEnv` 硬校验，改为分域校验时须保持「启动即失败」的既有语义。

**验收标准**：启动时转录侧只校验 DashScope 凭证、摘要侧只校验 `OPENAI_*`，两域互不误伤；缺失所需 key 时启动即失败；配置单元测试覆盖两域隔离。

**预估** 0.5 人日。**可与 A6-3 并行。**

### A6-3 Qwen 转录适配器

**前置**：A6-1（接口形态）、A6-2（配置项定义）。

**说明**：新增 `src/infrastructure/qwen/QwenAsrTranscriber`，实现现有 `Transcriber` 接口。方案 C 下无需协议客户端——用 Node 内置 `fetch` 发一次 HTTP 调用即可。

读取音频文件后按 MIME 构造 Base64 Data URL（`data:<mediatype>;base64,<data>`，如 `audio/wav`、`audio/mpeg`），作为 `input.messages[].content[].input_audio.data` 提交，`parameters.format` **必填**（取值 `wav` / `mp3` / `opus` 等，按实际格式），`sample_rate` 视需要填写（见参考资料 [3]）。

**响应结构非标准**，须特别注意：识别文本位于 `output.text`（或 `output.output.sentence.text`），该端点**没有 `choices` 字段**，照搬 OpenAI 风格解析会取不到文本，须按此实现并做字段缺失的安全兜底（见参考资料 [2]）。

编码前/后校验大小与时长上限，超限时抛**明确的 `DomainError`**，不得让上游报错穿透，也不得静默失败。填充 `Transcript.characterCount`（按码点计数）；`durationSeconds` 若上游未返回则保持 `undefined`，**不得伪造**。整文件进内存做 base64 与现有 `openAsBlob` 流式读取的取舍，需在代码内注释说明。复用既有 `infrastructure/common/retry.ts` 的重试语义：网络/限流/服务端错误受控重试，鉴权/格式/参数错误不重试。

**验收标准**：给定本地音频文件能返回正确文本；超限输入抛明确业务错误；日志不含 API Key 与音频内容；不改动 `Transcript` 结构与产物落盘格式。

**预估** 0.5–1 人日。**阻塞 A6-4**。

### A6-4 自动化测试（复用 + 新增）

**前置**：A6-3。

**说明**：删除 `OpenAITranscriber` 时其测试不简单删掉，而应把 `tests/unit/openai-transcriber.test.ts` 的骨架（正常调用并返回文本 / 请求选项携带 timeout / 429 后重试成功 / 4xx 立即抛不重试 / 上游失败向上抛错）**重构搬运**为 Qwen 适配器测试。

另须新增方案 C 专属用例：base64 Data URL 构造与 `parameters.format` 的一致性；`output.text` 响应解析（含 `output.output.sentence.text` 变体与字段缺失的兜底）；超限分支（含恰好等于上限的边界值）；指标字段（`characterCount` 正确、`durationSeconds` 不得伪造）；错误映射与日志脱敏（401/403/429/5xx/超时）；配置两域隔离。

**验收标准**：`npm test` 全绿，覆盖率不低于当前基线（≥80%）；`ProcessJob` 与 B7 E2E 的既有断言保持不变；CI 不访问真实上游。

**预估** 0.5–1 人日。**阻塞 A6-5**——删除旧适配器须待测试迁移完成。

### A6-5 依赖注入与旧适配器下线

**前置**：A6-2、A6-3、A6-4。

**说明**：在 `src/bootstrap/container.ts` 的组合根（`buildContainer()`，`container.ts:70` 处）把 `OpenAITranscriber` 替换为 `QwenAsrTranscriber`。删除 `src/infrastructure/openai/transcriber.ts` 及其 import 与实例化。`transcribeModel` 依赖项**保留**，改为传入 Qwen 模型名（仍写入 Job `result.model` 与指标落盘）。更新 mock system / e2e test factory，使其仍能通过 fake transcriber 跑完整链路。

**验收标准**：`npm run verify` 全绿；全仓库不再引用 `OpenAITranscriber` 与 `OPENAI_TRANSCRIBE_*`；Job 状态机、HTTP API、OpenAPI 与前端流程无变化。

**预估** 0.25–0.5 人日。**可与 A6-6 并行。**

### A6-6 文档同步

**前置**：A6-5（架构文档需按最终实现的类名与配置名书写）。

**说明**：更新 `docs/architecture/architecture.md`（28/61/98/150 行提及 `OpenAITranscriber` / `whisper-1`）、`docs/project-structure.md`（33 行）与 `.env.example`；必要时新增 ADR（单 provider 决策、base64 上限约束）；回填 `docs/project-division/task-list.md` 中 A6 及其子任务的状态。

**验收标准**：`npm run check:docs` 与 `npm run check:structure` 通过；文档中不再出现 `whisper-1` 作为当前实现。

**预估** 0.25–0.5 人日。

### A6-7 真实服务联调与验收

**前置**：A6-5、A6-6。

**说明**：在开发者本机或安全的受控环境执行，不进入普通 CI。用 `.env` / 密钥管理器提供 DashScope Key，禁止写入证据、日志或截图。跑通上传 → 转录 → 摘要 → 下载全链路，核对 Job 终态为 `succeeded` 或安全的 `failed`；用许可明确的短音频验证中文/英文与不同格式；确认转录文本完整无截断；上传一个超限音频确认返回**明确的业务错误**（而非上游报错或静默失败）；核对 `metrics.jsonl` 中 `transcribeCharacterCount` / `transcribeDurationMs` 非空（`transcribeDurationSeconds` 允许为空）；检查 requestId/jobId 日志关联与错误响应脱敏。

**对照基线的方式**：`whisper-1` 已不可用、无法现场复跑，不能做实时 A/B。改为对照 `docs/evidence/` 中归档的历史记录——2026-08-24 的 whisper-1 实测（转录 9009ms / 摘要 3276ms，见 `docs/evidence/README.md`）可作参照。质量结论只基于同一批有授权的样本，不夸大为通用评测。

**验收标准**：全链路真实跑通并留存脱敏证据；超限返回明确业务错误；证据中明确区分 fake 与真实联调结果。

**预估** 0.5 人日。

### 并行与关键路径

**关键路径**为 A6-1 → A6-3 → A6-4 → A6-5 → A6-7，串联长度决定整体工期。

**可并行项**：A6-2 与 A6-3 在 A6-1 完成后可同时进行（前者定配置、后者写适配器）；A6-5 与 A6-6 可同时进行。

**分工建议**：若两人投入，A6-1 与 A6-2 由一人完成（配置项直接依赖实测结论），A6-3 与 A6-4 由另一人完成——测试与适配器由同一人写沟通成本最低。A6-7 需真实平台凭证，建议由持有账号者执行。

### 备选路径

若 A6-1 判定方案 C 不可行，按下列顺序降级评估，工作量为在方案 C 基础上的增量：

- **方案 B（异步文件转写）**：需新增音频公网托管（OSS 上传与签名 URL），提交 `input.file_urls` 后轮询 `task_id`，解析 `sentences[]` 与 `words[]` 时间戳。增量约 **+1.5–2 人日**，另加 OSS 基建配置。
- **方案 A（WebSocket 实时流式）**：需实现完整 WebSocket 会话、事件聚合（区分中间结果与最终片段，禁止简单拼接造成重复）、`session.finish` 发送顺序与 socket 清理。增量约 **+2–4 人日**。

两者的接入要点见参考资料 [5][6]（方案 A）与 [2]（方案 B）。

## 5. 预计改动文件

| 区域 | 预计改动 | 关联任务 |
| --- | --- | --- |
| 配置 | `src/bootstrap/config.ts`（移除 `OPENAI_TRANSCRIBE_*`、新增 `QWEN_ASR_*` / `DASHSCOPE_API_KEY`、调整上传上限）、`tests/unit/config.test.ts`、`.env.example` | A6-2 |
| 领域模型 | **不变**（时间戳已放弃，见 §2.3） | — |
| 上传校验 | `MAX_UPLOAD_BYTES` / `MAX_AUDIO_DURATION_SECONDS` 调整（§2.5） | A6-2 |
| 适配器 | 新增 `src/infrastructure/qwen/` 下 `QwenAsrTranscriber`；**删除 `src/infrastructure/openai/transcriber.ts`** | A6-3 / A6-5 |
| 依赖组装 | `src/bootstrap/container.ts`、`tests/unit/container.test.ts` | A6-5 |
| 用例 | `src/application/process-job.ts`：仅确认指标字段接入 | A6-3 |
| 通用日志/重试 | 复用既有 `infrastructure/common/retry.ts` 与错误分类；事件改名（`openai.transcribed` → provider 中立）作为独立小改，不在本次一并做 | — |
| 测试 | 删除 `tests/unit/openai-transcriber.test.ts` 并**重构搬运**为 Qwen adapter 单测；新增专属用例；更新配置/DI/system fake | A6-4 |
| 文档 | `docs/architecture/architecture.md`、`docs/project-structure.md`、`.env.example`、必要时新增 ADR、本次实施证据 | A6-6 |
| **不应变化** | HTTP 路由、OpenAPI、前端上传/轮询/下载流程、Job 状态机、摘要链路、`src/domain/ports.ts` | — |

## 6. 验收与质量门禁

### 自动门禁

```bash
npm run verify          # lint + lint:openapi + typecheck + check:docs + check:structure + 安全豁免 + 测试 + 覆盖率 + web:verify
npm run test:b7         # 核心闭环 E2E
git diff --check
```

- 既有 API contract / OpenAPI 测试仍通过；除上传上限描述外无 OpenAPI 变更。
- 不降低仓库当前覆盖率门槛；新增适配器的正常、超限、错误、重试分支均覆盖。
- 不为访问真实模型而增加 CI secret 或联网集成测试。

### 人工验收

- 在 fake 上游上完成上传至摘要的全链路（A6-4）。
- 在受控环境完成真实 Qwen 服务联调，证明文本完整、Job 可下载、超时和错误行为安全（A6-7）。
- **上限验收**：超限音频返回明确业务错误，不是上游报错穿透、也不是静默失败。
- **指标验收**：`metrics.jsonl` 中转录字数与耗时列非空且合理。
- 文档和证据清楚区分自动化 fake 结果与真实服务联调结果。

## 7. 工作量估算

按 §4 的任务分解逐项加总（含测试与文档）：

| 任务 | 预估（人日） |
| --- | ---: |
| A6-1 可行性确认 | 0.5–1 |
| A6-2 配置与依赖边界 | 0.5 |
| A6-3 Qwen 转录适配器 | 0.5–1 |
| A6-4 自动化测试 | 0.5–1 |
| A6-5 依赖注入与旧适配器下线 | 0.25–0.5 |
| A6-6 文档同步 | 0.25–0.5 |
| A6-7 真实服务联调与验收 | 0.5 |
| **合计（方案 C）** | **约 3–5 人日** |

**关于备选方案**：方案 B 为方案 C 的 **+1.5–2 人日**（OSS 基建与异步轮询），方案 A 为 **+2–4 人日**（WebSocket 协议栈）。方案 A 若协议与 Node 运行时集成顺利可能接近下限；若需容器格式转换、账号域名/权限排查或复杂的事件聚合/重连，则接近上限。

> 本表按任务逐项加总，**替换了此前偏乐观的区间估算**。含测试与文档；**不包含**前端实时字幕、摘要模型切换（§2.4），也**不包含**备选方案所需的 OSS 基建搭建成本。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **base64 上限导致大文件失败** | 用户上传超 7.5 MB 时转录失败；若处理不当会出现上游报错穿透或静默失败 | 按 §2.5 下调/分层校验上限，返回**明确业务错误**；A6-1 实测真实边界；写入 OpenAPI 与 `.env.example`。**不得静默截断或伪造成功** |
| **整文件进内存** | 方案 C 需 base64 编码，内存峰值升高，与现有流式读取不同 | §2.5 的上限下调即是保护；适配器内注释说明取舍；联调时观察内存 |
| **响应结构非标准** | 该端点无 `choices` 字段，照搬 OpenAI 风格解析会取不到文本 | 按 §4 A6-3 解析 `output.text` 并做字段缺失兜底；A6-4 补对应测试 |
| **时间戳缺失** | 与老师原话「带时间戳文本」的表述不一致 | 已按 §1.2 优先级接受。缓解：答辩话术相应调整；A6-1 零成本验证 `output.sentences` 是否含时间；若日后需要，方案 B/A 路径已在本计划留档 |
| **编码格式、容器与 MIME 不匹配** | 服务端拒绝或识别错误 | 按上传校验后的 MIME/扩展名构造 Data URL 与 `parameters.format`；真实样本验证；有需求再独立评估 FFmpeg 转码 |
| **错误格式和重试边界不同于原上游** | Job 失败被误判或重复扣费 | 适配器内映射安全错误类别；测试 4xx 与网络/429/5xx；避免双重重试 |
| **凭证域混淆** | 启动需同时设置两家密钥 | 配置分域——转录只校验 `DASHSCOPE_API_KEY`，摘要只校验 `OPENAI_*`；日志禁止输出密钥 |
| **选型误判** | 高估/低估某方案的代价，多花数人日 | 判据已显式化（§1.2）+ A6-1 先跑通方案 C 再决定是否降级；工作量对照表见 §7 |
| **对照基线不可得** | 无法与 Whisper 做实时 A/B | 用 `docs/evidence/` 中归档的历史记录作参照（§4 A6-7） |

## 9. 实施前待确认事项

1. **【待你确认】上传上限方案**（§2.5）：把 `MAX_UPLOAD_BYTES` 直接降至 ≤7.5 MB，还是保留 25 MB 上传但转录前分层校验？**建议前者**（口径统一、错误更早暴露）。这会影响 `.env.example`、OpenAPI 描述与前端提示，且是 A6-2 的输入。
2. **【A6-1 实测】端点与模型**：使用业务空间专属域名还是通用域名 `dashscope.aliyuncs.com`；模型 ID 与地域以账号可见值为准。
3. **【A6-1 实测】上限边界**：base64 10 MB 与 5 分钟时长的真实边界，以及 `output.sentences` 是否含时间字段。
4. **【需准备】** 阿里云百炼账号的地域、API Key 权限与测试额度。
5. **【已定 · 无需再议】** 单 provider，直接替换并删除 `OpenAITranscriber`（§2.2、A6-5）。
6. **【已定 · 无需再议】** 摘要模型保持 `gpt-4o`（§2.4）。
7. **【已定 · 无需再议】** 本次不交付时间戳（§2.3）。
8. **【默认】** 不引入 FFmpeg 或其他外部进程；需要时另行评估。

## 10. 官方参考资料

> **仅采用国内站（`help.aliyun.com/zh/model-studio/`）文档。** 海外 QwenCloud 站（`docs.qwencloud.com` / `maas.qwencloudapi.com`）与本项目所用平台不是同一产品，其模型命名（`qwen3-asr-flash*`）、端点（`/compatible-mode/v1/chat/completions`）与字段均**不作为本项目依据**。

1. [阿里云百炼：语音识别概述（模型选型）](https://help.aliyun.com/zh/model-studio/asr-model) — 模型 ID、实时/非实时、时长上限、说话人分离、语种支持；闭源模型迁移对照表（非实时/文件转写 ← Whisper）。
2. [阿里云百炼：非实时语音识别（用户指南）](https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide) — **核心依据**：异步/同步模型的划分；同步模型「适用于 5 分钟以内的音频文件」；filetrans「仅接受公网音频文件 URL（不支持本地文件上传）」；异步结果含 `sentences[]`（`begin_time` / `end_time`）与 `words[]`；同步响应结构为 `output.text` / `output.output.sentence.text`，**无 `choices` 字段**。
3. [阿里云百炼：非实时语音识别 HTTP API（Qwen-Audio-3.x-ASR-Flash / Fun-ASR-Flash）](https://help.aliyun.com/zh/model-studio/fun-asr-flash-recorded-speech-recognition-http-api) — **方案 C 的核心依据**：端点 `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`（并注明通用域名 `dashscope.aliyuncs.com` 仍可用）；`input.messages[].content[].input_audio.data` 支持 **音频 URL 或 Base64 Data URI**（`data:<mediatype>;base64,<data>`）；`parameters.format` **必选**；`speaker_diarization_enabled` / `keep_dialect` 仅 `qwen-audio-3.1-asr-flash` 支持；**"确保编码后仍符合输入音频大小限制（10MB）"**。
4. [阿里云百炼：语音识别 API 参考（索引）](https://help.aliyun.com/zh/model-studio/speech-recognition-api-reference/) — 实时/非实时语音识别与定制热词的 API 分类入口。
5. [阿里云百炼：Qwen-ASR-Realtime WebSocket 接入指南](https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-interaction-process) — WebSocket URL 形态、请求头鉴权、VAD 与 Manual 两种模式；「推完音频必须先发 `session.finish` 再关连接」的官方警告。
6. [阿里云百炼：Qwen-ASR-Realtime 服务端事件](https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-server-events) — `input_audio_buffer.speech_started`（`audio_start_ms`）/ `speech_stopped`（`audio_end_ms`）/ `conversation.item.input_audio_transcription.text`（中间结果）/ `.completed`（最终结果）。
7. [阿里云百炼：实时语音识别用户指南](https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide) — 实时模型介绍与完整示例代码。
8. [阿里云百炼：业务空间专属域名与地域](https://help.aliyun.com/zh/model-studio/regions) — `{WorkspaceId}` 域名迁移说明与各地域差异。

> 官方文档和模型服务可能更新。A6-1 必须以实际账号可见的当前模型 ID、地域端点、参数及限制为准；本计划中的估算不代表服务商 SLA 或费用承诺。
