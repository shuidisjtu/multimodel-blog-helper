# 架构设计

> 本文档回答两件事：**为什么这样分层**（各层职责与依赖方向）和**信息如何流动**（数据流）。
> 其余内容的权威位置（单一真相源，本文档不重复）：
> - 设计决策与取舍 → [`docs/adr/`](../adr/)
> - 文件级职能与物理目录 → [`docs/project-structure.md`](../project-structure.md)
> - API 契约（端点、错误码、DTO、状态码）→ [`src/interfaces/http/openapi.yaml`](../../src/interfaces/http/openapi.yaml)
> - 架构维护原则与防腐化 → [`architecture-principles.md`](architecture-principles.md)

## 1. 分层总览

项目采用六边形（端口-适配器）架构，依赖**严格向内**——箭头指向被依赖方，越靠内依赖越少：

```
interfaces/http ──▶ application ──▶ domain
                      │                ▲
                      │   依赖 domain 声明的「端口」(接口)
                      ▼
        infrastructure ──实现 domain 的端口──┘
```

- **domain** 是最内层，不 import 任何其他层。
- **application** 依赖 domain，具体是依赖 domain 声明的**端口接口**（而不是 domain 里的实现——domain 里没有实现）。
- **interfaces/http** 依赖 application。
- **infrastructure**（适配器）实现 domain 声明的端口，依赖方向同样指向 domain。
- **bootstrap** 把各层组装到一起；**shared** 的 `logger`/`ids`/`clock` 被各层注入使用。

**「端口」是什么**：端口是 domain 层「声明」的接口，只规定「我需要什么能力」（如「能把音频转成文本」），不规定「谁来提供、怎么实现」。真正干活的是 infrastructure（`OpenAITranscriber implements Transcriber`）。所以端口是**需求声明，不是实现**——domain 只提需求，infrastructure 交活，application 在中间按端口调用、从不直接接触具体实现。

下面按「由内向外」逐层展开。

## 2. domain 层：纯业务规则，最内层

domain 层只装「业务本身是什么」，不碰任何技术（不 import SDK、不读 `process.env`、不读写磁盘）。它由四块组成，全部是纯 TypeScript 类型 + 纯函数。

### 2.1 领域模型与状态机

唯一聚合根 `BlogJob`（[`src/domain/job.ts`](../../src/domain/job.ts)），字段含 `id`、`status`、`input`、`result?`、`failure?` 等。`JobStatus` 六态：

```
queued → transcribing → summarizing → succeeded
        （任一进行中态可 → failed；终态清理后 → expired）
```

迁移只由 `ProcessJob` 用例完成，越界抛 `JobStateError`；终态不得被重新处理。

### 2.2 领域错误

[`src/domain/errors.ts`](../../src/domain/errors.ts) 定义 15 个 `ErrorCode` 及 `DomainError`/`JobStateError`。错误码是「业务语义」的稳定表达，HTTP 状态码的映射在 interfaces 层（见 §5.3），domain 不关心 HTTP。

### 2.3 上传校验（纯函数）

[`src/domain/audio-upload.ts`](../../src/domain/audio-upload.ts) 的 `validateAudioUpload` 做 MIME 白名单、大小、魔数一致性校验——无 IO、纯函数，因此可脱离 HTTP 单独测试。

### 2.4 端口（domain 对外声明的能力）

domain 只依赖这些端口接口（定义见 [`src/domain/ports.ts`](../../src/domain/ports.ts)），实现见 §4：

| 端口 | 声明的能力 | 实现（§4） |
| --- | --- | --- |
| `Transcriber` | 音频 → 文本 | `OpenAITranscriber` |
| `Summarizer` | 文本 → 摘要 | `ResponsesSummarizer` |
| `WeatherProvider` | 地点 → 天气 | `WttrWeatherProvider` |
| `JobRepository` | 任务持久化（含幂等三态） | `FileJobRepository` |
| `FileStore` | 输入/产物落盘 | `LocalFileStore` |
| `AudioDurationProbe` | 时长探测（失败降级 `null`） | `MusicMetadataDurationProbe` |
| `JobQueue` | 有界任务队列 | `MemoryJobQueue` |

## 3. application 层：用例编排

### 3.1 什么是「用例编排」

**用例（use case）** = 一个用户能感知的完整业务动作：提交音频、查询任务、下载转录、问天气。

**编排（orchestration）** = 这个动作内部要做的一串步骤——校验、落盘、建任务、入队、回滚——被**按正确顺序串起来**；但每一步都不自己做底层的事，而是**通过端口委派**给基础设施。application 自己只负责「先做什么、后做什么、失败怎么处理」的决策，因此它不 import Express、不直接 `fetch`、不直接读写磁盘，可以脱离 HTTP 和网络被单独测试。

以 `SubmitAudio` 为例，它编排的顺序是：`校验音频 → 落盘 → 创建 queued Job → 队列预检 → 入队`，其中任何一步失败都有对应的回滚动作（删文件 / 删 Job 记录），这些「顺序 + 回滚」的编排逻辑就是 application 的核心价值。

### 3.2 用例清单

| 用例 | 做什么 | 关键行为 |
| --- | --- | --- |
| `SubmitAudio` | 受理上传、创建任务 | 幂等三态（created/replayed/conflict）、队列预检、失败回滚 |
| `ProcessJob` | 推进单个任务直至完成 | 驱动状态机 `queued→transcribing→summarizing→succeeded`，不外抛 |
| `ProcessJobWorker` | 订阅队列并消费任务 | 并发由队列控制 |
| `QueryJob` | 查询任务与摘要 | 不存在→`JOB_NOT_FOUND`，过期→`JOB_EXPIRED` |
| `GetTranscript` | 下载纯文本转录 | 未就绪→`JOB_NOT_READY`(409) |
| `AskWeather` | 查询天气 | 未知失败统一 `WEATHER_UNAVAILABLE` |
| `RecoverJobs` | 启动时恢复未完成任务 | `queued` 重入队；进行中标记 `PROCESS_INTERRUPTED` 不重试 |
| `CleanupExpired` | 清理过期任务 | 删文件 + 保留 tombstone（**当前未接线**，见 §8） |

## 4. infrastructure 层：适配器

这一层是唯一接触「外部世界」的地方，每个适配器实现一个 domain 端口，负责把第三方数据转成内部 DTO、把外部错误转成稳定业务错误。

| 适配器 | 实现的端口 | 依赖的外部 |
| --- | --- | --- |
| `OpenAITranscriber` | `Transcriber` | OpenAI 转录接口（whisper-1，见 issue #16） |
| `ResponsesSummarizer` | `Summarizer` | OpenAI Responses API |
| `WttrWeatherProvider` | `WeatherProvider` | wttr.in |
| `FileJobRepository` | `JobRepository` | 本地文件系统（`temp/jobs/*.json`） |
| `LocalFileStore` | `FileStore` | 本地文件系统（`temp/uploads`、`temp/outputs`） |
| `MusicMetadataDurationProbe` | `AudioDurationProbe` | music-metadata（纯 JS） |
| `MemoryJobQueue` | `JobQueue` | 进程内存（有界 FIFO） |

另有两块横切工具：`common/retry.ts`（指数退避重试，仅重试网络/429/5xx）与 `common/music-metadata-duration-probe.ts`（时长探测，解析失败降级 `null` 不误杀）。

## 5. interfaces/http 层：对外接口

这一层负责「把 HTTP 请求转成对用例的调用，再把结果序列化成响应」。它不做业务，只做协议适配。

### 5.1 端点一览

权威契约见 [`openapi.yaml`](../../src/interfaces/http/openapi.yaml)，下表仅作导航：

| 端点 | 方法 | 关键状态码 |
| --- | --- | --- |
| `/api/v1/audio-jobs` | POST | `202` / `200`（幂等重放）/ `409` / `400` / `413` / `415` / `429` / `503` |
| `/api/v1/audio-jobs/{id}` | GET | `200` / `404` / `410` |
| `/api/v1/audio-jobs/{id}/transcript` | GET | `200`(text/plain) / `404` / `410` / `409` |
| `/api/v1/assistant/weather` | POST | `200` / `422` / `429` / `503` |

`/health/live`、`/health/ready`、`/metrics` 在 openapi.yaml 中标记为 `planned`，当前**未实现**。

### 5.2 中间件链

请求按序经过：`requestId → CORS(白名单) → accessLog → JSON 解析 → 路由级限流 → 业务路由 → errorHandler`。每个中间件职责见 [`project-structure.md`](../project-structure.md)。

### 5.3 错误映射

[`middleware/error-handler.ts`](../../src/interfaces/http/middleware/error-handler.ts) 用一张 `STATUS_BY_CODE` 表把 domain 的 `ErrorCode` 一次性映射为 HTTP 状态码 + 稳定文案；领域错误的原始 `message` 只进日志、不进响应体（防泄漏内部路径/上游细节）。

## 6. bootstrap 与 shared 层

- **bootstrap**（[`src/bootstrap/`](../../src/bootstrap/)）：组合根 `container.ts` 是唯一允许 `new` 基础设施的地方，按「配置 → 基础设施 → 用例 → worker/recover」的顺序装配；`config.ts` 集中读取并校验所有环境变量；`server.ts` 启动时先 `RecoverJobs.run()` 再 `worker.start()`（启动顺序契约）。
- **shared**（[`src/shared/`](../../src/shared/)）：`logger`/`ids`/`clock` 三个**横切端口**——「横切」指它们不属于某条业务流，而是各层通用（打日志、生成 id、取时间），同样做成「接口 + 默认实现」以便测试注入 fake。

## 7. 数据流

### 7.1 音频 → 转录 → 摘要（异步任务，主链路）

```text
POST /api/v1/audio-jobs
  ↓ 限流 → multer 内存暂存 → validateAudioUpload(纯校验)   [interfaces/http]
SubmitAudio                                                [application]
  ↓ 落盘 temp/uploads/<jobId>/ → 创建 queued Job → 入队
MemoryJobQueue（有界内存队列）                              [infrastructure]
  ↓ worker 消费
ProcessJob（状态机推进，不外抛）                            [application]
  ├─ transcribing → OpenAITranscriber（whisper-1）         [infrastructure]
  ├─ summarizing  → ResponsesSummarizer（Responses API）
  └─ saveOutput → succeeded
GET /api/v1/audio-jobs/{id} 与 /{id}/transcript            [interfaces/http]
```

### 7.2 天气（同步，独立于任务链路）

```text
POST /api/v1/assistant/weather → AskWeather → WttrWeatherProvider（wttr.in）
  └─ 上游超时/无效地点 → 稳定业务错误（不伪造、不泄漏上游字段）
```

### 7.3 后台流程

- **启动恢复**：`RecoverJobs.run()`（`queued` 重入队；进行中态标记 `PROCESS_INTERRUPTED` 且不自动重试，防重复计费）**必须先于** `worker.start()`。
- **过期清理**：`CleanupExpired`（终态过期 → 删文件 + 保留 tombstone）——接线状态见 §8。

## 8. 契约与实现的已知差异

> 只列「读者易被误导」的差异；任务进度以 [`task-list.md`](../project-division/task-list.md) 为权威。

- `CleanupExpired` 用例已实现并有测试，但**未在 `container.ts` 组装**，生产进程当前无调度器触发过期清理（见 issue #15）。
- `openapi.yaml` 声明了 `/health/live`、`/health/ready`、`/metrics`，但 `src/` 内无实现；`config.metrics.port` 为无消费方的死配置。
