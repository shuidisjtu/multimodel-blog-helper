# OpenAI 多模态博客助手：任务清单

> 版本：v1.7 ｜ 用途：展示项目需要完成的工作与验收标准 ｜ 更新：2026-08-31
>
> 分工说明：A 系列与 C1、C2 的覆盖率 CI 部分已完成。以下清单按 2026-08-30 的实际实现、单机答辩标准和四周倒排重排；health/metrics 与完整运维治理明确延期。分工与时序见 §2。

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
| B5 | 接口 DTO 与契约测试 | B1、B2、B4 | 对现有 `/api/v1` 路由校验请求/响应 DTO、状态码、错误 envelope 与媒体类型；OpenAPI 与实际响应一致 | ✅ 已完成 2026-08-31 / ym-hello（共享 HTTP schemas、OpenAPI lint 与 OpenAPI 驱动的 263 项测试；证据见 [`2026-08-30-b5-dto-contract-tests.md`](../evidence/api-contract/2026-08-30-b5-dto-contract-tests.md)） |
| B6a | 错误边界与访问日志 | B1、B2、B4 | async 路由统一进入错误边界；响应有 `X-Request-Id`；访问日志记录脱敏路径、方法、状态、耗时与 requestId | 🔶 requestId、错误中间件和基础日志已完成；访问日志/递归脱敏待补齐 / shuidisjtu |
| B6b | 限流与 CORS | B5 | 上传/天气接口 IP 限流（`429`、动态 `Retry-After`）；默认同源，跨域仅白名单；有自动化测试 | 待办/shuidisjtu |
| B7 | 核心闭环集成验证 | B5、B6a、B6b | 覆盖上传→异步状态迁移→查询摘要→下载转录；并覆盖非法文件、幂等冲突、队列满、限流、天气成功/失败与 CORS | 待办/dorotheaqxq-code |

### 质量与交付

| 编号 | 任务 | 前置 | 验收标准 | 状态/认领人 |
| --- | --- | --- | --- | --- |
| C1 | 格式化、Lint、类型检查 CI | — | 全部为必过项，失败不放行 | ✅ 已完成 |
| C2 | 测试与覆盖率 CI（含契约测试） | C1、B5 | 保持覆盖率阈值 ≥80%；契约测试进入 CI；当前 263 项测试与覆盖率基线持续通过 | ✅ 已完成 2026-08-31 / ym-hello（CI 执行 OpenAPI lint、契约测试与覆盖率） |
| C3 | 安全与 secret 扫描 CI | C1 | 依赖漏洞与 secret 扫描为必过项；临时豁免有 issue 链接、责任人、失效日期 | 待办/dorotheaqxq-code |
| C4 | 可复现制品与发布检查 | C2、B7 | 制品带 commit SHA；CI 全绿且本地可复现；发布检查单记录执行人、时间和核心闭环证据 | 待办/dorotheaqxq-code |
| C5 | 健康与指标（长期增强） | B6a | `/health/live`、`/health/ready` 与独立 `/metrics`；Prometheus/Grafana 仅在实际部署需要时实施 | ⏸️ 延期，不阻塞单机答辩 / shuidisjtu |
| C7 | 轻量故障运行手册 | B6a、B7 | 包含失败判定、日志定位、任务恢复、临时文件清理和重启后验证 | 待办/ym-hello |

### Web 工作台与答辩展示（D）

| 编号 | 任务 | 前置 | 验收标准 | 状态/优先级 |
| --- | --- | --- | --- | --- |
| D1 | 展示目标与叙事设计 | A5、B1、B2、B4 | 明确产品场景、三项已实现能力、技术主线、当前边界和后续方向；确定 PPT 结构与必展示证据 | 🔶 初始设计已完成，答辩 storyboard 待收口 / shuidisjtu |
| D2 | 最小 Web 工作台 | B1、B2、B4、D1 | 独立 `web/` 前端真实调用现有 API；音频上传、Job 轮询、摘要/转录展示、下载和天气查询；关键交互有 mock 测试；第 2 周末未完成真实联调时降级为 API 真实证据 | 待办/P0；音频主流程：dorotheaqxq-code；天气/DTO：ym-hello；集成验收：shuidisjtu |
| D3 | PPT 汇报材料与证据整合 | D1 | PPT 为唯一正式展示物，嵌入 Web 画面或真实 API 截图/录屏、架构图、状态机、测试数据、问题解决与后续方向；无运行环境时仍可完成展示 | 待办/P0；主责 shuidisjtu，全员提供证据 |

> D2 的现场实时启动和离线 replay 均不是硬性验收条件。离线 replay 仅作为可选备用；PPT 中必须明确区分真实运行结果与离线展示。D2 若在第 2 周结束时未完成真实联调，D3 使用真实 API 截图/录屏完成正式展示。

## 2. 分工与时序（2026-08-21 分配）

| 成员 | 任务链 | 定位 |
| --- | --- | --- |
| shuidisjtu | B6a → B6b → D1 → D2 集成 → D3 | 后端防护、展示叙事、前端集成与最终验收 |
| ym-hello | B5 → C2 → C7 → D2 天气/DTO | OpenAPI 契约、CI 收口、运行手册与天气前端 |
| dorotheaqxq-code | C3 → C4 → B7 → D2 音频主流程 | 安全/制品、核心闭环验证与音频前端 |

- **OpenAPI 契约已先行**：`src/interfaces/http/openapi.yaml` 已定义现有 v1 API 与后续 health/metrics 规划；B1/B2/B4 的实际实现与 C2 契约测试必须以该文件中标为已实现的接口为准。health/metrics 标为 planned，不得作为当前功能宣称。

**协作约定**：独立分支 `feature/b*-*` + PR；CI 门禁（C1）为必过项，失败不放行；B5 契约（OpenAPI yaml）先于接口实现评审；任务完成附验收证据（测试/运行记录，见 §3）。

- **四周倒排**：第 1 周完成清单校准、B5、D1 收口和 D2 骨架/mock 联调；第 2 周完成 B6a/B6b、D2 音频/天气模块和 B7 主场景；第 3 周完成 D2 真实联调、C2、C3/C4/C7 以及 D3 初稿；第 4 周完成 D3 定稿、全量验证、真实录屏/截图、风险修复和缓冲。第 2 周末 D2 未能真实联调时，立即按 API 证据降级。

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
| 健康检查与告警记录（长期增强） | `docs/runbooks/`、`docs/evidence/` |
| 功能演示视频/截图与版本号 | `docs/evidence/release-<sha>/` |

建议证据文件采用 `YYYY-MM-DD-主题-责任人` 命名，并在每个里程碑后编写一页总结：目标、实际结果、问题、解决方案、证据链接、下一步。
