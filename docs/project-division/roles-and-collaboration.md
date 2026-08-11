# OpenAI 多模态博客助手：项目分工与协作执行文档

> 版本：v1.0 ｜ 适用阶段：第 3、4 章能力已验证后的工程整合、测试与交付阶段 ｜ 更新：2026-08-11

## 1. 执行原则

- 每项工作有明确 **DRI（直接责任人）** 作为最终兜底；协作人可参与，但不替代验收责任。
- 模块按分工建议划分关注人，**非排他**：任何成员都可修改任何区域，跨模块或较大改动先与相关成员沟通。
- **童子军原则**：任何成员发现问题都应及时修复或提出，不等待 DRI 到场；离开时让代码比来时更干净。
- “完成”必须有可运行的验收证据：测试、接口结果、流水线记录、运行记录或演示截图/视频。
- 遇到阻塞先记录风险，再决定升级、拆分或降级；不得以静默跳过门禁的方式“完成”。

## 2. 角色与责任边界

| 成员 | 主要职责（DRI） | 协作范围 |
| --- | --- | --- |
| Zhang Yichao | 总体方案、架构 ADR、OpenAI SDK 与 Responses API 适配、音频转录、摘要、系统集成、技术文档 | 联调、核心测试、答辩技术材料；可介入任意模块 |
| Qiu Wenxi | GitHub Actions、构建制品、CI 质量门禁、健康监测、运行告警 | 错误处理、E2E、项目总结 |
| Luan Yumin | Express API、上传/文件存储、天气 API 适配、路由、输入校验、统一错误响应、接口测试 | 系统联调、功能测试 |

> 以上为**默认分工而非排他边界**：DRI 仅表示该模块的最终责任兜底人，成员之间可交叉协助、互相补位，实际贡献以提交与验收记录为准。

## 3. 代码与文档分工建议

> 本表用于向成员展示各自重点关注的区域，**不是权限规定**：任何成员都可以修改任何区域；发现问题及时修复（童子军原则），改动较大时先与主要关注人沟通。实际贡献以提交记录为准。

| 区域 | 主要关注人 | 关键产物 |
| --- | --- | --- |
| `src/domain/`、`src/application/` | Zhang Yichao | Job 状态机、端口、转录/摘要用例 |
| `src/infrastructure/openai/` | Zhang Yichao | Responses API、转录、摘要适配器 |
| `src/interfaces/http/`、`src/infrastructure/storage/` | Luan Yumin | 路由、OpenAPI、上传校验、temp 文件仓储 |
| `src/infrastructure/weather/` | Luan Yumin | wttr.in 适配器、超时与降级 |
| `src/shared/`（日志、错误、请求 ID） | Luan Yumin | 错误中间件、日志格式、请求追踪 |
| `.github/workflows/`、监控配置 | Qiu Wenxi | CI、制品、健康检查 |
| `tests/` | 按改动区域跟进 | 单元、集成、E2E、测试报告 |
| `docs/adr/`、`docs/runbooks/`、`docs/records/` | Zhang Yichao | ADR、运行手册、关键节点记录 |
| `openapi.yaml` | Luan Yumin | API 契约与接口示例 |

## 4. 工作包与验收

### WP-01：架构与 AI 核心

**DRI：Zhang Yichao；协作：Luan Yumin；验收：Qiu Wenxi**

| 编号 | 交付物 | 验收标准 |
| --- | --- | --- |
| A1 | 架构 ADR（Responses API、任务异步化、文件存储边界） | 每项包含背景、决策、替代方案、后果、复审条件 |
| A2 | `Transcriber`、`Summarizer` 端口与 OpenAI 适配器 | 领域层不导入 SDK；可用 fake 实现通过集成测试 |
| A3 | 音频转录与摘要任务用例 | Job 状态按 `queued→transcribing→summarizing→succeeded/failed` 迁移；失败可查询 |
| A4 | 模型调用重试/超时策略 | 仅网络、429、5xx 重试；最多 3 次；4xx 不重试 |
| A5 | 核心技术说明与答辩材料 | 可说明 Assistants API 迁移为 Responses API 的原因与影响 |

### WP-02：HTTP 服务、文件与天气能力

**DRI：Luan Yumin；协作：Zhang Yichao；验收：Qiu Wenxi**

| 编号 | 交付物 | 验收标准 |
| --- | --- | --- |
| B1 | `POST /api/v1/audio-jobs` 与任务查询/下载接口 | 上传返回 202；可查询状态、摘要并下载转录文本 |
| B2 | 上传与临时文件策略 | 仅允许约定音频类型；≤25 MB；随机存储名；`temp/` Git 忽略；过期可清理 |
| B3 | `WeatherProvider` 与天气接口 | wttr.in 超时、异常或无效地点返回稳定业务错误，不泄漏上游细节 |
| B4 | OpenAPI 与 DTO 校验 | 全部 v1 路由有契约；成功和主要 4xx/5xx 响应一致 |
| B5 | 错误中间件和结构化日志 | 所有 async 路由进入统一错误边界；响应有 `X-Request-Id` |
| B6 | 集成测试 | 覆盖文件无效、过大、未就绪、天气不可用与成功路径 |

### WP-03：质量、交付与运行

**DRI：Qiu Wenxi；协作：全员；验收：Zhang Yichao**

| 编号 | 交付物 | 验收标准 |
| --- | --- | --- |
| C1 | GitHub Actions CI | 格式化、Lint、类型检查、测试、覆盖率、安全/secret 扫描全部为必过项 |
| C2 | CI 流水线与构建制品 | 制品带 commit SHA；CI 全绿且本地可复现 |
| C3 | 健康监测与指标可视化 | `/health/live` 和 `/health/ready` 语义不同；`/metrics` 可被 Prometheus 抓取，Grafana 面板展示核心指标（答辩演示） |
| C4 | E2E 与发布检查单 | fixture 音频能完成最短闭环；上线前检查单有执行人和时间 |
| C5 | 故障运行手册 | 包含失败判定、日志定位、恢复验证 |
| C6 | 项目成果归档 | CI 日志、测试报告、演示材料均有链接或文件索引 |

## 5. RACI 矩阵

标记：R=执行，A=最终负责，C=咨询，I=知会。

| 活动 | Zhang | Qiu | Luan |
| --- | :---: | :---: | :---: |
| 架构决策与 ADR | A/R | C | C |
| OpenAI/Responses API、转录、摘要 | A/R | I | C |
| Express 路由与 OpenAPI | C | I | A/R |
| 文件上传、temp 清理 | C | I | A/R |
| 天气工具与数据适配 | C | I | A/R |
| 统一错误中间件、请求 ID | C | C | A/R |
| 单元/集成测试 | A/R | C | A/R |
| CI 质量门禁 | C | A/R | C |
| 监测、告警 | I | A/R | C |
| E2E、上线验收 | A | R | R |
| 答辩材料与过程记录 | A/R | R | R |

## 6. 依赖关系与交接件

| 上游交付 | 交接人 | 下游接收人 | 交接内容 | 接收标准 |
| --- | --- | --- | --- | --- |
| AI 端口与 fake 实现 | Zhang | Luan | TypeScript 接口、错误类型、fixture 约定 | HTTP 层可 mock 运行，不依赖真实 API |
| HTTP/OpenAPI 契约 | Luan | Zhang、Qiu | 路由、DTO、状态码、错误码 | 集成测试与 CI 的契约检查通过 |
| 日志/健康端点 | Luan | Qiu | endpoint、日志字段、错误码说明 | 监控探测可配置，日志可按 requestId 查询 |
| CI 流水线 | Qiu | 全员 | 失败输出、门禁规则、artifact 路径 | 任一成员能在 PR 中定位失败类别 |
| E2E 与测试报告 | Qiu | Zhang | 版本 SHA、测试结果 | 技术负责人确认可复现 |

交接必须以 PR、Issue 或 `docs/records/` 记录为准，禁止只通过口头或即时消息完成。

## 7. 执行节奏

### 常规（每周两次线上同步，每次 10–15 分钟）

- 各 DRI 更新：昨日完成、今日计划、阻塞项、是否影响依赖；里程碑冲刺期加密为每日。
- 阻塞超过 1 个工作日即创建 Issue；涉及密钥、费用、外部服务不可用时立即通知全员。
- 合并前至少由一位成员（通常为区域主要关注人）完成评审。

### 里程碑节奏

- 工作包/里程碑开始：确认交付物、依赖和可验收演示场景。
- 工作包/里程碑结束：完整联调一次（上传→转录→摘要→查询/下载；天气→错误降级）；Qiu 发布 CI/测试摘要；Zhang 主持架构健康检查（30 分钟，见架构文档 §11.3）；Luan 更新 API 变更记录。

### 发布前

1. Luan 完成接口契约与集成测试确认。
2. Zhang 完成模型行为、失败语义与架构决策确认。
3. Qiu 完成 CI 全绿、健康监测与本地运行确认。
4. 三人共同签署发布检查单；任一关键项未完成则不发布。

## 8. 缺陷与变更处理

### 8.1 缺陷分级

| 级别 | 示例 | 首响/处理目标 | 负责人 |
| --- | --- | --- | --- |
| P0 | 服务不可用、密钥泄露、数据误删 | 立即响应；停止发布 | Qiu 协调，相关模块 DRI 修复 |
| P1 | 核心音频流程大面积失败 | 2 个工作日内定位并修复或回滚 | Zhang / Luan |
| P2 | 单一接口异常、可绕过问题 | 本周内排期 | 对应模块 DRI |
| P3 | 文案、低风险优化 | 纳入迭代 backlog | 对应模块 DRI |

### 8.2 变更控制

以下变更必须先建 ADR 或设计 Issue，再编码：公开 API、Job 状态机、OpenAI 模型/网关、存储策略、重试语义、CI 门禁、数据保留期和告警阈值。每个临时兼容分支或 feature flag 须写明删除人、删除条件和最晚删除日期。

## 9. 答辩与过程证据清单

| 证据 | 责任人 | 存放建议 |
| --- | --- | --- |
| 需求、分工和里程碑 | Zhang | `docs/records/` |
| 架构图、ADR、接口文档 | Zhang / Luan | `docs/architecture/`、`docs/adr/` |
| API 测试与异常处理截图 | Luan | `docs/evidence/` |
| CI 成功记录、覆盖率与安全扫描 | Qiu | Actions artifact + `docs/evidence/` |
| 健康检查与告警记录 | Qiu | `docs/runbooks/`、`docs/evidence/` |
| 功能演示视频/截图与版本号 | 全员 | `docs/evidence/release-<sha>/` |

建议证据文件采用 `YYYY-MM-DD-主题-责任人` 命名，并在每次里程碑后编写一页总结：目标、实际结果、问题、解决方案、证据链接、下一步。

## 10. 完成定义

每个工作包在以下条件同时满足时关闭：

- DRI 提交并合并代码/文档；
- 验收人依据本文件的验收标准给出通过记录；
- 测试与 CI 门禁通过，或存在已批准且有失效日期的豁免；
- 相关 OpenAPI、ADR、运行手册与答辩证据已同步；
- 下游交接人确认已接收且可独立复现。

