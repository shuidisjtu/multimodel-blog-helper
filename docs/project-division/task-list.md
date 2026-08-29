# OpenAI 多模态博客助手：任务清单

> 版本：v1.5 ｜ 用途：展示项目需要完成的工作与验收标准 ｜ 更新：2026-08-24
>
> 分工说明：A 系列与 C1、C2 的 CI 部分已完成（shuidisjtu）。B 系列与 C 系列剩余任务已分配至三名成员（shuidisjtu / ym-hello / dorotheaqxq-code），分工与时序见 §2。

## 1. 任务清单

### 架构与 AI 核心

| 编号 | 任务 | 前置 | 验收标准 | 状态/认领人 |
| --- | --- | --- | --- | --- |
| A1 | 架构 ADR（Responses API、任务异步化、文件存储边界） | — | 每项包含背景、决策、替代方案、后果、复审条件 | ✅ 已完成 |
| A2 | `Transcriber`、`Summarizer` 端口与 OpenAI 适配器 | A1 | 领域层不导入 SDK；可用 fake 实现通过集成测试 | ✅ 已完成 |
| A3 | 音频转录与摘要任务用例 | A1、A2 | Job 状态按 `queued→transcribing→summarizing→succeeded/failed` 迁移；失败可查询；启动恢复（queued 重入队、进行中标记 `PROCESS_INTERRUPTED`） | ✅ 已完成 |
| A4 | 模型调用重试/超时策略 | A1 | 仅网络、429、5xx 重试；最多 3 次；4xx 不重试 | ✅ 已完成 |
| A5 | 核心技术说明与答辩材料 | A2、A3、A4 | 可说明 Assistants API 迁移为 Responses API 的原因与影响 | ✅ 已完成 |

### HTTP 服务、文件与天气能力

| 编号 | 任务 | 前置 | 验收标准 | 状态/认领人 |
| --- | --- | --- | --- | --- |
| B1 | 上传受理接口（`POST /api/v1/audio-jobs`） | A3、B3 | 上传返回 `202`；`Idempotency-Key` 幂等（同 key 同文件返回原 Job，同 key 不同文件 `409`）；队列满返回 `503` | ✅ 已完成 2026-08-24（`npm run verify` 全绿：lint/typecheck/check:docs/check:structure/184 测试/覆盖率 ≥89.7%；幂等重放不受队列满抑制，见提交 e422626） |
| B2 | 任务查询与转录下载（`GET /audio-jobs/{id}`、`/transcript`） | B1 | 可查询状态、摘要并下载转录文本；过期返回 `410 JOB_EXPIRED`（tombstone） | ✅ 已完成 2026-08-24（`npm run verify` 全绿：lint/typecheck/check:docs/check:structure/207 测试/覆盖率 ≥89.7%；jobId 路径注入防御见提交 e9133f2；转录下载实跑见 docs/evidence） |
| B3 | 上传校验与临时文件策略 | A1、A3 | 仅允许约定音频类型；≤25 MB；时长上限（解析失败时降级并记录）；随机存储名；`temp/` Git 忽略；tombstone 二次清理 | ✅ 已完成 |
| B4 | `WeatherProvider` 与天气接口 | — | wttr.in 超时、异常或无效地点返回稳定业务错误，不泄漏上游细节 | ✅ 已完成 2026-08-29（真实 wttr.in 成功/无效地点/超时验证，237 测试与门禁全绿；证据见 [`release-b4-20260829`](../evidence/release-b4-20260829/2026-08-29-weather-demo-guide.md)） |
| B5 | OpenAPI 与 DTO 校验 | B1、B2、B4 | 全部 v1 路由有契约；成功和主要 4xx/5xx 响应一致 | ✅ OpenAPI 契约已落地；DTO 校验/契约测试待 B1–B4 实现后补齐 / ym-hello |
| B6 | 错误中间件、结构化日志与滥用防护 | B1、B4、B5 | async 路由进入统一错误边界；响应有 `X-Request-Id`；上传/天气 IP 限流（`429`，带 `Retry-After`）；CORS 同源策略；metrics 访问边界（仅内网可访问，实现见 C5） | 待办/shuidisjtu |
| B7 | 集成测试 | B1–B6 | 覆盖文件无效、过大、超时、幂等冲突、限流、队列满、天气不可用与成功路径 | 待办/dorotheaqxq-code |

### 质量与交付

| 编号 | 任务 | 前置 | 验收标准 | 状态/认领人 |
| --- | --- | --- | --- | --- |
| C1 | 格式化、Lint、类型检查 CI | — | 全部为必过项，失败不放行 | ✅ 已完成 |
| C2 | 测试与覆盖率 CI（含契约测试） | C1 | 覆盖率阈值对新增/修改代码 ≥80%；OpenAPI 与实际响应一致 | 待办/ym-hello(契约测试;CI 部分已完成) |
| C3 | 安全与 secret 扫描 CI | C1 | 依赖漏洞与 secret 扫描为必过项；临时豁免有 issue 链接、责任人、失效日期 | 待办/dorotheaqxq-code |
| C4 | 构建制品与保留策略 | C2 | 制品带 commit SHA；CI 全绿且本地可复现；artifact 保留策略明确 | 待办/dorotheaqxq-code |
| C5 | 健康监测与指标可视化 | B6 | 实现 `/health/live`、`/health/ready`（语义不同，ready 含 worker 与队列检查）与独立 `/metrics` 服务（`METRICS_PORT`，仅绑 127.0.0.1）；Prometheus 可抓取，Grafana 面板展示核心指标（答辩演示） | 待办/shuidisjtu |
| C6 | E2E 与发布检查单 | C2、B2 | fixture 音频能完成最短闭环；发布检查单有执行人和时间 | 待办/dorotheaqxq-code |
| C7 | 故障运行手册 | C5 | 包含失败判定、日志定位、恢复验证 | 待办/ym-hello |
| C8 | 项目成果归档 | 全部 | CI 日志、测试报告、演示材料均有链接或文件索引 | 待办/dorotheaqxq-code |

## 2. 分工与时序（2026-08-21 分配）

| 成员 | 任务链 | 定位 |
| --- | --- | --- |
| shuidisjtu | B3 → B1 → B2 → B6 → C5 | 音频核心链路（文件校验→上传→查询→防护）+ 健康观测 |
| ym-hello | B4 → B5 → C2(契约测试) → C7 | 能力侧（天气）+ OpenAPI 契约 + 运行手册 |
| dorotheaqxq-code | C3 → C4 → B7 → C6 → C8 | 质量与交付（安全 CI→制品→集成测试→E2E→归档） |

- **OpenAPI 契约已先行**：`src/interfaces/http/openapi.yaml` 已定义 7 个路由、统一 JSON envelope、`X-Request-Id`/`Retry-After`、上传限制、幂等语义及主要错误码；B1/B2/B4 实现与 C2 契约测试必须以该文件为准。

**协作约定**：独立分支 `feature/b*-*` + PR；CI 门禁（C1）为必过项，失败不放行；B5 契约（OpenAPI yaml）先于接口实现评审；任务完成附验收证据（测试/运行记录，见 §3）。

- **推进时序**：T0 三人同时开工（B3 / B4 / C3）；T1 B3+B4 完成，B5 契约草案提交，B1 开工；当前已完成 B3、B5 契约文件、**B1（2026-08-24，`feature/b1-upload-job` 共 9 提交）**、**B2（2026-08-24，`feature/b2-query-transcript` 共 7 提交）** 与 **B4（2026-08-29，真实 wttr.in 成功/无效地点/超时验证，证据见 `docs/evidence/release-b4-20260829/`）**，B6 仍待推进；T2 B1/B2/B4 完成并契约互审；T3 B6 完成、B7 集成测试跑通；T4 C5/C6/C7/C8 收口。

## 3. 执行原则（通用协作底线）

- **童子军原则**：任何成员发现问题都应及时修复或提出；离开时让代码比来时更干净。
- **验收证据**：任务"完成"必须有可运行的证据：测试、接口结果、流水线记录、运行记录或演示截图/视频(便于答辩使用)。
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
| 健康检查与告警记录 | `docs/runbooks/`、`docs/evidence/` |
| 功能演示视频/截图与版本号 | `docs/evidence/release-<sha>/` |

建议证据文件采用 `YYYY-MM-DD-主题-责任人` 命名，并在每个里程碑后编写一页总结：目标、实际结果、问题、解决方案、证据链接、下一步。
