# A6-2 配置与依赖边界 · 证据记录

> 日期：2026-09-25 ｜ 执行人：shuidisjtu ｜ 任务：[A6-2](../../records/2026-09-23-qwen-asr-implementation-plan.md)（Qwen-ASR 接入 · 配置与依赖边界）
> 前置：[A6-1 可行性确认](../a6-1-qwen-asr-feasibility/2026-09-25-a6-1-qwen-asr-feasibility-shuidisjtu.md) ✅

## 1. 目标与验收标准

| # | 验收标准 | 结果 |
| --- | --- | --- |
| 1 | 转录域与摘要域凭据各自校验，报错只指向自己缺失的变量名 | ✅ 单元测试断言精确错误消息 |
| 2 | 缺失所需 key 时启动即失败（不静默降级） | ✅ `requireEnv` 保持模块加载期硬校验 |
| 3 | 上传超限返回**明确业务错误**而非上游报错 | ✅ 上限默认值收敛到服务端硬限内（见 §3） |
| 4 | 配置单元测试覆盖两域隔离与上限边界 | ✅ `tests/unit/config.test.ts` 新增 5 个用例 |
| 5 | 移除 `OPENAI_TRANSCRIBE_*` | ⚠️ **未在 A6-2 完成**，见 §4 |

## 2. 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/bootstrap/config.ts` | 新增 `AppConfig.qwen` 域（6 项）；`MAX_AUDIO_DURATION_SECONDS` 默认 3600→300；`MAX_UPLOAD_BYTES` 默认 25 MiB→15 MiB；新增 `boolEnv` helper 并统一 `TRUST_PROXY` 解析 |
| `.env.example` | 拆为「摘要域 / 转录域」两组；补齐 `DASHSCOPE_API_KEY`、`QWEN_ASR_*`；上限值同步并注明依据 |
| `src/interfaces/http/openapi.yaml` | 受理描述与 `AudioUploadRequest`：25 MiB→15 MiB、3600 秒→300 秒 |
| `web/src/components/AudioJobPanel.tsx` | 两处用户可见文案（`AUDIO_TOO_LONG`、`FILE_TOO_LARGE` 及上传说明）同步新默认值 |
| `tests/unit/config.test.ts` | 新增转录域默认值 / 覆盖与非法值 / 两域隔离 / 上限默认与边界 5 个用例；开发环境覆盖用例扩到两域 |
| `tests/unit/container.test.ts` 等 5 个夹具文件 | `AppConfig` 字面量补 `qwen` 域 |

**新增配置项默认值**

| 配置项 | 默认值 | 依据 |
| --- | --- | --- |
| `DASHSCOPE_API_KEY` | 必填 | A6-1 实测鉴权方式 |
| `QWEN_ASR_ENDPOINT` | 国内站通用域名 `/api/v1/services/aigc/multimodal-generation/generation` | A6-1 实测可用 |
| `QWEN_ASR_MODEL` | `qwen-audio-3.1-asr-flash` | 实施计划 §2.1 选型 |
| `QWEN_ASR_TIMEOUT_MS` | 300000（5 分钟） | 与音频时长硬限 300s 1:1 |
| `QWEN_ASR_SPEAKER_DIARIZATION` | `true` | 见 §5 决定 |
| `QWEN_ASR_MAX_RETRIES` | 2 | 沿用既有重试语义 |

## 3. 上限默认值变更（依据 A6-1 实测）

| 配置项 | 原默认 | 新默认 | 理由 |
| --- | --- | --- | --- |
| `MAX_AUDIO_DURATION_SECONDS` | 3600 | **300** | DashScope 同步识别时长硬限，301s 即拒（`AUDIO_DURATION_TOO_LONG`） |
| `MAX_UPLOAD_BYTES` | 26214400（25 MiB） | **15728640（15 MiB）** | base64 膨胀 4/3，15 MiB 编码后约 20 MiB，恰为实测 data-uri 上限（20971520 字节） |

**意义**：原默认值（60 分钟 / 25 MiB）会让超限输入一路通过受理，直到转录时才被上游拒绝——错误在链路末端才暴露。收敛到硬限内后，超限在**受理阶段**即被拒（`AUDIO_TOO_LONG` / `FILE_TOO_LARGE`），符合「明确业务错误而非上游报错」的验收要求。

## 4. 与计划的差异：`OPENAI_TRANSCRIBE_*` 移除顺延至 A6-5

计划 A6-2 原文含「移除 `OPENAI_TRANSCRIBE_MODEL` 与 `OPENAI_TRANSCRIBE_TIMEOUT_MS`」，**本任务未执行**。

**原因**：`OpenAITranscriber` 在 A6-5 之前仍由组合根 `buildContainer()` 实例化（`src/bootstrap/container.ts:70`），并消费这两个字段。先删配置字段会导致编译失败；若临时改指向 Qwen 配置，则 A6-2 与 A6-5 之间运行时行为错误。二者必须同批落地。

**处置**：删除动作归入 A6-5（其验收标准本就含「全仓库不再引用 `OpenAITranscriber` 与 `OPENAI_TRANSCRIBE_*`」）。因此 A6-2 后，`OPENAI_TRANSCRIBE_MODEL` 仍在必填之列——这两项**不能**作为已完成的功能宣称。

> **2026-09-25 更新：已随 A6-5 完成。** `OPENAI_TRANSCRIBE_MODEL` / `OPENAI_TRANSCRIBE_TIMEOUT_MS` 已从 `AppConfig` 与 `.env.example` 移除，`OpenAITranscriber` 及其测试已删除，组合根改装配 `QwenAsrTranscriber`。上文「本任务未执行」的描述仅描述 A6-2 当时的状态。

## 5. 决定：`speaker_diarization_enabled` 默认开启

对应实施计划 §9 第 5 项。

**决定**：默认 `true`，经 `QWEN_ASR_SPEAKER_DIARIZATION` 可关闭。

**理由**：关闭时 A6-1 实测全程只返回**单个** `sentence`（如 300s 音频 → 1 段 0~264000ms），拿不到任何静音或说话人边界；开启后返回多段 `sentences[]` 并带 `speaker_id`，段落可天然按说话人边界断开。代价仅为请求多一个参数。

**风险与缓解**：该参数仅 `qwen-audio-3.1-asr-flash` 支持（换模型时需同步调整）；分段质量依赖 A6-3 的重组逻辑，已列在实施计划 §8 风险表首行。

## 6. 验证

```bash
npm run typecheck   # 通过
npm test            # 44 文件 / 327 用例 全绿
npm run verify      # lint + lint:openapi + typecheck + check:docs + check:structure
                    # + 安全豁免 + 测试 + 覆盖率 + web:verify 全绿
```

- 覆盖率：Statements 92.47% / Branch 88.38%（高于 ≥80% 门槛）
- `check:docs`：rule-1 / rule-2 / rule-4 / rule-5 均为 0 问题
- Web：3 文件 / 35 用例通过，构建成功

**两域隔离的部分验证方式**（`tests/unit/config.test.ts`）：

```ts
delete env.DASHSCOPE_API_KEY;   // 断言消息精确等于 'Missing required env var: DASHSCOPE_API_KEY'
delete env.OPENAI_API_KEY;      // 断言消息精确等于 'Missing required env var: OPENAI_API_KEY'
```

## 7. 遗留与提醒

1. **本地 `.env` 仍是旧上限**：`MAX_UPLOAD_BYTES=26214400`、`MAX_AUDIO_DURATION_SECONDS=3600`。`.env` 优先级高于代码默认值，**未同步修改则新默认值不生效**，超限音频会重新变成上游报错。需手工改为 15728640 / 300（或删除这两行以采用默认值）。
2. **`qwen` 域在 A6-3 前无消费者**：属分阶段交付的预期状态（A6-2 ∥ A6-3 本就允许并行），A6-5 完成组合根接线后消除。
3. **启动新增一道要求**：A6-2 起 `DASHSCOPE_API_KEY` 为必填，缺失则启动失败。这是「缺失所需 key 时启动即失败」的预期行为，但也意味着未配置该 key 的环境（含 CI 中直接调用 `loadConfig` 的路径）会立即失败。
4. **`QWEN_ASR_ENDPOINT` 默认值为通用域名，且该域名有时效性**：本任务将默认值定为 `dashscope.aliyuncs.com`（A6-1 实测可用、无需业务空间 ID）。但阿里云公告该域名**自 2026-09-30 起停止新特性**（存量业务兼容），正式与演示环境应改用业务空间专属域名 `{WorkspaceId}.{region}.maas.aliyuncs.com`。**默认值有意保留通用域名**（否则使用者需先填入自己的 WorkspaceId 才能启动），迁移只需改这一个环境变量、无需改代码。详见[实施计划 §2.6](../../records/2026-09-23-qwen-asr-implementation-plan.md)。
