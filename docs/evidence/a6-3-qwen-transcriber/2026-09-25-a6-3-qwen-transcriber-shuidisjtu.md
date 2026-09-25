# A6-3 Qwen 转录适配器（含时间戳重组）· 证据记录

> 日期：2026-09-25 ｜ 执行人：shuidisjtu ｜ 任务：[A6-3](../../records/2026-09-23-qwen-asr-implementation-plan.md)（Qwen-ASR 接入）
> 前置：[A6-1](../a6-1-qwen-asr-feasibility/2026-09-25-a6-1-qwen-asr-feasibility-shuidisjtu.md) ✅、[A6-2](../a6-2-config-boundaries/2026-09-25-a6-2-config-boundaries-shuidisjtu.md) ✅
> 决策记录：[ADR-0007](../../adr/0007-qwen-asr-and-timestamps.md)

## 1. 验收标准对照

| # | 验收标准（计划 §4 A6-3） | 结果 |
| --- | --- | --- |
| 1 | 实现 `Transcriber` 接口, 返回正确文本 | ✅ 单测覆盖请求构造与响应解析 |
| 2 | 返回句级时间戳 | ✅ 由词级数据按标点重组(§3) |
| 3 | segments 时间单调递增、无重叠 | ✅ 单测断言 + 算法天然保证 |
| 4 | 超限输入抛明确业务错误 | ⚠️ **部分**: 编码后超限为前置预检(抛 `FILE_TOO_LARGE`); 时长超限依赖上游错误码映射为 `AUDIO_TOO_LONG`, **不在适配器内主动探测时长**(见 §5.1) |
| 5 | 日志不含 API Key 与音频内容 | ✅ 单测断言序列化后的日志不含密钥/音频字节/转录文本 |
| 6 | 领域模型扩展 `Transcript.segments` | ✅ 见 §2 |
| 7 | 复用既有重试语义 | ✅ 复用 `infrastructure/common/retry.ts`, 429/5xx/网络错误重试, 4xx 与业务错误不重试 |

**仍未生效的验收项**：适配器**尚未接入组合根**(A6-5), 故真实任务的转录仍不可用, 新增下载端点对真实任务返回 `JOB_NOT_READY`。本节所有结论均来自单元测试与契约测试, **不含真实服务联调**(那是 A6-7)。

## 2. 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/domain/ports.ts` | 新增 `TranscriptSegment`；`Transcript` 增加可选 `segments`；`SaveOutputParams.kind` 增加 `transcript-timed` |
| `src/domain/job.ts` | `JobResult` 增加可选 `timedTranscriptPath`(内部字段, 不进 HTTP 响应) |
| `src/infrastructure/qwen/segment-builder.ts` | **新增**：词级 → 句级重组器 |
| `src/infrastructure/qwen/qwen-asr-transcriber.ts` | **新增**：DashScope 同步识别适配器 |
| `src/application/transcript-text.ts` | **新增**：带时间戳文本渲染 |
| `src/application/process-job.ts` | 有时间戳时额外落盘产物并把路径写入 `result` |
| `src/application/get-transcript.ts` | 抽出共用的状态语义与错误映射, 新增 `runTimed()` |
| `src/infrastructure/storage/file-store.ts` | `kind → 文件名` 表驱动, 新增 `transcript.timed.txt` |
| `src/interfaces/http/routes/audio-job-query.ts` | 新增 `GET /api/v1/audio-jobs/:id/transcript/timed` |
| `src/interfaces/http/openapi.yaml` | 新增 `downloadTimestampedTranscript` 路径 |
| `docs/adr/0007-qwen-asr-and-timestamps.md` | **新增**：本项目录与时间戳策略 |

## 3. 重组算法：规则与依据

上游返回的分段是**按静音切分的 VAD 片段**, 不是语言学句子, 故从词级数据重组。规则:

| 规则 | 依据 |
| --- | --- |
| 遇句末标点(`。！？!?…` 与 `.`)结段 | 实测 171s 样本 VAD 10 段 → 重组 31 句, 时长中位 9.6s → 4.5s |
| 说话人切换处强制断开 | 把一句归给两个说话人比多切一刀更糟 |
| 低于 `MIN_SEGMENT_MS`(1000ms)的片段并入相邻**同说话人**片段 | 实测重组后自然最短 1.2s; 取 1000ms 只命中真正退化的碎片, 不误并正常短句 |
| 不跨说话人合并 | 否则会把两个人的话粘成一句 |
| 标点为空时**有意不切** | 实测 528 词中 480 个标点为空; 没有切分依据时不臆造边界 |
| 无时间戳的词跳过 | 伪造为 0 会污染时间轴且无从察觉 |
| 无可用词 → `segments: undefined` | 不用空数组冒充"已支持时间戳" |

**已知代价(有意接受)**: 英文缩写(如 `Dr.`)会被误切。该场景未出现在本项目音频样本中, 不引入词表规避(YAGNI)。

## 4. 响应解析的关键约束

依据 [A6-1 §8.2](../a6-1-qwen-asr-feasibility/2026-09-25-a6-1-qwen-asr-feasibility-shuidisjtu.md) 的实测更正, 适配器按下列方式解析, 每一条都有对应单测:

| 约束 | 若违反的后果 | 覆盖用例 |
| --- | --- | --- |
| `text` / `usage` 读**顶层** | 读 `output.usage` 得 `undefined` 且不报错, C5 指标静默丢失 | `usage 只在顶层...` |
| 分段读 `sentences[]` | 单数 `sentence` 始终覆盖整段音频, 分段退化为"整段一句" | `分段取 sentences[]...` |
| 200 但无文本 → 抛错 | 空转录会静默产出空摘要 | `200 但无文本...` |

## 5. 与计划的差异

### 5.1 时长超限不在适配器内主动探测

计划原文要求「**编码前/后**校验大小与时长上限」。实际实现: 编码后体积在适配器内预检, **时长不探测**。

**原因**: 适配器不持有 `AudioDurationProbe`, 且时长在**上传受理阶段**已由 `SubmitAudio` 校验(`MAX_AUDIO_DURATION_SECONDS=300`), 超限在受理时即被拒。适配器内再探测一遍属重复 IO 且需新增依赖。

**兜底**: 若探测失败降级放行(A3 既有的"解析失败不误杀"语义), 上游会以 `AUDIO_DURATION_TOO_LONG` 拒绝, 适配器将其**映射为 `AUDIO_TOO_LONG` 业务错误**, 不退化成泛化的 500。即"上游报错穿透"这条风险已被映射覆盖。

### 5.2 产物形态与 ADR 提前落地

- 时间戳产物形态(§9 第 6 项)已定并实现, 见 §2。
- 按项目规则「改动公开 API 须同步 ADR」, ADR-0007 随本次改动落地, 早于计划中的 A6-6。

## 6. 验证

```bash
npm test        # 47 文件 / 367 用例 全绿
npm run verify  # lint + lint:openapi + typecheck + check:docs + check:structure
                # + 安全豁免 + 测试 + 覆盖率 + web:verify 全绿
```

- 覆盖率：Statements **93.42%** / Branch 89.52%（A6-2 后为 92.47%）；`infrastructure/qwen` 目录 99.17%
- 新增测试：`tests/unit/segment-builder.test.ts`(11)、`tests/unit/qwen-asr-transcriber.test.ts`(15)、`tests/unit/transcript-text.test.ts`(3)，并扩充 `process-job` / `get-transcript` / OpenAPI 契约测试
- 契约测试新增 `downloadTimestampedTranscript` 的 200 / 409 / 404 三态验证（`assertOpenApiResponse` 直接以 openapi.yaml 约束校验 wire response）

## 7. 遗留与提醒

1. **适配器未接线**（A6-5）：容器仍装配 `OpenAITranscriber`，`QWEN_ASR_*` 配置与 `QwenAsrTranscriber` 目前均无生产消费者。新增端点对真实任务返回 409。
2. **`tests/unit/openai-transcriber.test.ts` 未动**：它测的模块仍存在（A6-5 才删除），故其"重构搬运"实际与 A6-5 同批完成，A6-4 的剩余范围将在那里收口。
3. **真实服务联调未做**（A6-7）：全部结论来自 fake 上游。真实样本下的时间戳粒度、超限行为需在 A6-7 用业务空间专属域名复核。
4. **本机 vitest worker 偶发崩溃**：`npm test` 与覆盖率跑动中偶见 `Worker exited unexpectedly`（表现为少数文件未执行），重跑即恢复。首次出现于 A6-2 验证期间，早于本任务的测试代码，判为环境问题；已复跑两次全绿。
