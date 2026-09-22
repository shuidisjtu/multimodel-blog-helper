# 架构设计

> 本文档只回答两件事：**为什么这样分层**（模块边界与依赖方向）和**信息如何流动**（数据流）。
> 其余内容的权威位置（单一真相源，本文档不重复）：
> - 设计决策与取舍 → [`docs/adr/`](../adr/)
> - 文件级职能与物理目录 → [`docs/project-structure.md`](../project-structure.md)
> - API 契约（端点、错误码、DTO、状态码）→ [`src/interfaces/http/openapi.yaml`](../../src/interfaces/http/openapi.yaml)
> - 架构维护原则与防腐化 → [`architecture-principles.md`](architecture-principles.md)

## 1. 分层与依赖方向

项目采用六边形（端口-适配器）分层，依赖严格向内：

```
interfaces/http ──▶ application ──▶ domain（无外部依赖）
                        │                ▲
                        └── 仅依赖 domain 端口 ──┘
        infrastructure 实现 domain 端口
        bootstrap 组装全部；shared 提供横切端口
```

| 层 | 职责 | 依赖 | 禁止 |
| --- | --- | --- | --- |
| `interfaces/http` | 路由、DTO 校验、响应序列化、中间件 | 仅调用 application 用例 | 编排 OpenAI 调用、直接读写磁盘 |
| `application` | 用例编排 | 仅依赖 domain 端口 + shared | 知道 Express/Multer/具体 URL |
| `domain` | Job 状态机、领域错误、端口接口 | 无 | 导入 SDK、读 `process.env` |
| `infrastructure` | 端口实现（OpenAI/队列/仓储/文件/天气） | 实现 domain 端口 | 定义业务规则或 HTTP 状态码 |
| `bootstrap` | 配置、依赖组装、服务启停 | 所有层 | 放置业务逻辑 |
| `shared` | `logger`/`ids`/`clock` 横切端口 | 被各层注入 | — |

唯一允许 `new` 基础设施的地方是组合根 [`src/bootstrap/container.ts`](../../src/bootstrap/container.ts)。每层的文件清单见 [`project-structure.md`](../project-structure.md)。

## 2. 数据流

### 2.1 音频 → 转录 → 摘要（异步任务，主链路）

```text
POST /api/v1/audio-jobs
  ↓ 限流 → multer 内存暂存 → validateAudioUpload(纯校验)   [interfaces/http]
SubmitAudio                                                [application/submit-audio]
  ↓ 落盘 temp/uploads/<jobId>/ → 创建 queued Job → 入队
MemoryJobQueue（有界内存队列）                              [infrastructure/queue]
  ↓ worker 消费
ProcessJob（状态机推进，不外抛）                            [application/process-job]
  ├─ transcribing → OpenAITranscriber（whisper-1）         [infrastructure/openai]
  ├─ summarizing  → ResponsesSummarizer（Responses API）
  └─ saveOutput → succeeded
GET /api/v1/audio-jobs/{id} 与 /{id}/transcript            [interfaces/http]
```

### 2.2 天气（同步，独立于任务链路）

```text
POST /api/v1/assistant/weather → AskWeather → WttrWeatherProvider（wttr.in）
  └─ 上游超时/无效地点 → 稳定业务错误（不伪造、不泄漏上游字段）
```

### 2.3 后台流程

- **启动恢复**：`RecoverJobs.run()`（`queued` 重入队；进行中态标记 `PROCESS_INTERRUPTED` 且不自动重试，防重复计费）**必须先于** `worker.start()`——启动顺序契约。
- **过期清理**：`CleanupExpired`（终态过期 → 删文件 + 保留 tombstone）——接线状态见 [`task-list.md`](../project-division/task-list.md) 与本文档 §6。

## 3. 领域模型与状态机

唯一聚合根 `BlogJob`（[`src/domain/job.ts`](../../src/domain/job.ts)）。

`JobStatus` 六态：`queued → transcribing → summarizing → succeeded`；任一进行中态可 `→ failed`；终态清理后 `→ expired`。迁移只由 `ProcessJob` 完成，越界抛 `JobStateError`。终态不得被重新处理。

## 4. 端口

领域层对外只依赖这些端口（定义见 [`src/domain/ports.ts`](../../src/domain/ports.ts)），实现见各 `infrastructure/**`：

| 端口 | 职责 | 实现 |
| --- | --- | --- |
| `Transcriber` | 音频 → 文本 | `OpenAITranscriber` |
| `Summarizer` | 文本 → 摘要 | `ResponsesSummarizer` |
| `WeatherProvider` | 地点 → 天气 | `WttrWeatherProvider` |
| `JobRepository` | 任务持久化（含幂等三态） | `FileJobRepository` |
| `FileStore` | 输入/产物落盘 | `LocalFileStore` |
| `AudioDurationProbe` | 时长探测（失败降级 `null`） | `MusicMetadataDurationProbe` |
| `JobQueue` | 有界任务队列 | `MemoryJobQueue` |

## 5. HTTP 接口一览

权威契约见 [`openapi.yaml`](../../src/interfaces/http/openapi.yaml)；下表仅作导航：

| 端点 | 方法 | 关键状态码 |
| --- | --- | --- |
| `/api/v1/audio-jobs` | POST | `202` / `200`（幂等重放）/ `409` / `400` / `413` / `415` / `429` / `503` |
| `/api/v1/audio-jobs/{id}` | GET | `200` / `404` / `410` |
| `/api/v1/audio-jobs/{id}/transcript` | GET | `200`(text/plain) / `404` / `410` / `409` |
| `/api/v1/assistant/weather` | POST | `200` / `422` / `429` / `503` |

`/health/live`、`/health/ready`、`/metrics` 在 openapi.yaml 中标记为 `planned`，当前**未实现**。

## 6. 契约与实现的已知差异

> 只列「读者易被误导」的差异；任务进度以 [`task-list.md`](../project-division/task-list.md) 为权威。

- `CleanupExpired` 用例已实现并有测试，但**未在 `container.ts` 组装**，生产进程当前无调度器触发过期清理。
- `openapi.yaml` 声明了 `/health/live`、`/health/ready`、`/metrics`，但 `src/` 内无实现；`config.metrics.port` 为无消费方的死配置。
