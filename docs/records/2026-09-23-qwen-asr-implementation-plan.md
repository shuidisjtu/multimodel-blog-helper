# Qwen-ASR 接入实施计划

> 日期：2026-09-23  
> 修订：**v3 / 2026-09-24**（v2 依据官方文档评审；v3 依据需求优先级声明重排选型）  
> 状态：**待定选型**（首选最小改动路径，见 §1.0 与 §1.1）/ 尚未实施  
> 目标模型：**待选型确定**——首选 `qwen3-asr-flash` 类的 HTTP 同步接口（最小改动），备选 `qwen-audio-3.1-asr-flash-filetrans` / `-streaming`  
> 计划分支：`feature/qwen-asr-migration`

## 1. 目标与决策

将当前转录实现从 OpenAI Whisper (`whisper-1`) 切换为 Qwen-ASR，同时保留项目既有的异步任务体验：用户上传完整音频，服务端后台识别，用户通过现有 Job API 查询最终转录与摘要。

> **⚠️ 首要事实**：`whisper-1` 已不可用（issue #16），**本项目当前没有任何可用的转录能力**。因此本次改造的 P0 目标是「恢复转录可用」，而非「叠加新能力」。

### 1.0 需求优先级（v3 决策原则）

**2026-09-24 需求方声明**：

> 如果出现**对现有项目模块改动最小、且能实现转录功能**、唯独不支持时间戳的模型接入方式，**应采用该方案**；不必要为了时间戳这一个功能显著增加项目的工作量和复杂度。

据此确立本次选型的判据，**按顺序满足**：

1. **能转录**（P0，硬性）——当前完全不可用，必须先恢复。
2. **对现有模块改动最小**（P1，硬性）——不引入新协议栈、不引入新基建依赖、不改变安全边界。
3. **时间戳**（P2，**机会性**）——若所选方案恰好支持则一并交付；**若需为此显著增加工作量或复杂度，则放弃**，转为后续增强。

> **对答辩叙事的影响（需知悉）**：老师原话中「核心功能展示以**音频转录为带时间戳文本**和摘要生成为主」。按本优先级若最终不交付时间戳，**答辩话术需相应调整**（改为「转录 + 摘要」为核心，时间戳列为已知边界与后续方向）。此项为需求方已知情的选择，记录在此以备答辩时口径一致。

**v3 修订要点**（相对 v2，1 项重排）：

| # | 修订 | 依据 |
| --- | --- | --- |
| 5 | **选型判据重排**：以「改动最小 + 能转录」为首选，时间戳降为机会性目标；据此把 v2 排除的 base64 同步路径**重新列为首选** | §1.0、§1.1 |

**v2 修订要点**（4 项，依据见各小节）：

| # | 修订 | 依据 |
| --- | --- | --- |
| 1 | ~~时间戳纳入本次范围~~ → **v3 下调为机会性目标**（见 §1.0、§1.2） | §1.2 |
| 2 | 模型版本 `3.0` → `3.1` | §1.1 |
| 3 | **取消双 provider 回滚设计**，改单 provider 并删除 `OpenAITranscriber` | §1.3 |
| 4 | 选型改为待定，不再默认 streaming | §1.1 |

本计划**不做前端实时字幕**。若最终选方案 A（streaming），当前应用仍是在上传完成后才开始处理：服务端将已落盘音频分块送入 WebSocket 会话，收集并合并最终识别结果后返回 `Transcript`。这不是「用户说话时实时看到字幕」的产品能力。所选模型与协议以阶段 0 的选型结论为准（§1.1）。

### 1.1 模型选型（v3 重排：以最小改动为首选）

Qwen-ASR 不是当前 `client.audio.transcriptions.create({ file, model })` 的直接模型名替换。按 §1.0 判据评估三种接入形态：

| 方案 | 接口形态 | 本地文件 | 时间戳 | 新增协议/基建 | 工程量 | 排序 |
| --- | --- | --- | --- | --- | --- | --- |
| **C. HTTP 同步 + base64**<br>`qwen3-asr-flash` 类 | OpenAI 兼容 `/compatible-mode/v1/chat/completions` | ✅ **base64 内联** | ❌ **无** | **无**（沿用 openai SDK） | **~1–1.5 人日** | **首选** |
| B. HTTP 异步（filetrans）<br>`qwen-audio-3.1-asr-flash-filetrans` | DashScope 异步 + 轮询 | ❌ | ✅ 句级 + 词级 | 需**音频公网托管**（OSS/隧道） | ~2–3 人日 + 基建 | 备选 |
| A. WebSocket 实时流式<br>`qwen-audio-3.1-asr-flash-streaming` | WebSocket 双向协议 | ✅ 分块发送 | ✅ VAD 事件 | **整套 WebSocket 协议栈** | ~4.5–8.5 人日 | 末选 |

**方案 C 为首选（v3 变更）**——它正是 §1.0 所述的「改动最小 + 能转录、唯独无时间戳」的路径：沿用现有 `openai` SDK，仅新增一个适配器、改配置，**不引入新协议、不引入新基建、不改变安全边界**。其代价是**无时间戳**，按 §1.0 优先级可接受。

**关键事实（均已由官方 API 参考确认，非推测）**：

- **filetrans 必须公网 URL**：`input.file_url` 官方描述为 "Must be accessible over the Internet"，"Audio formats" 一节亦写明 "Audio file URLs must be publicly accessible." → 本地 `temp/` 文件不可用，**除非引入音频公网托管**。见参考资料 [6]。
- **同步/base64 路径无时间戳**：其 `asr_options` 仅有 `language` 与 `enable_itn` 两个参数（对比 filetrans 有 `enable_words` 控制句级/词级），响应体仅含 `content[].text` 与 `annotations`（language、emotion），**无任何时间字段**。见参考资料 [7][8]。
- **base64 有 10 MB 上限**：官方明确 "Keep the encoded audio within the 10 MB limit"，且 base64 膨胀约 33% → 原始音频约 **≤ 7.5 MB**。见参考资料 [7]。**该约束与项目当前 `MAX_UPLOAD_BYTES=25MB` 冲突，必须处理（见 §1.6）。**

**平台命名差异（实测前必查）**：官方文档存在两套命名——阿里云百炼（国内）用 `qwen-audio-3.1-asr-flash-*`，QwenCloud（国际）用 `qwen3-asr-flash*`。本计划的结构性结论两站一致，但**模型 ID 必须以阶段 0 实测的账号可见值为准**。

**版本号**：v1 使用的 `qwen-audio-3.0-asr-flash-streaming` 仍是有效模型，但官方当前推荐为 `3.1`。若选方案 C，以其对应模型 ID 为准。见参考资料 [1]。

### 1.2 时间戳：机会性目标（v2 提出，v3 下调）

v1 计划 §1/§2/§4 三处锁定现有 `Transcript = { text }` **纯文本**，即完全不产出时间戳。v2 曾要求把时间戳纳入本次范围。

**v3 按下调为机会性目标**（§1.0 第 3 条）：首选方案 C 不支持时间戳，但因其改动最小，**不为此改用更重的方案**。执行口径：

- **不做**：不为时间戳扩展 `Transcript`、不改产物落盘格式、不改查询/下载接口（这些正是 v2 曾要求的）。
- **要查**：阶段 0 顺带确认所选模型**是否恰好支持时间戳**（参数或响应字段）。若恰好支持则免费获得，直接交付；若需换模型或加协议才支持，则放弃。
- **要记**：放弃时间戳后，答辩口径需相应调整（见 §1.0 的影响说明）。

**各形态的时间戳能力（已核实）**：

| 形态 | 时间戳 | 可得方式 |
| --- | --- | --- |
| 方案 C 同步/base64 | ❌ **无** | —（官方响应无可返回字段） |
| 方案 B filetrans | ✅ 句级 + 词级 | `sentence.begin_time` / `end_time`（毫秒）；`enable_words` 或 `timestamp_granularities` 切句级/词级；DashScope 异步**时间戳永久启用**。见参考资料 [4] |
| 方案 A streaming | ✅ | VAD 事件 `input_audio_buffer.speech_started.audio_start_ms` / `speech_stopped.audio_end_ms`。见参考资料 [3] |

> 注：v2 曾写「Qwen 三种形态均具备时间戳能力」——**该表述有误**，方案 C 不具备，此处已更正。

### 1.3 取消双 provider 回滚设计（v2 修订）

v1 阶段 1/3 设计 `TRANSCRIBE_PROVIDER=openai|qwen-streaming`，为「回滚到 Whisper」保留双适配器。**该设计的前提已失效**：`whisper-1` 在中转站已不可用（issue #16），**回滚目标不存在**。保留的代价却是实的：条件化配置校验、两套适配器、两套测试、双份文档。

**修订为单 provider**，并删除 `OpenAITranscriber`。删除的正当性：

- 该适配器在生产中**无法运行**（whisper-1 不可用），属死代码；项目原则 YAGNI 不支持为假设性需求保留死代码。
- 「留作对比评估基线」的设想**不成立**——无法对一个无法调用的模型做 A/B。
- 端口边界不变，未来若需恢复，从 git 历史取回适配器 + 加配置即可，成本极低。

删除影响面（可控）：`src/infrastructure/openai/transcriber.ts`、`src/bootstrap/container.ts` 的 import 与实例化、`tests/unit/openai-transcriber.test.ts`、`docs/architecture/architecture.md` 4 处引用、`docs/project-structure.md` 1 处、`.env.example` 的 `OPENAI_TRANSCRIBE_MODEL` / `OPENAI_TRANSCRIBE_TIMEOUT_MS`。

⚠️ **`transcribeModel` 配置项本身保留**——它改为指向千问模型名，且被写入 Job `result.model` 与指标落盘 `metrics.jsonl`。

### 1.4 目标与非目标

**目标**

- **恢复转录可用**（P0，当前 whisper-1 已失效、转录完全不可用）。
- 以 Qwen-ASR 替换现有 Whisper 转录适配器（删旧适配器，单 provider），**优先选改动最小的方案 C**（§1.0、§1.1）。
- 保持 Job 状态机、HTTP API、OpenAPI 与 Web 前端行为不变。
- **不扩展 `Transcript` 领域模型、不改产物格式**（v3：时间戳为机会性目标，见 §1.2）。
- 保留任务级超时、可恢复错误重试、结构化日志和安全错误映射。
- 以 fake 协议客户端测试作为 CI 基础，不让自动化测试依赖真实 Qwen 网络或密钥。

**非目标**

- 不向浏览器开放 Qwen API Key，不由浏览器直连模型服务。
- 不新增 WebSocket 前端接口、实时字幕或实时进度协议。
- **不改摘要模型**（保持 `gpt-4o`；理由见 §1.5）。
- 不改天气服务、上传 DTO、文件保留策略或 OpenAPI。
- 不把音频全文、密钥、上游原始错误或本地文件路径写入日志。
- 不默认加入第三方音频转码程序（如 FFmpeg）；是否需要转码由 spike 结果决定。

### 1.5 摘要模型保持 GPT-4o 的决策（v2 新增）

**结论：本次不改摘要模型。** 即便「统一供应商」看起来更整齐，代价不在工时而在答辩价值：

- 与 **ADR-0001**（迁移到 Responses API）直接冲突。DashScope 兼容模式**大概率不支持 Responses API**，需把 `responses.create` 改写为 `chat.completions.create`，并做 usage 字段映射（`prompt_tokens`/`completion_tokens` → `inputTokens`/`outputTokens`）。
- **A5「核心技术说明」答辩点会失效**——其验收标准原文是「可说明 Assistants API 迁移为 Responses API 的原因与影响」，这是现有技术主线之一。
- 工作量约 0.5–1 人日（适配器改写 + 测试 + ADR），但会在答辩前给核心功能引入未评估的质量变量，而 `gpt-4o` 当前可用 → **零收益**。

**风险缓解已由架构提供**：`Summarizer` 端口已隔离上游实现，若中转站 `gpt-4o` 后续也失效，只需新增一个 chat-completions 适配器 + 改配置，**不需改动 domain**。因此无需预先实现，记录为 Plan B 即可。

### 1.6 方案 C 的硬约束：base64 10 MB 上限（v3 新增）

选方案 C 必须先处理一个与现有配置的冲突，**不得静默放过**（项目原则「不可假装可用」）：

| 项 | 当前值 | 方案 C 要求 | 冲突 |
| --- | --- | --- | --- |
| `MAX_UPLOAD_BYTES` | 25 MB | base64 编码后 ≤ **10 MB**（原音频 ≈ **≤7.5 MB**） | ✅ 会超限 |
| `MAX_AUDIO_DURATION_SECONDS` | 3600（1 小时） | 同步接口实测约 **≤5 分钟**（待确认） | ✅ 会超限 |
| 文件读取方式 | `openAsBlob` **流式**（不整文件进内存） | base64 需**整文件进内存**（∝ 33% 膨胀） | ✅ 内存模型变化 |

**必须做的处理（择一，建议 1）**：

1. **下调上传上限**：把 `MAX_UPLOAD_BYTES` 调到 ≤7.5 MB、`MAX_AUDIO_DURATION_SECONDS` 调到实测时长上限，并把限制写进 `.env.example` 与 OpenAPI 的 413/422 描述。用户超限时得到**明确业务错误**而非上游失败。
2. **分层校验**：保留 25 MB 上传上限，但在转录前按方案 C 的实际上限校验，超限返回明确的不可处理错误。

同时需确认：`DurationProbe` 已解析的音频时长可直接复用于该校验（避免重复解析）。

## 2. 当前架构与改造边界

当前链路：

```text
HTTP 上传
  → 本地文件与 queued Job
  → Worker / ProcessJob
  → QwenAsrTranscriber（新建，首选方案 C）
  → Qwen-ASR 兼容接口（chat completions + base64）
  → Transcript（v3：结构不变，仍为纯文本）
  → 保存 transcript.txt
  → Summarizer
```

现有 `Transcriber` 端口已隔离上游实现，主要接入位置如下（**v2 已按实际代码校正路径**）：

- `src/domain/ports.ts`：`Transcriber` 接口；**v3：不改动**（v1 说「不改变」是对的，v2 曾要求加时间戳 `segments`，v3 已撤销）。同文件另有 `UsageMetric` / `MetricsRecorder`（见下方指标一节）。
- `src/infrastructure/openai/transcriber.ts`：现有 Whisper 适配器，**v2 决定删除**（§1.3），仅作迁移参考。
- `src/bootstrap/container.ts`：**真正的依赖组装处**——`buildContainer()` 在此 `new OpenAITranscriber(...)`（`container.ts:70`）。v1 误写为 `server.ts`；`server.ts` 只在 `server.ts:23` 调用 `buildContainer(config)`。
- `src/bootstrap/config.ts` 与 `.env.example`：上游凭证、模型、超时等配置。
- `src/application/process-job.ts`：依赖端口执行转录；**需确认新适配器产出的用量指标被正确接入**（v3：不涉时间戳）。
- `tests/unit/openai-transcriber.test.ts`（删除）、`tests/unit/process-job.test.ts`、`tests/e2e/core-flow.test.ts`：适配器、用例与端到端 fake 覆盖。

**v2 新增：与已落地的指标采集（C5）对接。** 2026-09-24 已合入 `main`（`9b5b9e5`）的可观测指标能力，v1 计划成文于其前、未覆盖：

- `Transcript` 现含 `characterCount`（转录字数，码点）与 `durationSeconds`（音频时长）两个可选字段。**方案 C 须填充 `characterCount`**；`durationSeconds` 因该路径响应无时长字段，保持 `undefined`（不得伪造），由既有 `DurationProbe` 的时长覆盖。备选方案 A/B 则可从 VAD 事件或句级时间戳推导该值。
- `ProcessJob` 会把 `transcribeModel`、`transcribeCharacterCount`、`transcribeDurationSeconds`、`transcribeDurationMs` 写入指标落盘。

预期新建 Qwen 专用 infrastructure adapter 和协议/客户端封装。**v2 已定：单 provider，不引入 `TRANSCRIBE_PROVIDER` 开关**（§1.3），但 DashScope 配置仍须独立于 `OPENAI_*` 命名空间，**不得把 DashScope 端点错塞进 `OPENAI_BASE_URL`**。

## 3. 实施阶段

### 阶段 0：可行性确认（0.5–1 人日，v3 大幅缩减）

**v3 变更有两点**：(1) 原「第 1 项判定 filetrans 是否需公网 URL」**已由官方文档直接确认，无需 spike**（§1.1 依据）；(2) 首选方案 C 不需新建协议栈，spike 从「协议探险」降级为「跑通一次调用」。

**已确认、无需再测**（依据见 §1.1 与参考资料 [6][7][8]）：

- ❌ ~~filetrans 是否需公网 URL~~ → **是，官方明确要求**（`file_url` "Must be accessible over the Internet"）
- ❌ ~~base64 路径是否支持时间戳~~ → **否**（`asr_options` 无时间戳参数，响应无时间字段）

**待实测项（按序）**：

1. **核对账号实际模型 ID 与权限**：登录所用平台（阿里云百炼 / QwenCloud），确认可见的模型 ID、地域、Key 权限与计费额度。**两站命名不同**（`qwen-audio-3.1-asr-flash-*` vs `qwen3-asr-flash*`），以账号实际可见值为准。
2. **跑通方案 C 最小调用**：用 OpenAI SDK 对 `/compatible-mode/v1/chat/completions` 发一次请求，音频以 base64 Data URL 内联（`data:audio/mpeg;base64,...`）。用项目 `fixtures/audio-sample.mp3` 与官方示例音频各跑一次，**先跑小文件**。确认：鉴权通、能返回文本、`usage` 字段形态（供 C5 指标）。
3. **顺带确认上限（决定 §1.6 的配置改法）**：实测 base64 10 MB 限制与音频时长上限的真实边界（同步接口文档口径约 ≤5 分钟）。**同时确认该校验与既有 `DurationProbe` 能否复用。**
4. **顺带查时间戳（零成本）**：检查所选模型是否**恰好**存在时间戳参数或响应字段。若有则免费获得（§1.2）；若需换模型或加协议才支持，**按 §1.0 放弃**，不追加投入。
5. **仅当方案 C 跑不通时**才进入备选评估：方案 B 需额外验证音频公网托管（OSS 签名 URL）通路；方案 A 需按 v2 原文验证 WebSocket 会话、事件与清理语义（URL 形态 `wss://{WorkspaceId}.<region>.maas.aliyuncs.com/api-ws/v1/realtime?model=<model_name>`，模型名走查询参数、鉴权走请求头，见参考资料 [2]）。

**通过条件**：方案 C 能稳定返回正确文本；上限边界已实测；选型结论写入本计划。若方案 C 失败，再按第 5 项降级评估，并把失败原因记录到证据目录。

### 阶段 1：配置与依赖边界（0.5 人日）

**v2 修订：取消 `TRANSCRIBE_PROVIDER` 开关**（§1.3）——回滚目标 `whisper-1` 已不可用，双 provider 只带来条件化校验与双份测试的复杂度。改为单 provider，同时保留 DashScope 配置独立命名空间。

- 在 `AppConfig` 中新增独立 Qwen ASR 配置，至少包含：
  - `QWEN_ASR_API_KEY`（**独立于 `OPENAI_API_KEY`**）；
  - `QWEN_ASR_ENDPOINT`（方案 A 为 WebSocket URL，方案 B 为 HTTP 端点；默认值须经 spike 按账号地域与 Workspace 确认，**不硬编码账号专属 Workspace**）；
  - `QWEN_ASR_MODEL`（默认按选型取 `qwen-audio-3.1-asr-flash-streaming` 或 `qwen-audio-3.1-asr-flash-filetrans`）；
  - `QWEN_ASR_TIMEOUT_MS`；
  - 可选 `QWEN_ASR_MAX_RETRIES`，或沿用已有统一重试次数配置。
- **配置校验策略（v2）**：转录侧只校验 Qwen 凭证；`OPENAI_*` 仅保留摘要所需（`OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_SUMMARY_MODEL` / `OPENAI_SUMMARY_TIMEOUT_MS`），**移除 `OPENAI_TRANSCRIBE_MODEL` 与 `OPENAI_TRANSCRIBE_TIMEOUT_MS`**（随适配器删除）。注意 `config.ts` 当前在模块加载期即对 `OPENAI_*` 做 `requireEnv` 硬校验，调整时需保持「启动即失败」的既有语义。
- 更新 `.env.example`、配置单元测试和架构文档环境变量章节（`docs/architecture/architecture.md`）。
- 核实协议客户端依赖是否已由 Node 24 内置能力满足：方案 A 看 WebSocket（Node 内置 `WebSocket`），方案 B 看 HTTP/上传。只有 spike 证明需要时才添加依赖，并固定安全版本、更新 lockfile 与供应链检查（C3 门禁）。
- 禁止自动根据某个凭证「猜测」服务商：单 provider 下直接使用 Qwen 配置，缺失即启动失败。

### 阶段 2：Qwen 转录适配器（v3：首选方案 C，**约 0.5–1 人日**）

新增 `src/infrastructure/qwen/` 下的 `Transcriber` 实现（可命名为 `QwenAsrTranscriber`），继续实现现有 `Transcriber` 接口。**方案 C 路径下无需协议客户端**——它是一次普通的 HTTP 调用。

1. **（方案 C，首选）** 用 OpenAI SDK 调 `/compatible-mode/v1/chat/completions`：读取音频文件 → 按 MIME 构造 base64 Data URL（`data:<mediatype>;base64,<data>`）→ 作为 `input_audio` 内容发送 → 取 `choices[0].message.content` 作为文本。
2. 按已校验的 MIME 构造 Data URL 的 `mediatype`；不得仅依赖用户文件名，使用现有上传校验产出的 MIME/存储扩展名。
3. **【v3 关键】超限处理（§1.6）**：编码前/后校验大小上限，超限时抛**明确的业务错误**（沿用 `DomainError`，不得让上游报错穿透、也不得静默失败）。同时确认 §1.6 选定的上限改法已生效。
4. **【v3】内存与流式取舍**：方案 C 需整文件读入内存做 base64，与现有 `openAsBlob` 流式读取不同。需在适配器内注释说明该取舍，并在 §1.6 的下调上限保护下确认内存占用可接受。
5. **【v3 保留 v2 精神】填充指标字段**：填充 `Transcript.characterCount`（按码点计数）；`durationSeconds` 若上游未返回（方案 C 响应无时长字段）则保持 `undefined`，由既有 `DurationProbe` 的时长覆盖，不得伪造（C5 指标）。
6. **不产出时间戳**（§1.2）：方案 C 下**不改** `Transcript` 结构、**不改**产物落盘格式。若阶段 0 第 4 项发现免费时间戳，再单独评估，不在本阶段预设。
7. 空 transcript 是否视为合法结果或上游失败，要以现有业务约定及实测结果确定，并增加测试。
8. 将单次调用纳入既有超时配置（`QWEN_ASR_TIMEOUT_MS`）；失败时释放资源。
9. 将上游错误映射为内部安全错误类别；日志只记 `jobId`、model、耗时、重试次数、错误类别，不记音频内容、文本、API Key 或完整 URL query。
10. 复用既有 `infrastructure/common/retry.ts` 的重试语义：网络/限流/服务端可恢复错误受控重试；鉴权、格式、参数等不可恢复错误不重试。

**（备选路径，仅当方案 C 失败时启用）** 方案 B 需按 filetrans 提交并轮询、映射 `sentence` 时间戳；方案 A 需实现完整 WebSocket 会话、事件聚合、`session.finish` 顺序与 socket 清理（见参考资料 [2][3]）。两条备选路径的工作量见 §6。

### 阶段 3：依赖注入与切换（0.5 人日）

**v2 修订：无渐进切换，直接替换。** v1 的「先灰度、保留 Whisper 回滚」策略前提已失效（§1.3）。

- 在 **`src/bootstrap/container.ts`** 的组合根（`buildContainer()`，`container.ts:70` 处）把 `OpenAITranscriber` 替换为 Qwen 适配器。v1 误写为 `server.ts`。
- **删除 `OpenAITranscriber`** 及其 import/实例化（§1.3），同步移除 `.env.example` 中 `OPENAI_TRANSCRIBE_MODEL` / `OPENAI_TRANSCRIBE_TIMEOUT_MS`。
- **保留 `transcribeModel` 依赖项**：它改为传 Qwen 模型名，仍写入 Job `result.model` 与 `metrics.jsonl`。
- `ProcessJob` 与 `Transcriber` 契约**不变**（v3：不新增时间戳字段）；Worker 队列、Job API 和前端轮询不变。
- **日志事件命名 v2 调整**：v1 建议改为 provider 中立 `transcriber.completed`。该改名会波及现有测试与 `docs/architecture/architecture.md`，且 C5 已通过 `UsageMetric.transcribeModel` 解决中立性诉求。**v2 决定拆为独立小改**，不在本次迁移中一并做，避免混淆迁移与重构的 diff。
- 更新 mock system / e2e test factory，使其仍能通过 fake transcriber 跑完整链路。
- **同步更新文档引用**：`docs/architecture/architecture.md`（28/61/98/150 行提及 `OpenAITranscriber` / `whisper-1`）、`docs/project-structure.md`（33 行）。注意架构文档实际文件名为 `architecture.md`——v1 写的 `architecture-design.md` **不存在**。

### 阶段 4：自动化测试（v3：方案 C 约 0.5–1 人日；方案 B/A 为 1–1.5 人日）

**v2 明确测试策略：区分「重构复用」与「必须新增」。** 删除 `OpenAITranscriber` 时，其测试不应被简单删掉，而应**重构搬运**为 Qwen 适配器测试；但协议专属行为在 whisper 适配器中无对应物，**无法靠重构得到，必须新增**。

**A. 重构复用**（把 `tests/unit/openai-transcriber.test.ts` 的骨架平移，不新增覆盖点）：

- 正常调用并返回文本。
- 请求选项携带 timeout 且关闭 SDK 内置重试。
- 429/5xx 后重试成功：重试 1 次，日志含 `retryCount`。
- 4xx 参数错误立即抛、不重试。
- 上游失败向上抛错，由错误边界处理（**不伪造结果**）。

**B. 必须新增**（方案 C 专属，无既有对应物）：

- **【v3 核心】base64 Data URL 构造**：MIME → `data:<mediatype>;base64,...` 的映射正确；中文/特殊格式音频编码后仍可解码。
- **【v3 核心】超限分支**：超过 §1.6 上限时抛**明确业务错误**（不是上游报错穿透、不是静默失败、不是截断）；边界值（恰好等于上限）行为正确。
- **【v3】响应解析**：从 `choices[0].message.content` 取文本；非预期响应形状（缺字段、空 choices）的安全失败行为。
- **【v3】指标字段**：`characterCount` 正确（按码点）；`durationSeconds` 在该路径保持 `undefined`，**不得伪造**。
- **错误映射**：401/403、429、5xx、超时 → 安全错误类别；日志不含 key、音频内容、原始路径或上游错误全文。
- **配置测试**：缺失 Qwen key 时启动即失败；`OPENAI_TRANSCRIBE_*` 移除后 `OPENAI_*` 校验不误伤摘要配置。
- `ProcessJob` 成功与失败测试、B7 E2E fake 全部保持通过；HTTP API 与 OpenAPI contract 不需要变化。

> **v3 说明**：v2 曾列出「interim → final 聚合」「WebSocket 资源清理」等协议专属测试——**方案 C 下这些不存在，已删除**。这也是方案 C 测试成本更低的原因（§6）。但上表 B 部分仍不可省：超限分支与 base64 构造是新引入的正确性风险，缺失即等于「未验证就宣称可用」，违反项目 CLAUDE.md「不可假装可用」原则。
>
> （若降级到方案 B/A，v2 原列的分块读取、事件聚合、socket 清理、`session.finish` 顺序等测试需重新补回。）

所有 CI 测试均使用 fake 上游（方案 C 为 fake OpenAI client），不访问 DashScope / 阿里云百炼，也不把生产密钥上传到 CI。

### 阶段 5：真实服务联调与验收（0.5–1 人日）

在开发者本机或安全的受控环境执行，不进入普通 CI：

- 测试环境仅用 `.env`/密钥管理器提供 Qwen Key，禁止写入证据、日志或截图。
- 用许可明确的短音频和长音频验证中文/英文、不同现有格式、识别失败、长耗时、网络断开与服务端重启情况。
- 核对 Job 状态最终仍为 `succeeded` 或安全的 `failed`，成功结果可下载，摘要仍正常生成。
- **【v3 修正】~~验证时间戳~~**：v2 曾列为核心验收项；v3 已放弃时间戳（§1.2），本项改为**确认转录文本完整、无截断**即可。
- **核对指标落盘**：`metrics.jsonl` 中 `transcribeCharacterCount` / `transcribeDurationMs` 非空；`transcribeDurationSeconds` 允许为空（方案 C 无时长字段，由 `DurationProbe` 覆盖）。
- **【v3 新增】核对上限行为**：上传一个超限音频，确认返回**明确的业务错误**（而非上游报错或静默失败）。
- **【v2 修正】对照基线的方式**：v1 写「对照 Whisper 基线」，但 `whisper-1` **已不可用、无法现场复跑**，该对比不可执行。改为对照**归档证据中的历史记录**——`docs/evidence/` 存有 2026-08-24 的 whisper-1 实测（转录 9009ms / 摘要 3276ms，见 `docs/evidence/README.md`），可作历史参照。质量结论只基于同一批有授权的样本，不夸大为通用评测。
- 检查 requestId/jobId 日志关联和错误响应不泄露 Qwen 原始异常。
- 归档脱敏测试结果、模型/地域配置名称（不得包含 key）与运行步骤。

## 4. 预计改动文件

| 区域 | 预计改动 |
| --- | --- |
| 配置 | `src/bootstrap/config.ts`（移除 `OPENAI_TRANSCRIBE_*`、新增 `QWEN_ASR_*`）、`tests/unit/config.test.ts`、`.env.example` |
| 领域模型 | **v3：`src/domain/ports.ts` 不变**（v2 曾要求加 `segments`；时间戳降为机会性目标，见 §1.2）。仅沿用既有 `characterCount` / `durationSeconds` 字段 |
| 上传校验 | **`MAX_UPLOAD_BYTES` / `MAX_AUDIO_DURATION_SECONDS` 调整**（§1.6，方案 C 的 10 MB 约束），涉及 `src/bootstrap/config.ts` 与 `.env.example` |
| 适配器 | 新增 `src/infrastructure/qwen/` 下 `Transcriber` 实现（**方案 C 无协议客户端**）；**删除 `src/infrastructure/openai/transcriber.ts`** |
| 依赖组装 | **`src/bootstrap/container.ts`**（v1 误写为 `server.ts`）、`tests/unit/container.test.ts` |
| 用例 | `src/application/process-job.ts`：仅填充指标字段（v3 不再改动时间戳产物） |
| 通用日志/重试 | 复用既有 `infrastructure/common/retry.ts` 与错误分类；事件改名为独立小改，不在本次一并做（§3） |
| 测试 | 删除 `tests/unit/openai-transcriber.test.ts` 并**重构搬运**为 Qwen adapter 单测；新增协议专属用例（§4 阶段 4 B 部分）；更新配置/DI/system fake |
| 文档 | **`docs/architecture/architecture.md`**（v1 所写 `architecture-design.md` 不存在）、`docs/project-structure.md`、`.env.example`、必要时新增 ADR、本次实施证据 |
| **不应变化** | HTTP 路由、OpenAPI、前端上传/轮询/下载流程、Job 状态机、摘要链路 |

实际文件清单以阶段 0 的协议 spike 和阶段 1 的依赖选择为准；除计划文件外，目前尚未修改实现代码。

## 5. 验收与质量门禁

### 自动门禁

```powershell
npm run lint
npm run typecheck
npm test
npm run test:b7
npx vitest run --coverage
npm run web:verify
npm run check:docs
npm run check:structure
git diff --check
```

- 既有 API contract / OpenAPI 测试仍通过，无 OpenAPI 变更。
- 不降低仓库当前覆盖率门槛；新增 adapter 的关键正常、错误、重试、清理分支均覆盖。
- 更新 CI 仅限新依赖确有需要的安全审计/许可证检查；不得为访问真实模型而增加 CI secret 或联网集成测试。

### 人工验收

- 在 mock/fake 上游上完成上传至摘要的全链路。
- 在受控环境完成真实 Qwen 服务联调，证明最终文本完整、Job 可下载、超时和错误行为安全。
- **【v3】~~时间戳验收~~**：v2 曾列为核心验收项；v3 已放弃（§1.2），改为确认**转录文本完整无截断**。
- **【v3】上限验收**：超限音频返回明确业务错误（§1.6），不是上游报错穿透、也不是静默失败。
- **【v3】指标验收**：`metrics.jsonl` 中转录字数与耗时列非空且合理。
- **【已删除】** v1 的「通过 `TRANSCRIBE_PROVIDER` 回滚到 Whisper」——回滚目标已不存在（§1.3）。
- 文档和证据清楚区分自动化 mock 结果与真实服务联调结果。

## 6. 工作量估算

针对“继续使用现有上传后后台处理，不要求实时字幕”的 Qwen Streaming 适配：

| 阶段 | 方案 C（首选） | 方案 B | 方案 A |
| --- | ---: | ---: | ---: |
| 可行性确认（阶段 0） | 0.5–1 | 0.5–1.5 | 0.5–1.5 |
| 配置、DI、适配器 | 0.5–1 | 1–1.5 | 2–3.5 |
| 自动化测试、文档、全量回归 | 0.5–1 | 1–1.5 | 1.5–2.5 |
| 真实联调与修正 | 0.5 | 0.5–1 | 0.5–1 |
| **合计** | **约 1.5–3 人日** | 约 2–3 人日 | 约 4.5–8.5 人日 |

**v3 说明**：**方案 C 的估算显著低于 v2 原表**，原因是它不新建协议栈、不引入新基建、不改领域模型与产物格式——这正是 §1.0 判据的体现。方案 A 若 WebSocket 协议与当前 Node 运行时集成顺利可能接近 4–6 人日；若需容器格式转换、账号域名/权限排查或复杂的事件聚合/重连，则更接近 7–9 人日。

> 若选方案 C，**放弃时间戳换来的就是这张表的差距**（1.5–3 人日 vs 4.5–8.5 人日）——按 §1.0 这是划算的。

此估算包含测试与文档，**不包含**前端实时字幕，**不包含**摘要模型切换（§1.5 已决定不在本次范围），**不包含**方案 B 所需的 OSS 基建搭建成本。

如后续另做浏览器实时语音输入、服务端双向转发及实时字幕 UI，属于独立功能，需另行估算（预计额外 4–8 人日，具体取决于浏览器采集、断线恢复和交互设计范围）。

## 7. 主要风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 当前上传后识别与模型“实时”产品语义不完全匹配 | 采用流式 API 增加协议成本，用户却看不到实时反馈 | 阶段 0 先比较 filetrans 与 streaming；明确本计划优先满足指定模型要求，不误称实时 UI |
| 编码格式、容器与 MIME 不匹配 | 服务端拒绝或识别错误 | 按上传校验后的 MIME/扩展名建立映射；真实样本验证；有需求再独立评估 FFmpeg 转码 |
| 中间结果是可变文本 | transcript 重复或漏字 | 基于官方事件类型区分 delta/interim/final，并为修订及多段拼接写针对性测试 |
| WebSocket 吞吐/背压/长音频耗时 | worker 被占用、内存或连接耗尽 | 流式读取、限制 chunk、统一超时、并发控制、socket/流可靠关闭；确认服务限额 |
| 错误格式和重试边界不同于 OpenAI | Job 失败被误判或重复扣费 | 适配器内映射安全错误类别；测试 4xx 与网络/429/5xx；避免 SDK 与自定义重试叠加 |
| Qwen 配置与 OpenAI 配置耦合 | 启动需同时设置两家密钥 | **v2**：不再用 provider 开关，改为配置分域——转录只校验 `QWEN_ASR_*`，摘要只校验 `OPENAI_*`；凭证分域管理，日志禁止输出密钥 |
| **时间戳缺失**（v3 改写） | 与老师原话「带时间戳文本」的表述不一致 | **已由需求方接受**（§1.0）：不为此增加复杂度。缓解：答辩话术相应调整；阶段 0 零成本顺带确认是否有免费时间戳；若日后需要，方案 B/A 路径已在本计划中留档 |
| **base64 上限导致大文件失败**（v3 新增） | 用户上传音频超 7.5 MB 时转录失败；若处理不当会出现上游报错穿透或静默失败 | 按 §1.6 下调/分层校验上限，返回**明确业务错误**；阶段 0 实测真实边界；写入 OpenAPI 与 `.env.example`。**不得静默截断或伪造成功** |
| **整文件进内存**（v3 新增） | 方案 C 需 base64 编码，内存峰值升高，与现有流式读取不同 | §1.6 的上限下调即是保护；适配器内注释说明取舍；联调时观察内存 |
| **选型误判**（v2 新增） | 高估/低估某方案的代价，多花数人日 | 判据已显式化（§1.0 三级优先级）+ 阶段 0 先跑通方案 C 再决定是否降级；工作量对照表见 §6 |
| 无法稳定复现上游协议 | CI flaky、排障困难 | 协议 fake 驱动单测；真实联调独立手动运行并保存脱敏证据 |

## 8. 实施前需要确认的事项

进入实现前明确（**v3 已把 v2 的第 1、2 项由官方文档直接确认，不再需要讨论**）：

1. **【v2 已澄清】** ~~filetrans 能否不用公网 URL~~ → **不能，官方明确要求**（§1.1）。
2. **【v2 已澄清】** ~~时间戳粒度~~ → **v3 已决定放弃时间戳**（§1.0、§1.2），不再决策粒度。
3. **【已决策 · 无需再议】** 单 provider，直接替换并删除 `OpenAITranscriber`；不做双 provider 灰度（§1.3）。
4. **【已决策 · 无需再议】** 摘要模型保持 `gpt-4o`，本次不换千问（§1.5）。
5. **【v3 · 待你确认】** **上传上限下调方案**（§1.6）：是把 `MAX_UPLOAD_BYTES` 直接降至 ≤7.5 MB，还是保留 25 MB 上传但转录前分层校验？这会影响 `.env.example`、OpenAPI 描述与前端提示。**建议前者**（口径统一、错误更早暴露）。
6. **【v3 · 待实测】** 所用平台的**实际模型 ID**（`qwen-audio-3.1-asr-flash-*` 还是 `qwen3-asr-flash*`）与 base64 的真实上限——两站命名不同，以账号可见值为准。
7. 当前账号的可用地域、Workspace ID、Key 权限和测试额度是否已准备好。
8. 是否允许为了格式兼容引入 FFmpeg 或其他外部进程；默认先不引入。
9. 确认只验收「上传后最终转录」，**不要求浏览器端实时文字**（v3：也不再要求时间戳）。

## 9. 官方参考资料

> 下列链接为 2026-09-24 评审时的官方来源，各条依据已在正文对应小节标注编号。

1. [阿里云百炼：语音识别概述（模型选型与迁移对照表）](https://help.aliyun.com/zh/model-studio/asr-model) — **§1.1 选型的核心依据**：闭源模型迁移对照表（非实时/文件转写 ← Whisper、gpt-4o-transcribe → `qwen-audio-3.1-asr-flash-filetrans`）；各模型 ID、实时/非实时、时长上限、说话人分离、语种支持。
2. [阿里云百炼：Qwen-ASR-Realtime WebSocket 接入指南](https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-interaction-process) — WebSocket URL 形态（`wss://{WorkspaceId}.<region>.maas.aliyuncs.com/api-ws/v1/realtime?model=<model>`）、请求头鉴权、VAD 与 Manual 两种模式；**「推完音频必须先发 `session.finish` 再关连接」的官方警告**（§阶段 2 第 3 项依据）。
3. [阿里云百炼：Qwen-ASR-Realtime 服务端事件](https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-server-events) — `session.created` / `input_audio_buffer.speech_started`（`audio_start_ms`）/ `speech_stopped`（`audio_end_ms`）/ `conversation.item.input_audio_transcription.text`（中间结果）/ `.completed`（最终结果）；**§1.2 时间戳依据**。
4. [阿里云百炼：非实时语音识别用户指南](https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide) — filetrans 的 `sentence` 结构（`sentence_id` / `begin_time` / `end_time`，毫秒）、`timestamp_granularities` 句级/词级切换、**DashScope 异步调用时间戳永久启用**；**§1.2 时间戳依据**。
5. [阿里云百炼：语音识别 API 参考](https://help.aliyun.com/zh/model-studio/speech-recognition-api-reference/) — 实时 Streaming 与非实时 Filetrans 的 API 分类与接入方式。
6. [阿里云百炼：实时语音识别用户指南](https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide) — 模型介绍与完整示例代码。
7. [Qwen-ASR — DashScope 异步（filetrans）API 参考](https://docs.qwencloud.com/api-reference/speech-recognition/qwen-asr/dashscope-async) — **§1.1 依据**：`input.file_url` 官方描述 "Must be accessible over the Internet"，"Audio formats" 一节 "Audio file URLs must be publicly accessible"；另有 `enable_words` 控制句级/词级时间戳。
8. [Qwen-ASR — OpenAI 兼容（chat completions）API 参考](https://docs.qwencloud.com/api-reference/speech-recognition/qwen-asr/openai) — **§1.1 方案 C 依据**：支持 Base64-encoded audio 或公网 URL；"Keep the encoded audio within the 10 MB limit"；`asr_options` 仅 `language` / `enable_itn`，**无时间戳参数**；响应的 `usage` 含 token 明细可供 C5 指标。
9. [Qwen-ASR — DashScope 同步 API 参考](https://docs.qwencloud.com/api-reference/speech-recognition/qwen-asr/dashscope) — **§1.1 补充依据**：`audio` 字段支持 URL / Base64 / 本地路径（**SDK only**）；响应仅 `content[].text` 与 `annotations`（language、emotion），**无时间字段**。

> 官方文档和模型服务可能更新。阶段 0 必须以实际账号可见的当前模型 ID、地域端点、事件协议及限制为准；本计划中的估算不代表服务商 SLA 或费用承诺。