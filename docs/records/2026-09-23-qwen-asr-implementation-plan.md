# Qwen-ASR 接入实施计划

> 日期：2026-09-23  
> 修订：**v2 / 2026-09-24**（依据阿里云百炼官方文档评审后修订，逐条依据见 §1.1 与文末参考资料）  
> 状态：**待定选型**（streaming / filetrans 二选一，见 §1.1）/ 尚未实施  
> 目标模型：`qwen-audio-3.1-asr-flash-streaming`（streaming 方案）或 `qwen-audio-3.1-asr-flash-filetrans`（filetrans 方案）  
> 计划分支：`feature/qwen-asr-migration`

## 1. 目标与决策

将当前转录实现从 OpenAI Whisper (`whisper-1`) 切换为 Qwen-ASR，同时保留项目既有的异步任务体验：用户上传完整音频，服务端后台识别，用户通过现有 Job API 查询最终转录与摘要。

**v2 修订要点**（4 项，依据见各小节）：

| # | 修订 | 依据 |
| --- | --- | --- |
| 1 | **时间戳纳入本次范围**（v1 锁定 `Transcript` 不变 → 答辩核心需求缺交付） | §1.2 |
| 2 | 模型版本 `3.0` → `3.1` | §1.1 |
| 3 | **取消双 provider 回滚设计**，改单 provider 并删除 `OpenAITranscriber` | §1.3 |
| 4 | 选型改为 **streaming / filetrans 二选一待定**，不再默认 streaming | §1.1 |

本计划**不做前端实时字幕**。若最终选方案 A（streaming），当前应用仍是在上传完成后才开始处理：服务端将已落盘音频分块送入 WebSocket 会话，收集并合并最终识别结果后返回 `Transcript`。这不是「用户说话时实时看到字幕」的产品能力。所选模型与协议以阶段 0 的选型结论为准（§1.1）。

### 1.1 模型选型：streaming 与 filetrans 待定（v2 修订）

Qwen-ASR 不是当前 `client.audio.transcriptions.create({ file, model })` 的直接模型名替换。官方提供三种接入形态，本项目的合理候选是前两种：

| 方案 | 模型 ID | API | 时长上限 | 时间戳 | 说话人分离 | 本地文件 | 协议成本 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A. 实时流式** | `qwen-audio-3.1-asr-flash-streaming` | WebSocket | 无限制 | 见 §1.2 | ✗ | 可分块发送 | **高** |
| **B. 文件转写** | `qwen-audio-3.1-asr-flash-filetrans` | HTTP 异步 | 12 小时 / 2GB | ✅ 句级 + 词级 | ✅ | **疑需公网 URL** | 中 |
| C. 同步识别 | `qwen-audio-3.1-asr-flash` | HTTP 同步 | ≤ 5 分钟 | 待核实 | ✗ | 支持 | 低 |

**依据（官方迁移对照表）**：阿里云百炼《语音识别概述》给出闭源模型迁移建议，其中「非实时 / 文件转写」场景明确列出闭源代表为 **OpenAI gpt-4o-transcribe、Whisper**，推荐百炼模型为 `qwen-audio-3.1-asr-flash-filetrans`、`qwen-audio-3.1-asr-flash`；「实时识别」才推荐 streaming。本项目的业务场景是「播客 / 访谈录音转写」，与该表「非实时」的定位描述一致。见参考资料 [1]。

**但 streaming 仍可能是正确选择**：filetrans 走异步提交，据官方文档**需要可访问的音频 URL**，而本项目是本地单机部署、音频落在本地 `temp/`，没有公网地址。**这正是 v1 选择 streaming 的实质理由，v1 未写明。** 该约束必须由阶段 0 实测确认：

- 若 filetrans 确实要求公网 URL → **方案 A 成立**，并把该理由写入本计划；
- 若 filetrans 可接受其他提交方式 → **方案 B 更优**：省掉整个 WebSocket 协议栈，且额外获得说话人分离（对播客场景是加分项）。

**版本号**：v1 使用的 `qwen-audio-3.0-asr-flash-streaming` 仍是有效模型，但官方当前推荐为 `3.1`（支持更多语种与方言）。除明确需要复现 v1 结果外，一律用 `3.1`。见参考资料 [1]。

### 1.2 时间戳必须纳入本次范围（v2 修订）

中期答辩的核心功能是**「音频转录为带时间戳文本」**。v1 计划 §1 要求「保持 `Transcriber.transcribe` 端口不变」、§2 要求「`ports.ts` 不因本次改造改变」、§4 再列「不应变化」——即锁定现有 `Transcript = { text }` **纯文本**。**按 v1 实施完毕后，答辩核心需求仍然缺失。**

Qwen 三种形态均具备时间戳能力，本可一次交付：

- **filetrans**：返回 `sentence` 对象数组，含 `sentence_id` / `begin_time` / `end_time`（毫秒）。DashScope 异步调用**时间戳永久启用**，并支持按 `timestamp_granularities` 选择句级或词级。见参考资料 [4]。
- **streaming**：VAD 模式下发送 `input_audio_buffer.speech_started`（含 `audio_start_ms`）与 `input_audio_buffer.speech_stopped`（含 `audio_end_ms`），可据此切分语句边界。见参考资料 [3]。

**因此本次改造需同步扩展领域模型**（例如 `Transcript` 增加 `segments: { beginMs, endMs, text }[]`），并据此调整产物落盘格式与查询/下载接口。该扩展应写入 §5 验收标准——否则 A6 会拆成两次改造，第二次仍需再动端口与存储格式。

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

- 以 Qwen-ASR 替换现有 Whisper 转录适配器（删旧适配器，单 provider）。
- **转录结果携带时间戳**（§1.2），据此扩展 `Transcript` 领域模型。
- 保持 Job 状态机、HTTP API、OpenAPI 与 Web 前端行为不变。
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

## 2. 当前架构与改造边界

当前链路：

```text
HTTP 上传
  → 本地文件与 queued Job
  → Worker / ProcessJob
  → QwenAsrTranscriber（新建）
  → DashScope Qwen-ASR（streaming 或 filetrans）
  → Transcript（含时间戳 segments）
  → 保存 transcript.txt
  → Summarizer
```

现有 `Transcriber` 端口已隔离上游实现，主要接入位置如下（**v2 已按实际代码校正路径**）：

- `src/domain/ports.ts`：`Transcriber` 接口；**本次需扩展 `Transcript` 以携带时间戳**（§1.2，v1 曾误述为「不改变」）。同文件还有 `UsageMetric` / `MetricsRecorder`（见下方指标一节）。
- `src/infrastructure/openai/transcriber.ts`：现有 Whisper 适配器，**v2 决定删除**（§1.3），仅作迁移参考。
- `src/bootstrap/container.ts`：**真正的依赖组装处**——`buildContainer()` 在此 `new OpenAITranscriber(...)`（`container.ts:70`）。v1 误写为 `server.ts`；`server.ts` 只在 `server.ts:23` 调用 `buildContainer(config)`。
- `src/bootstrap/config.ts` 与 `.env.example`：上游凭证、模型、超时等配置。
- `src/application/process-job.ts`：依赖端口执行转录；**需把新适配器产出的时间戳与用量指标接入**（v1 未覆盖，见下）。
- `tests/unit/openai-transcriber.test.ts`（删除）、`tests/unit/process-job.test.ts`、`tests/e2e/core-flow.test.ts`：适配器、用例与端到端 fake 覆盖。

**v2 新增：与已落地的指标采集（C5）对接。** 2026-09-24 已合入 `main`（`9b5b9e5`）的可观测指标能力，v1 计划成文于其前、未覆盖：

- `Transcript` 现含 `characterCount`（转录字数，码点）与 `durationSeconds`（音频时长）两个可选字段。**新适配器须填充二者**；streaming 方案的 VAD 事件（`audio_start_ms` / `audio_end_ms`）或 filetrans 的句级时间戳均可推导出 `durationSeconds`，否则 `metrics.jsonl` 该列恒为空。
- `ProcessJob` 会把 `transcribeModel`、`transcribeCharacterCount`、`transcribeDurationSeconds`、`transcribeDurationMs` 写入指标落盘。

预期新建 Qwen 专用 infrastructure adapter 和协议/客户端封装。**v2 已定：单 provider，不引入 `TRANSCRIBE_PROVIDER` 开关**（§1.3），但 DashScope 配置仍须独立于 `OPENAI_*` 命名空间，**不得把 DashScope 端点错塞进 `OPENAI_BASE_URL`**。

## 3. 实施阶段

### 阶段 0：API 可行性 Spike（0.5–1.5 人日）

先实现最小隔离原型，不直接改主流程。**v2 调整：把「选型决策」提为第 1 项**——它决定后续工作量是 4.5–8.5 人日还是 2–3 人日（§6），必须最先回答。

1. **【v2 前置】判定 filetrans 是否可行**：`qwen-audio-3.1-asr-flash-filetrans` 走 HTTP 异步提交，需确认它是否要求**公网可访问的音频 URL**（据官方文档，同类异步文件转写模型有此要求）。本项目音频存于本地 `temp/`、单机部署无公网地址：
   - **要求公网 URL** → 采用方案 A（streaming），把此约束写入本计划作为选型依据；
   - **可接受其他提交方式**（如直传文件、oss:// 路径）→ 采用方案 B（filetrans），可省掉整个 WebSocket 协议栈，且额外获得说话人分离。
   同时确认 `qwen-audio-3.1-asr-flash-filetrans` 与同步型 `qwen-audio-3.1-asr-flash`（≤5 分钟）是否覆盖本项目音频时长（当前上限 3600 秒）。
2. 核对阿里云百炼当前账号可用地域、Workspace ID、API Key、模型权限和计费额度。
3. **若选方案 A**：使用官方支持的 WebSocket URL、`model=qwen-audio-3.1-asr-flash-streaming` 和 Authorization 握手，验证会话初始化、音频追加、结束事件和最终结果事件。注意 URL 形态为 `wss://{WorkspaceId}.<region>.maas.aliyuncs.com/api-ws/v1/realtime?model=<model_name>`，模型名走查询参数、鉴权走请求头（见参考资料 [2]）。
4. 用项目 `fixtures/audio-sample.mp3` 及至少一个项目允许上传的其它音频格式，验证分块/提交、格式标注与服务端响应。若选方案 A，官方支持 `pcm`、`wav`、`mp3`、`opus`、`speex`、`aac`、`amr` 音频流。
5. **确认时间戳的可得性与粒度**（§1.2 的核心验收依据）：方案 A 验证 VAD 事件 `input_audio_buffer.speech_started.audio_start_ms` / `speech_stopped.audio_end_ms` 能否切出语句边界；方案 B 验证 `sentence` 数组的 `begin_time` / `end_time`（毫秒）及 `timestamp_granularities` 的句级/词级切换。**该结果决定 `Transcript.segments` 的字段设计。**
6. 确认适配器可从本地文件流式读取而非一次性把整文件读入内存；验证背压、结束事件、超时和断连行为。
7. 明确识别结果事件是增量文本还是最终片段；制定不重复拼接中间修订文本的聚合规则。
8. 验证较短音频和长音频的吞吐、总耗时、连接上限、最大分块大小与关闭顺序。
9. 记录调用成功/失败、账户配额/价格信息及采用的服务端接入域名；不将真实音频或凭证提交到仓库。

**Spike 通过条件：**选型已定且有依据；官方协议可稳定完成至少一次真实识别；支持现有音频样本格式；**时间戳可稳定获得**；最终 transcript 可无重复、无漏段地拼合；能确定可靠的超时/取消/关闭语义。若均失败，暂停主实现，评估引入受控转码或降低音频时长上限以适配同步接口。

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

### 阶段 2：Qwen 转录适配器（1.5–2.5 人日，方案 B 可降至 1–1.5 人日）

新增 `src/infrastructure/qwen/` 下的协议客户端与 `Transcriber` 实现，继续实现现有 `Transcriber` 接口：

1. **（方案 A）** 用只读流按协议允许的大小读取文件，建立 WebSocket 会话并按协议发送会话配置与音频数据。**（方案 B）** 按 filetrans 要求提交音频并轮询/等待结果。
2. 按模型文档标注音频格式；不得仅依赖用户文件名，使用已校验的 MIME/存储扩展名信息。
3. 处理协议事件：ready/会话建立、增量识别、稳定/最终片段、完成、上游错误、close/error、心跳或 idle timeout。**方案 A 注意**：VAD 模式下必须**先发送 `session.finish` 再关闭连接**，否则服务端丢弃 in_progress item、`conversation.item.input_audio_transcription.completed` 不会到达（官方警告，见参考资料 [3]）。
4. 根据 Spike 的事件语义聚合 transcript：若服务端发送「整句修订」，以最终句子替换中间结果；若发送独立最终片段，按顺序拼接。禁止简单拼接所有 interim 文本造成重复。
5. 发送完文件后显式结束音频/会话，等待明确的最终完成事件后再 resolve；**不得把 socket close 当作成功结果**。
6. **【v2 新增】产出时间戳**：按 Spike 确认的形态构造 `Transcript.segments`（`{ beginMs, endMs, text }[]`）。方案 B 直接映射 `sentence.begin_time` / `sentence.end_time`；方案 A 用 VAD 事件的 `audio_start_ms` / `audio_end_ms` 切分。同时保持 `text` 字段为纯文本（兼容现有下载接口）。
7. **【v2 新增】填充指标字段**：填充 `Transcript.characterCount`（按码点计数）与 `Transcript.durationSeconds`（由句级时间戳末值或 VAD 结束时间推导），供 `metrics.jsonl` 落盘（C5）。
8. 空 transcript 是否视为合法结果或上游失败，要以现有业务约定及真实协议验证后确定，并增加测试。
9. 将连接、提交、等待结果整体纳入单次转录超时；在超时、任务失败和进程关闭时关闭 socket/连接、停止文件流并释放监听器。
10. 将协议错误映射为内部安全错误类别；日志只记 `jobId`、model、耗时、重试次数、错误类别，不记音频内容、文本、API Key 或完整 URL query。
11. 对网络/限流/服务端可恢复错误使用受控重试；鉴权、格式、参数等不可恢复错误不重试。确认重试前会话和资源完全关闭，且一次任务重试不会遗留后台 socket。

### 阶段 3：依赖注入与切换（0.5 人日）

**v2 修订：无渐进切换，直接替换。** v1 的「先灰度、保留 Whisper 回滚」策略前提已失效（§1.3）。

- 在 **`src/bootstrap/container.ts`** 的组合根（`buildContainer()`，`container.ts:70` 处）把 `OpenAITranscriber` 替换为 Qwen 适配器。v1 误写为 `server.ts`。
- **删除 `OpenAITranscriber`** 及其 import/实例化（§1.3），同步移除 `.env.example` 中 `OPENAI_TRANSCRIBE_MODEL` / `OPENAI_TRANSCRIBE_TIMEOUT_MS`。
- **保留 `transcribeModel` 依赖项**：它改为传 Qwen 模型名，仍写入 Job `result.model` 与 `metrics.jsonl`。
- `ProcessJob` 与 `Transcriber` 契约除新增时间戳字段外不变；Worker 队列、Job API 和前端轮询不变。
- **日志事件命名 v2 调整**：v1 建议改为 provider 中立 `transcriber.completed`。该改名会波及现有测试与 `docs/architecture/architecture.md`，且 C5 已通过 `UsageMetric.transcribeModel` 解决中立性诉求。**v2 决定拆为独立小改**，不在本次迁移中一并做，避免混淆迁移与重构的 diff。
- 更新 mock system / e2e test factory，使其仍能通过 fake transcriber 跑完整链路。
- **同步更新文档引用**：`docs/architecture/architecture.md`（28/61/98/150 行提及 `OpenAITranscriber` / `whisper-1`）、`docs/project-structure.md`（33 行）。注意架构文档实际文件名为 `architecture.md`——v1 写的 `architecture-design.md` **不存在**。

### 阶段 4：自动化测试（1–1.5 人日）

**v2 明确测试策略：区分「重构复用」与「必须新增」。** 删除 `OpenAITranscriber` 时，其测试不应被简单删掉，而应**重构搬运**为 Qwen 适配器测试；但协议专属行为在 whisper 适配器中无对应物，**无法靠重构得到，必须新增**。

**A. 重构复用**（把 `tests/unit/openai-transcriber.test.ts` 的骨架平移，不新增覆盖点）：

- 正常调用并返回文本。
- 请求选项携带 timeout 且关闭 SDK 内置重试。
- 429/5xx 后重试成功：重试 1 次，日志含 `retryCount`。
- 4xx 参数错误立即抛、不重试。
- 上游失败向上抛错，由错误边界处理（**不伪造结果**）。

**B. 必须新增**（协议专属 / v2 新增字段，无既有对应物）：

- **interim → final 聚合不重复**：interim 内容被最终修订替换；多段最终文本按序合并。（本计划自列的头号正确性风险，无对应物可复用）
- **音频按流分块读取**，未整文件 Buffer 化；异常/空文件路径的安全行为。
- **资源清理**：连接/识别超时、背压、文件流错误、任务取消/进程关闭时连接与流正确清理，无遗留后台 socket。
- **协议错误映射**：握手失败、401/403、429、5xx、连接突然关闭、协议 error 事件 → 安全错误类别；日志不含 key、音频文本、原始路径、上游错误全文或 URL query 中的凭证。
- **【v2】时间戳产出**：`segments` 的边界正确（句级）、`text` 仍为纯文本；空/无语音片段的边界行为。
- **【v2】指标字段**：`characterCount` 与 `durationSeconds` 被正确填充（含缺省时的 undefined 行为），保证 `metrics.jsonl` 该列不为空。
- **配置测试**：缺失 Qwen key 时启动即失败；`OPENAI_TRANSCRIBE_*` 移除后 `OPENAI_*` 校验不误伤摘要配置。
- `ProcessJob` 成功与失败测试、B7 E2E fake 全部保持通过；HTTP API 与 OpenAPI contract 不需要变化。

> 配比参考：**复用约 5 项 + 新增约 7 项**。只做重构复用的是不够的——新协议实现若没有上表 B 部分，等于「未验证就宣称可用」，违反项目 CLAUDE.md「不可假装可用」原则，且覆盖率门禁（≥80%）也不会因此放宽。

所有 CI 测试均使用 fake 协议客户端，不访问 DashScope / 阿里云百炼，也不把生产密钥或音频 fixture 上传到 CI。

### 阶段 5：真实服务联调与验收（0.5–1 人日）

在开发者本机或安全的受控环境执行，不进入普通 CI：

- 测试环境仅用 `.env`/密钥管理器提供 Qwen Key，禁止写入证据、日志或截图。
- 用许可明确的短音频和长音频验证中文/英文、不同现有格式、识别失败、长耗时、网络断开与服务端重启情况。
- 核对 Job 状态最终仍为 `succeeded` 或安全的 `failed`，成功结果可下载，摘要仍正常生成。
- **【v2 修正】验证时间戳**：下载的转录文本携带句级时间戳且单调递增、覆盖完整音频、无重叠错乱；这是本次改造的核心验收项（§1.2）。
- **核对指标落盘**：`metrics.jsonl` 中 `transcribeCharacterCount` / `transcribeDurationSeconds` / `transcribeDurationMs` 均非空且数值合理。
- **【v2 修正】对照基线的方式**：v1 写「对照 Whisper 基线」，但 `whisper-1` **已不可用、无法现场复跑**，该对比不可执行。改为对照**归档证据中的历史记录**——`docs/evidence/` 存有 2026-08-24 的 whisper-1 实测（转录 9009ms / 摘要 3276ms，见 `docs/evidence/README.md`），可作历史参照。质量结论只基于同一批有授权的样本，不夸大为通用评测。
- 检查 requestId/jobId 日志关联和错误响应不泄露 Qwen 原始异常。
- 归档脱敏测试结果、模型/地域配置名称（不得包含 key）与运行步骤。

## 4. 预计改动文件

| 区域 | 预计改动 |
| --- | --- |
| 配置 | `src/bootstrap/config.ts`（移除 `OPENAI_TRANSCRIBE_*`、新增 `QWEN_ASR_*`）、`tests/unit/config.test.ts`、`.env.example` |
| 领域模型 | **`src/domain/ports.ts`**：`Transcript` 增加时间戳 `segments`（v1 曾列为「不应变化」，见 §1.2） |
| 适配器 | 新增 `src/infrastructure/qwen/` 下协议客户端与 `Transcriber` 实现；**删除 `src/infrastructure/openai/transcriber.ts`** |
| 依赖组装 | **`src/bootstrap/container.ts`**（v1 误写为 `server.ts`）、`tests/unit/container.test.ts` |
| 用例 | `src/application/process-job.ts`：接入时间戳产物与新增指标字段（§2 指标一节） |
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

- 在 mock/fake 协议客户端上完成上传至摘要的全链路。
- 在受控环境完成真实 Qwen 服务联调，证明最终文本完整、**时间戳正确**、Job 可下载、超时和错误行为安全。
- **【v2】时间戳验收**：下载的转录文本含句级时间戳，覆盖完整音频、单调递增、无重叠（§1.2 为本次核心验收项）。
- **【v2】指标验收**：`metrics.jsonl` 中转录字数/时长列非空且合理。
- **【v2 修正】删除** v1 的「通过 `TRANSCRIBE_PROVIDER` 回滚到 Whisper」一项——回滚目标已不存在（§1.3）。
- 文档和证据清楚区分自动化 mock 结果与真实服务联调结果。

## 6. 工作量估算

针对“继续使用现有上传后后台处理，不要求实时字幕”的 Qwen Streaming 适配：

| 阶段 | 估算 |
| --- | ---: |
| 协议/账号 Spike（含选型决策） | 0.5–1.5 人日 |
| 配置、DI、适配器和重试清理 | 2–3.5 人日 |
| 自动化测试、文档和全量回归 | 1.5–2.5 人日 |
| 真实联调与修正 | 0.5–1 人日 |
| **合计（方案 A / streaming）** | **约 4.5–8.5 人日** |
| **合计（方案 B / filetrans）** | **约 2–3 人日** |

**v2 说明**：上表方案 A 若 WebSocket 协议与当前 Node 运行时集成顺利、音频可直接分块发送，可能接近 4–6 人日；若需容器格式转换、账号域名/权限排查或复杂的事件聚合/重连，则更接近 7–9 人日。**方案 B（HTTP）省去整个 WebSocket 协议栈，故显著更低**——这正是阶段 0 第 1 项要先做选型判定的原因。此估算包含测试与文档，**不包含**前端实时字幕，**也不包含**摘要模型切换（§1.5 已决定不在本次范围）。

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
| **时间戳缺失或错位**（v2 新增） | 答辩核心需求「带时间戳文本」不达标 | 阶段 0 先确认时间戳可得性与粒度；`Transcript.segments` 明确验收标准（单调递增、覆盖完整、无重叠）；阶段 4 与阶段 5 各有针对性验证 |
| **选型误判**（v2 新增） | 选了 streaming 却发现 filetrans 可行，白做协议栈（或多花 2–5 人日） | 阶段 0 第 1 项先行判定 filetrans 是否需公网 URL；该结论直接决定 §6 工作量 |
| 无法稳定复现上游协议 | CI flaky、排障困难 | 协议 fake 驱动单测；真实联调独立手动运行并保存脱敏证据 |

## 8. 实施前需要确认的事项

进入实现前明确（**v2 已把 v1 的第 1、2 项转化为阶段 0 的实测任务或已定决策**）：

1. **【v2 重写 · 最高优先】** `qwen-audio-3.1-asr-flash-filetrans` 能否在不暴露公网 URL 的前提下使用？**答案决定选型**（§1.1），进而决定工作量是 4.5–8.5 还是 2–3 人日。v1 把该项框成「是否必须用确切模型」，未触及真正的技术约束。
2. **【v2 重写】** 时间戳以何种粒度交付（句级 / 词级 / 两者）？决定 `Transcript.segments` 的字段设计（§1.2）。
3. **【v2 已决策 · 无需再议】** 单 provider，直接替换并删除 `OpenAITranscriber`；不做双 provider 灰度（§1.3）。
4. **【v2 已决策 · 无需再议】** 摘要模型保持 `gpt-4o`，本次不换千问（§1.5）。
5. 阿里云百炼当前账号的可用地域、Workspace ID、Key 权限和测试额度是否已准备好。
6. 是否允许为了格式兼容引入 FFmpeg 或其他外部进程；默认先不引入。
7. 确认只验收「上传后最终转录（含时间戳）」，**不要求浏览器端实时文字**。

## 9. 官方参考资料

> 下列链接为 2026-09-24 评审时的官方来源，各条依据已在正文对应小节标注编号。

1. [阿里云百炼：语音识别概述（模型选型与迁移对照表）](https://help.aliyun.com/zh/model-studio/asr-model) — **§1.1 选型的核心依据**：闭源模型迁移对照表（非实时/文件转写 ← Whisper、gpt-4o-transcribe → `qwen-audio-3.1-asr-flash-filetrans`）；各模型 ID、实时/非实时、时长上限、说话人分离、语种支持。
2. [阿里云百炼：Qwen-ASR-Realtime WebSocket 接入指南](https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-interaction-process) — WebSocket URL 形态（`wss://{WorkspaceId}.<region>.maas.aliyuncs.com/api-ws/v1/realtime?model=<model>`）、请求头鉴权、VAD 与 Manual 两种模式；**「推完音频必须先发 `session.finish` 再关连接」的官方警告**（§阶段 2 第 3 项依据）。
3. [阿里云百炼：Qwen-ASR-Realtime 服务端事件](https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-server-events) — `session.created` / `input_audio_buffer.speech_started`（`audio_start_ms`）/ `speech_stopped`（`audio_end_ms`）/ `conversation.item.input_audio_transcription.text`（中间结果）/ `.completed`（最终结果）；**§1.2 时间戳依据**。
4. [阿里云百炼：非实时语音识别用户指南](https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide) — filetrans 的 `sentence` 结构（`sentence_id` / `begin_time` / `end_time`，毫秒）、`timestamp_granularities` 句级/词级切换、**DashScope 异步调用时间戳永久启用**；**§1.2 时间戳依据**。
5. [阿里云百炼：语音识别 API 参考](https://help.aliyun.com/zh/model-studio/speech-recognition-api-reference/) — 实时 Streaming 与非实时 Filetrans 的 API 分类与接入方式。
6. [阿里云百炼：实时语音识别用户指南](https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide) — 模型介绍与完整示例代码。

> 官方文档和模型服务可能更新。阶段 0 必须以实际账号可见的当前模型 ID、地域端点、事件协议及限制为准；本计划中的估算不代表服务商 SLA 或费用承诺。