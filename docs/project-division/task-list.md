# OpenAI 多模态博客助手：任务清单

> 版本：v1.8 ｜ 用途：展示项目需要完成的工作与验收标准 ｜ 更新：2026-09-24
>
> 分工说明：A/B/C 系列已全部完成。**中期答辩聚焦后端与核心功能**（音频转录为带时间戳文本 + 摘要生成），配可观测指标可视化；前端页面展示与 health/metrics 端点明确滞后。

> **范围与非目标**：整合教材第 3、4 章示例为可部署的学习研究型 HTTP 服务（音频转录/摘要 + 天气）。永久非目标：账户、付费、多租户、长期对象存储、数据库集群。部署边界：仅本地/演示单机部署，提供 CI 与健康监测，不承诺 CD 与 staging。
>
> **已知差异**：`/health/*`、`/metrics` 契约已声明但未实现（C6 延期，答辩不需要实时监控面板）。

## 1. 任务清单

### 已完成（架构与 AI 核心 · HTTP/文件/天气 · 质量交付 · 可观测指标）

> A/B/C 系列已全部完成，验收证据归档于 `docs/evidence/`。下表仅保留结果摘要，验收细节见各证据链接。

| 编号 | 任务 | 验收结果 |
| --- | --- | --- |
| A1 | 架构 ADR | 背景/决策/替代方案/后果/复审条件齐备（`docs/adr/`） |
| A2 | Transcriber/Summarizer 端口与 OpenAI 适配器 | 领域层不导入 SDK |
| A3 | 转录与摘要任务用例 | 状态机 `queued→transcribing→summarizing→succeeded/failed` + 启动恢复 |
| A4 | 模型调用重试/超时策略 | 仅网络/429/5xx 重试，≤3 次 |
| A5 | 核心技术说明 | Assistants API→Responses API 迁移说明 |
| B1 | 上传受理接口 | `202` / 幂等 / `409` / 队列满 `503` |
| B2 | 查询与转录下载 | 全状态查询 + `410 JOB_EXPIRED` tombstone |
| B3 | 上传校验与临时文件策略 | MIME/大小/时长校验 + tombstone 二次清理 |
| B4 | 天气接口 | wttr.in 稳定错误映射（[证据](../evidence/release-b4-20260829/2026-08-29-weather-demo-guide.md)） |
| B5 | 接口 DTO 与契约测试 | OpenAPI 驱动契约测试（[证据](../evidence/api-contract/2026-08-30-b5-dto-contract-tests.md)） |
| B6a | 错误边界与访问日志 | `X-Request-Id` + 脱敏访问日志 |
| B6b | 限流与 CORS | `429` / `Retry-After` / 白名单（[证据](../evidence/b6b-rate-limit-cors/2026-09-01-b6b-rate-limit-cors-shuidisjtu.md)） |
| B7 | 核心闭环集成验证 | 上传→状态迁移→查询→下载全场景（`docs/evidence/b7-core-flow`） |
| C1 | 格式化/Lint/类型检查 CI | 必过项 |
| C2 | 测试与覆盖率 CI | 阈值 ≥80% |
| C3 | 安全与 secret 扫描 CI | 依赖审计 / Gitleaks / 过期豁免校验 |
| C4 | 可复现制品与发布检查 | commit SHA 制品 + 检查单（[证据](../evidence/release-ea9979b332f73638f10e684e74fdf71ad9015736/2026-09-24-c4-release-checklist-shuidisjtu.md)） |
| C5 | 模型调用用量指标采集与落盘 | 每次成功任务落盘一行用量指标（摘要 token、转录字数/时长、端到端延迟）到 `<tempDir>/metrics/usage.jsonl`；有单元测试；PPT 阶段据此出图 |

### 待办与延期

| 编号 | 任务 | 前置 | 验收标准 | 状态/认领人 |
| --- | --- | --- | --- | --- |
| A6 | 千问 ASR 替代 whisper-1（**恢复转录 + 带时间戳**） | A2、A3 | **P0：whisper-1 已失效、转录完全不可用，首要目标是恢复转录能力。** 选定方案 C——国内百炼 `qwen-audio-3.1-asr-flash` 同步接口 + base64；**转录返回句级时间戳**（API 原生给词级，须按标点重组，§2.3）；单 provider，删除已不可用的 `OpenAITranscriber`；摘要保持 `gpt-4o`；上限按实测定为**时长 300s / 原始 15 MiB**（§2.5）；接入域名注意时效性——`dashscope.aliyuncs.com` 自 2026-09-30 起停止新特性，正式/演示环境改用业务空间专属域名，`QWEN_ASR_ENDPOINT` 一键切换（§2.6）。已拆为 7 个有依赖关系的子任务：**A6-1 可行性确认 ✅ → A6-2 配置 ✅ ∥ A6-3 适配器 → A6-4 测试 → A6-5 注入与下线 ∥ A6-6 文档 → A6-7 联调**；前置/说明/验收标准/预估见[实施计划](../records/2026-09-23-qwen-asr-implementation-plan.md) §4 与 §7（依据**仅限国内站官方文档** + [A6-1 实测](../evidence/a6-1-qwen-asr-feasibility/2026-09-25-a6-1-qwen-asr-feasibility-shuidisjtu.md) + [A6-2 证据](../evidence/a6-2-config-boundaries/2026-09-25-a6-2-config-boundaries-shuidisjtu.md)） | 🟡 A6-1、A6-2 已完成（2026-09-25）；**A6-3 起待认领**，合计约 4–6.5 人日、剩余约 3–5 人日 / A6-1、A6-2 shuidisjtu |
| C6 | 健康与指标端点（长期增强） | B6a | `/health/live`、`/health/ready` 与 `/metrics`；Prometheus/Grafana 仅实际部署需要时实施 | ⏸️ 延期，不阻塞答辩 / shuidisjtu |
| C7 | 轻量故障运行手册 | B6a、B7 | 失败判定、日志定位、任务恢复、临时文件清理和重启后验证 | 待办 / ym-hello |

### Web 工作台与答辩展示（D，中期聚焦后端，前端滞后）

| 编号 | 任务 | 前置 | 验收标准 | 状态/优先级 |
| --- | --- | --- | --- | --- |
| D1 | 展示目标与叙事设计 | A5、B1、B2、B4 | 聚焦后端与核心功能（带时间戳转录 + 摘要）与指标可视化；确定 PPT 结构与必展示证据 | 🔶 storyboard 待收口 / shuidisjtu |
| D2 | 最小 Web 工作台 | B1、B2、B4、D1 | 独立 `web/` 前端真实调用现有 API（音频上传、Job 轮询、摘要/转录、天气） | 🚧 滞后（中期不展示前端，降级为 API 真实证据） |
| D3 | PPT 汇报材料与证据整合 | D1 | PPT 唯一正式展示物，嵌入真实 API 截图/录屏、架构图、状态机、指标图表、测试数据 | 待办/P0；主责 shuidisjtu，全员提供证据 |

> 中期答辩不展示前端页面；D3 用真实 API 截图/录屏 + 指标落盘数据出图完成展示。现场实时启动与离线 replay 均非硬性验收条件，PPT 中须明确区分真实运行结果与离线展示。

## 2. 分工与时序（2026-09-24 调整）

| 成员 | 当前任务链 | 定位 |
| --- | --- | --- |
| shuidisjtu | C5 指标落盘（已完成）→ A6 千问 ASR → D1 → D3 | 指标可视化、核心功能增强、展示叙事与最终验收 |
| ym-hello | C7 运行手册 → D2 天气（滞后） | 运维文档与天气前端 |
| dorotheaqxq-code | C4 收尾（已完成）→ D2 音频主流程（滞后） | 制品/发布与音频前端 |

- **中期答辩重心**：后端与核心功能（带时间戳转录 + 摘要），天气简单展示，配可观测指标可视化。
- **前端（D2）滞后**：不阻塞答辩，降级为 API 真实证据。
- **OpenAPI 契约已先行**：`src/interfaces/http/openapi.yaml` 已定义现有 v1 API 与后续 health/metrics 规划；health/metrics 标为 planned，不得作为当前功能宣称。

**协作约定**：独立分支 `feature/b*-*` + PR；CI 门禁（C1）为必过项，失败不放行；B5 契约（OpenAPI yaml）先于接口实现评审；任务完成附验收证据（测试/运行记录，见 §3）。

## 3. 执行原则（通用协作底线）

- **童子军原则**：任何成员发现问题都应及时修复或提出；离开时让代码比来时更干净。
- **验收证据**：任务"完成"必须有可运行的证据：测试、接口结果、流水线记录、运行记录或演示截图/视频(便于答辩使用)。原 C8 的归档要求并入本规则：所有证据均需提供链接或文件索引。
- **阻塞升级**：遇到阻塞先记录风险，再决定升级、拆分或降级；不得以静默跳过门禁的方式"完成"。
- 跨模块或较大改动先与相关成员沟通。

## 4. 缺陷分级（处理目标参考）

| 级别 | 示例 | 处理目标 |
| --- | --- | --- |
| P0 | 服务不可用、密钥泄露、数据误删 | 立即响应；停止发布 |
| P1 | 核心音频流程大面积失败 | 当日响应，2 个工作日内给出修复或回滚方案 |
| P2 | 单一接口异常、可绕过问题 | 本周内排期 |
| P3 | 文案、低风险优化 | 纳入迭代 backlog |

## 5. 答辩与过程证据清单

| 证据 | 存放建议 |
| --- | --- |
| 需求、分工和里程碑 | `docs/records/` |
| 架构图、ADR、接口文档 | `docs/architecture/`、`docs/adr/` |
| API 测试与异常处理截图 | `docs/evidence/` |
| CI 成功记录、覆盖率与安全扫描 | Actions artifact + `docs/evidence/` |
| 可观测指标落盘与出图脚本 | `<tempDir>/metrics/` + `docs/evidence/` |
| 健康检查与告警记录（长期增强） | `docs/runbooks/`、`docs/evidence/` |
| 功能演示视频/截图与版本号 | `docs/evidence/release-<sha>/` |

建议证据文件采用 `YYYY-MM-DD-主题-责任人` 命名，并在每个里程碑后编写一页总结：目标、实际结果、问题、解决方案、证据链接、下一步。
