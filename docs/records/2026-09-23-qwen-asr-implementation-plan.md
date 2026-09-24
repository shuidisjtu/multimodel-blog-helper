# Qwen-ASR 接入实施计划

> 日期：2026-09-23（2026-09-24 定稿）  
> 状态：待实施（先做阶段 0 可行性确认）  
> 目标模型：Qwen HTTP 同步识别接口（`qwen3-asr-flash` 类，最终 ID 以阶段 0 实测为准）  
> 计划分支：`feature/qwen-asr-migration`

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

- 不向浏览器开放 Qwen API Key，不由浏览器直连模型服务。
- 不新增实时字幕或实时进度协议。
- 不改摘要模型（保持 `gpt-4o`，见 §2.4）。
- 不改天气服务、上传 DTO、文件保留策略或 OpenAPI。
- 不把音频全文、密钥、上游原始错误或本地文件路径写入日志。
- 不默认加入第三方音频转码程序（如 FFmpeg）。

## 2. 选型

### 2.1 三种接入形态

Qwen-ASR 不是当前 `client.audio.transcriptions.create({ file, model })` 的直接模型名替换。官方提供三种接入形态：

| 方案 | 接口形态 | 时长上限 | 时间戳 | 说话人分离 | 本地文件 | 新增依赖 | 工程量 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **C. HTTP 同步 + base64**<br>`qwen3-asr-flash` 类 | OpenAI 兼容 `/compatible-mode/v1/chat/completions` | 约 ≤5 分钟（待实测） | ❌ | ❌ | ✅ base64 内联 | **无**（沿用 openai SDK） | **~1.5–3 人日** |
| B. HTTP 异步（filetrans）<br>`qwen-audio-3.1-asr-flash-filetrans` | DashScope 异步 + 轮询 | 12 小时 / 2GB | ✅ 句级 + 词级 | ✅ | ❌ **需公网 URL** | 音频公网托管（OSS/隧道） | ~2–3 人日 + 基建 |
| A. WebSocket 实时流式<br>`qwen-audio-3.1-asr-flash-streaming` | WebSocket 双向协议 | 无限制 | ✅ VAD 事件 | ❌ | ✅ 分块发送 | 整套 WebSocket 协议栈 | ~4.5–8.5 人日 |

### 2.2 选定方案 C

方案 C 是 §1.2 判据下的最优解：**改动最小、能转录，代价是无时间戳**。它沿用现有 `openai` SDK，仅新增一个适配器、改配置，**不引入新协议、不引入新基建、不改变安全边界**。

被否掉的两条路径，各有硬性代价（均为官方文档确认的事实，非推测）：

- **方案 B 不可用**：filetrans 的 `input.file_url` 官方描述为 "Must be accessible over the Internet"，"Audio formats" 一节亦写明 "Audio file URLs must be publicly accessible."。本项目音频存于本地 `temp/`、单机部署无公网地址，要用它就必须引入音频公网托管。见参考资料 [7]。
- **方案 A 代价过高**：需要实现完整的 WebSocket 会话、事件聚合与清理语义，工作量是方案 C 的 3 倍左右（§7）。

### 2.3 时间戳的处理

**结论：本次不交付时间戳。** 执行口径：

- **不做**：不扩展 `Transcript`、不改产物落盘格式、不改查询/下载接口。
- **连带查**：阶段 0 顺带确认所选模型是否**恰好**支持时间戳（参数或响应字段）。若恰好支持则直接交付；若需换模型或加协议才支持，则放弃。
- **要记**：答辩口径需按 §1.2 的影响说明相应调整。

各形态的时间戳能力（已核实）：

| 形态 | 时间戳 | 可得方式 |
| --- | --- | --- |
| 方案 C | ❌ **无** | —（其 `asr_options` 仅有 `language` / `enable_itn`，响应体仅含 `content[].text` 与 `annotations`，无任何时间字段。见参考资料 [8][9]） |
| 方案 B | ✅ 句级 + 词级 | `sentence.begin_time` / `end_time`（毫秒）；`enable_words` 或 `timestamp_granularities` 切句级/词级；DashScope 异步**时间戳永久启用**。见参考资料 [4] |
| 方案 A | ✅ | VAD 事件 `input_audio_buffer.speech_started.audio_start_ms` / `speech_stopped.audio_end_ms`。见参考资料 [3] |

> 若日后需要时间戳，方案 B/A 的接入要点已保留在本计划 §4 阶段 2 的备选路径中。

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
| `MAX_AUDIO_DURATION_SECONDS` | 3600（1 小时） | 约 **≤5 分钟**（待实测） | ✅ 会超限 |
| 文件读取方式 | `openAsBlob` **流式**（不整文件进内存） | base64 需**整文件进内存**（∝ 33% 膨胀） | ✅ 内存模型变化 |

官方原文："Keep the encoded audio within the 10 MB limit."（见参考资料 [8]）

**处理方式（择一，建议 1）**：

1. **下调上传上限**：把 `MAX_UPLOAD_BYTES` 调到 ≤7.5 MB、`MAX_AUDIO_DURATION_SECONDS` 调到实测时长上限，并把限制写进 `.env.example` 与 OpenAPI 的 413/422 描述。用户超限时得到**明确业务错误**而非上游失败。
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
  → Qwen HTTP 同步接口（chat completions + base64）
  → Transcript（结构不变，仍为纯文本）
  → 保存 transcript.txt
  → Summarizer（gpt-4o，不变）
```

现有 `Transcriber` 端口已隔离上游实现，主要接入位置如下：

- `src/domain/ports.ts`：`Transcriber` 接口；**不改动**。同文件另有 `UsageMetric` / `MetricsRecorder`（见下方指标一节）。
- `src/infrastructure/openai/transcriber.ts`：现有 Whisper 适配器，**本次删除**（§4 阶段 3）。
- `src/bootstrap/container.ts`：**真正的依赖组装处**——`buildContainer()` 在此 `new OpenAITranscriber(...)`（`container.ts:70`）。
- `src/bootstrap/config.ts` 与 `.env.example`：上游凭证、模型、超时、上传上限等配置。
- `src/application/process-job.ts`：依赖端口执行转录；需确认新适配器产出的用量指标被正确接入。
- `tests/unit/openai-transcriber.test.ts`（删除）、`tests/unit/process-job.test.ts`、`tests/e2e/core-flow.test.ts`：适配器、用例与端到端覆盖。

**与已落地的指标采集（C5）对接**：2026-09-24 已合入 `main`（`9b5b3e5`）的可观测指标能力：

- `Transcript` 现含 `characterCount`（转录字数，码点）与 `durationSeconds`（音频时长）两个可选字段。方案 C 须填充 `characterCount`；`durationSeconds` 因该路径响应无时长字段，保持 `undefined`（**不得伪造**），由既有 `DurationProbe` 的时长覆盖。
- `ProcessJob` 会把 `transcribeModel`、`transcribeCharacterCount`、`transcribeDurationSeconds`、`transcribeDurationMs` 写入指标落盘。

## 4. 实施阶段

### 阶段 0：可行性确认（0.5–1 人日）

1. **核对账号实际模型 ID 与权限**：登录所用平台（阿里云百炼 / QwenCloud），确认可见的模型 ID、地域、Key 权限与计费额度。**两站命名不同**（`qwen-audio-3.1-asr-flash-*` vs `qwen3-asr-flash*`），以账号实际可见值为准。
2. **跑通方案 C 最小调用**：用 OpenAI SDK 对 `/compatible-mode/v1/chat/completions` 发一次请求，音频以 base64 Data URL 内联（`data:audio/mpeg;base64,...`）。用项目 `fixtures/audio-sample.mp3` 与官方示例音频各跑一次，**先跑小文件**。确认：鉴权通、能返回文本、`usage` 字段形态（供 C5 指标）。
3. **实测上限（决定 §2.5 的配置改法）**：验证 base64 10 MB 限制与音频时长上限的真实边界。同时确认该校验与既有 `DurationProbe` 能否复用。
4. **顺带查时间戳（零成本）**：检查所选模型是否**恰好**存在时间戳参数或响应字段。若有则免费获得（§2.3）；若需换模型或加协议才支持，**按 §1.2 放弃**，不追加投入。
5. **仅当方案 C 跑不通时**才进入备选评估（工作量见 §7）。

**通过条件**：方案 C 能稳定返回正确文本；上限边界已实测；选型结论确认。若失败，按第 5 项降级评估，并把失败原因记录到 `docs/evidence/`。

### 阶段 1：配置与依赖边界（0.5 人日）

- 在 `AppConfig` 中新增独立 Qwen ASR 配置：
  - `QWEN_ASR_API_KEY`（**独立于 `OPENAI_API_KEY`**）；
  - `QWEN_ASR_ENDPOINT`（兼容模式 base URL，默认值经阶段 0 确认）；
  - `QWEN_ASR_MODEL`（按阶段 0 实测的模型 ID）；
  - `QWEN_ASR_TIMEOUT_MS`；
  - 可选 `QWEN_ASR_MAX_RETRIES`，或沿用已有统一重试次数配置。
- **配置校验策略**：转录侧只校验 Qwen 凭证；`OPENAI_*` 仅保留摘要所需（`OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_SUMMARY_MODEL` / `OPENAI_SUMMARY_TIMEOUT_MS`），**移除 `OPENAI_TRANSCRIBE_MODEL` 与 `OPENAI_TRANSCRIBE_TIMEOUT_MS`**（随适配器删除）。注意 `config.ts` 当前在模块加载期即对 `OPENAI_*` 做 `requireEnv` 硬校验，调整时需保持「启动即失败」的既有语义。
- 按 §2.5 选定方式调整上传上限（`MAX_UPLOAD_BYTES` / `MAX_AUDIO_DURATION_SECONDS`）。
- 更新 `.env.example`、配置单元测试和 `docs/architecture/architecture.md` 的环境变量章节。
- 核实依赖：方案 C 沿用既有 `openai` SDK，**预期无需新增依赖**；若阶段 0 发现需要，才添加并固定安全版本、更新 lockfile 与供应链检查（C3 门禁）。
- 禁止自动根据某个凭证「猜测」服务商：单 provider 下直接使用 Qwen 配置，缺失即启动失败。

### 阶段 2：Qwen 转录适配器（约 0.5–1 人日）

新增 `src/infrastructure/qwen/` 下的 `QwenAsrTranscriber`，实现现有 `Transcriber` 接口。方案 C 路径下**无需协议客户端**——它是一次普通的 HTTP 调用。

1. 用 OpenAI SDK 调 `/compatible-mode/v1/chat/completions`：读取音频文件 → 按 MIME 构造 base64 Data URL → 作为 `input_audio` 内容发送 → 取 `choices[0].message.content` 作为文本（见参考资料 [8]）。
2. 按已校验的 MIME 构造 Data URL 的 `mediatype`；不得仅依赖用户文件名，使用现有上传校验产出的 MIME/存储扩展名。
3. **超限处理（§2.5）**：编码前/后校验大小上限，超限时抛**明确的业务错误**（沿用 `DomainError`，不得让上游报错穿透，也不得静默失败）。
4. **内存与流式取舍**：方案 C 需整文件读入内存做 base64，与现有 `openAsBlob` 流式读取不同。需在适配器内注释说明该取舍，并确认在 §2.5 的下调上限保护下内存占用可接受。
5. **指标字段**：填充 `Transcript.characterCount`（按码点计数）；`durationSeconds` 保持 `undefined`（不得伪造）。
6. **不产出时间戳**（§2.3）：不改 `Transcript` 结构、不改产物落盘格式。
7. 空 transcript 是否视为合法结果或上游失败，以现有业务约定及实测结果确定，并增加测试。
8. 将单次调用纳入 `QWEN_ASR_TIMEOUT_MS`；失败时释放资源。
9. 将上游错误映射为内部安全错误类别；日志只记 `jobId`、model、耗时、重试次数、错误类别，不记音频内容、文本、API Key 或完整 URL query。
10. 复用既有 `infrastructure/common/retry.ts` 的重试语义：网络/限流/服务端可恢复错误受控重试；鉴权、格式、参数等不可恢复错误不重试。

**（备选路径，仅当方案 C 失败时启用）** 方案 B 需按 filetrans 提交并轮询、映射 `sentence` 时间戳，并先解决音频公网托管；方案 A 需实现完整 WebSocket 会话、事件聚合、`session.finish` 顺序与 socket 清理（见参考资料 [2][3]）。

### 阶段 3：依赖注入与切换（0.5 人日）

- 在 **`src/bootstrap/container.ts`** 的组合根（`buildContainer()`，`container.ts:70` 处）把 `OpenAITranscriber` 替换为 `QwenAsrTranscriber`。
- **删除 `OpenAITranscriber`** 及其 import/实例化，同步移除 `.env.example` 中 `OPENAI_TRANSCRIBE_MODEL` / `OPENAI_TRANSCRIBE_TIMEOUT_MS`。
- **保留 `transcribeModel` 依赖项**：它改为传 Qwen 模型名，仍写入 Job `result.model` 与 `metrics.jsonl`。
- `ProcessJob` 与 `Transcriber` 契约不变；Worker 队列、Job API 和前端轮询不变。
- 更新 mock system / e2e test factory，使其仍能通过 fake transcriber 跑完整链路。
- **同步更新文档引用**：`docs/architecture/architecture.md`（28/61/98/150 行提及 `OpenAITranscriber` / `whisper-1`）、`docs/project-structure.md`（33 行）。

### 阶段 4：自动化测试（约 0.5–1 人日）

删除 `OpenAITranscriber` 时，其测试不简单删掉，而应**重构搬运**为 Qwen 适配器测试。

**A. 重构复用**（把 `tests/unit/openai-transcriber.test.ts` 的骨架平移，不新增覆盖点）：

- 正常调用并返回文本。
- 请求选项携带 timeout 且关闭 SDK 内置重试。
- 429/5xx 后重试成功：重试 1 次，日志含 `retryCount`。
- 4xx 参数错误立即抛、不重试。
- 上游失败向上抛错，由错误边界处理（**不伪造结果**）。

**B. 必须新增**（方案 C 专属，无既有对应物）：

- **base64 Data URL 构造**：MIME → `data:<mediatype>;base64,...` 的映射正确；中文/特殊格式音频编码后仍可解码。
- **超限分支**：超过上限时抛**明确业务错误**（不是上游报错穿透、不是静默失败、不是截断）；边界值（恰好等于上限）行为正确。
- **响应解析**：从 `choices[0].message.content` 取文本；非预期响应形状（缺字段、空 choices）的安全失败行为。
- **指标字段**：`characterCount` 正确（按码点）；`durationSeconds` 保持 `undefined`，**不得伪造**。
- **错误映射**：401/403、429、5xx、超时 → 安全错误类别；日志不含 key、音频内容、原始路径或上游错误全文。
- **配置测试**：缺失 Qwen key 时启动即失败；`OPENAI_TRANSCRIBE_*` 移除后 `OPENAI_*` 校验不误伤摘要配置。
- `ProcessJob` 成功与失败测试、B7 E2E fake 全部保持通过；HTTP API 与 OpenAPI contract 不需要变化。

> 上表 B 部分不可省：超限分支与 base64 构造是新引入的正确性风险，缺失即等于「未验证就宣称可用」，违反项目 CLAUDE.md「不可假装可用」原则，覆盖率门禁（≥80%）也不会因此放宽。

所有 CI 测试均使用 fake 上游，不访问 DashScope / 阿里云百炼，也不把生产密钥上传到 CI。

### 阶段 5：真实服务联调与验收（0.5 人日）

在开发者本机或安全的受控环境执行，不进入普通 CI：

- 测试环境仅用 `.env`/密钥管理器提供 Qwen Key，禁止写入证据、日志或截图。
- 用许可明确的短音频验证中文/英文、不同现有格式、识别失败、长耗时、网络断开与服务端重启情况。
- 核对 Job 状态最终仍为 `succeeded` 或安全的 `failed`，成功结果可下载，摘要仍正常生成。
- 确认转录文本完整、无截断。
- **核对上限行为**：上传一个超限音频，确认返回**明确的业务错误**（而非上游报错或静默失败）。
- **核对指标落盘**：`metrics.jsonl` 中 `transcribeCharacterCount` / `transcribeDurationMs` 非空；`transcribeDurationSeconds` 允许为空。
- **对照基线的方式**：`whisper-1` **已不可用、无法现场复跑**，不能做实时 A/B。改为对照**归档证据中的历史记录**——`docs/evidence/` 存有 2026-08-24 的 whisper-1 实测（转录 9009ms / 摘要 3276ms，见 `docs/evidence/README.md`），可作历史参照。质量结论只基于同一批有授权的样本，不夸大为通用评测。
- 检查 requestId/jobId 日志关联和错误响应不泄露 Qwen 原始异常。
- 归档脱敏测试结果、模型/地域配置名称（不得包含 key）与运行步骤。

## 5. 预计改动文件

| 区域 | 预计改动 |
| --- | --- |
| 配置 | `src/bootstrap/config.ts`（移除 `OPENAI_TRANSCRIBE_*`、新增 `QWEN_ASR_*`、调整上传上限）、`tests/unit/config.test.ts`、`.env.example` |
| 领域模型 | **不变**（时间戳已放弃，见 §2.3） |
| 上传校验 | `MAX_UPLOAD_BYTES` / `MAX_AUDIO_DURATION_SECONDS` 调整（§2.5） |
| 适配器 | 新增 `src/infrastructure/qwen/` 下 `QwenAsrTranscriber`；**删除 `src/infrastructure/openai/transcriber.ts`** |
| 依赖组装 | **`src/bootstrap/container.ts`**、`tests/unit/container.test.ts` |
| 用例 | `src/application/process-job.ts`：仅确认指标字段接入 |
| 通用日志/重试 | 复用既有 `infrastructure/common/retry.ts` 与错误分类；事件改名（`openai.transcribed` → provider 中立）作为独立小改，不在本次一并做 |
| 测试 | 删除 `tests/unit/openai-transcriber.test.ts` 并**重构搬运**为 Qwen adapter 单测；新增 §4 阶段 4 B 部分；更新配置/DI/system fake |
| 文档 | `docs/architecture/architecture.md`、`docs/project-structure.md`、`.env.example`、必要时新增 ADR、本次实施证据 |
| **不应变化** | HTTP 路由、OpenAPI、前端上传/轮询/下载流程、Job 状态机、摘要链路、`src/domain/ports.ts` |

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

- 在 fake 上游上完成上传至摘要的全链路。
- 在受控环境完成真实 Qwen 服务联调，证明文本完整、Job 可下载、超时和错误行为安全。
- **上限验收**：超限音频返回明确业务错误，不是上游报错穿透、也不是静默失败。
- **指标验收**：`metrics.jsonl` 中转录字数与耗时列非空且合理。
- 文档和证据清楚区分自动化 fake 结果与真实服务联调结果。

## 7. 工作量估算

| 阶段 | 方案 C（选定） | 方案 B | 方案 A |
| --- | ---: | ---: | ---: |
| 可行性确认（阶段 0） | 0.5–1 | 0.5–1.5 | 0.5–1.5 |
| 配置、DI、适配器 | 0.5–1 | 1–1.5 | 2–3.5 |
| 自动化测试、文档、全量回归 | 0.5–1 | 1–1.5 | 1.5–2.5 |
| 真实联调与修正 | 0.5 | 0.5–1 | 0.5–1 |
| **合计** | **约 1.5–3 人日** | 约 2–3 人日 | 约 4.5–8.5 人日 |

方案 A 若 WebSocket 协议与当前 Node 运行时集成顺利可能接近 4–6 人日；若需容器格式转换、账号域名/权限排查或复杂的事件聚合/重连，则更接近 7–9 人日。

此估算包含测试与文档，**不包含**前端实时字幕、摘要模型切换（§2.4），**不包含**方案 B 所需的 OSS 基建搭建成本。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **base64 上限导致大文件失败** | 用户上传超 7.5 MB 时转录失败；若处理不当会出现上游报错穿透或静默失败 | 按 §2.5 下调/分层校验上限，返回**明确业务错误**；阶段 0 实测真实边界；写入 OpenAPI 与 `.env.example`。**不得静默截断或伪造成功** |
| **整文件进内存** | 方案 C 需 base64 编码，内存峰值升高，与现有流式读取不同 | §2.5 的上限下调即是保护；适配器内注释说明取舍；联调时观察内存 |
| **时间戳缺失** | 与老师原话「带时间戳文本」的表述不一致 | 已按 §1.2 优先级接受。缓解：答辩话术相应调整；阶段 0 零成本顺带确认是否有免费时间戳；若日后需要，方案 B/A 路径已在本计划留档 |
| **编码格式、容器与 MIME 不匹配** | 服务端拒绝或识别错误 | 按上传校验后的 MIME/扩展名构造 Data URL；真实样本验证；有需求再独立评估 FFmpeg 转码 |
| **错误格式和重试边界不同于原上游** | Job 失败被误判或重复扣费 | 适配器内映射安全错误类别；测试 4xx 与网络/429/5xx；避免 SDK 与自定义重试叠加 |
| **Qwen 配置与 OpenAI 配置耦合** | 启动需同时设置两家密钥 | 配置分域——转录只校验 `QWEN_ASR_*`，摘要只校验 `OPENAI_*`；凭证分域管理，日志禁止输出密钥 |
| **选型误判** | 高估/低估某方案的代价，多花数人日 | 判据已显式化（§1.2）+ 阶段 0 先跑通方案 C 再决定是否降级；工作量对照表见 §7 |
| **对照基线不可得** | 无法与 Whisper 做实时 A/B | 用 `docs/evidence/` 中归档的历史记录作参照（§4 阶段 5） |

## 9. 实施前待确认事项

1. **【待你确认】上传上限方案**（§2.5）：把 `MAX_UPLOAD_BYTES` 直接降至 ≤7.5 MB，还是保留 25 MB 上传但转录前分层校验？**建议前者**（口径统一、错误更早暴露）。这会影响 `.env.example`、OpenAPI 描述与前端提示。
2. **【阶段 0 实测】实际模型 ID 与上限**：`qwen-audio-3.1-asr-flash-*` 还是 `qwen3-asr-flash*`；base64 与时长上限的真实边界。两站命名不同，以账号可见值为准。
3. **【需准备】** 账号可用地域、Workspace ID、Key 权限与测试额度。
4. **【已定 · 无需再议】** 单 provider，直接替换并删除 `OpenAITranscriber`（§2.2、§4 阶段 3）。
5. **【已定 · 无需再议】** 摘要模型保持 `gpt-4o`（§2.4）。
6. **【已定 · 无需再议】** 本次不交付时间戳（§2.3）。
7. **【默认】** 不引入 FFmpeg 或其他外部进程；需要时另行评估。

## 10. 官方参考资料

> 下列链接为 2026-09-24 定稿时的官方来源，正文各依据处标注编号回指。

1. [阿里云百炼：语音识别概述（模型选型与迁移对照表）](https://help.aliyun.com/zh/model-studio/asr-model) — 模型 ID、实时/非实时、时长上限、说话人分离、语种支持；闭源模型迁移对照表（非实时/文件转写 ← Whisper、gpt-4o-transcribe）。
2. [阿里云百炼：Qwen-ASR-Realtime WebSocket 接入指南](https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-interaction-process) — WebSocket URL 形态（`wss://{WorkspaceId}.<region>.maas.aliyuncs.com/api-ws/v1/realtime?model=<model>`）、请求头鉴权、VAD 与 Manual 两种模式；「推完音频必须先发 `session.finish` 再关连接」的官方警告。
3. [阿里云百炼：Qwen-ASR-Realtime 服务端事件](https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-server-events) — `input_audio_buffer.speech_started`（`audio_start_ms`）/ `speech_stopped`（`audio_end_ms`）/ `conversation.item.input_audio_transcription.text`（中间结果）/ `.completed`（最终结果）。
4. [阿里云百炼：非实时语音识别用户指南](https://help.aliyun.com/zh/model-studio/non-realtime-speech-recognition-user-guide) — filetrans 的 `sentence` 结构（`sentence_id` / `begin_time` / `end_time`，毫秒）、`timestamp_granularities` 句级/词级切换、DashScope 异步调用时间戳永久启用。
5. [阿里云百炼：语音识别 API 参考](https://help.aliyun.com/zh/model-studio/speech-recognition-api-reference/) — 实时 Streaming 与非实时 Filetrans 的 API 分类与接入方式。
6. [阿里云百炼：实时语音识别用户指南](https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide) — 模型介绍与完整示例代码。
7. [Qwen-ASR — DashScope 异步（filetrans）API 参考](https://docs.qwencloud.com/api-reference/speech-recognition/qwen-asr/dashscope-async) — **方案 B 被否的依据**：`input.file_url` 官方描述 "Must be accessible over the Internet"，"Audio formats" 一节 "Audio file URLs must be publicly accessible"；另有 `enable_words` 控制句级/词级时间戳。
8. [Qwen-ASR — OpenAI 兼容（chat completions）API 参考](https://docs.qwencloud.com/api-reference/speech-recognition/qwen-asr/openai) — **方案 C 依据**：支持 Base64-encoded audio 或公网 URL；"Keep the encoded audio within the 10 MB limit"；`asr_options` 仅 `language` / `enable_itn`，无时间戳参数；响应的 `usage` 含 token 明细可供 C5 指标。
9. [Qwen-ASR — DashScope 同步 API 参考](https://docs.qwencloud.com/api-reference/speech-recognition/qwen-asr/dashscope) — `audio` 字段支持 URL / Base64 / 本地路径（**SDK only**）；响应仅 `content[].text` 与 `annotations`（language、emotion），无时间字段。

> 官方文档和模型服务可能更新。阶段 0 必须以实际账号可见的当前模型 ID、地域端点、参数及限制为准；本计划中的估算不代表服务商 SLA 或费用承诺。
