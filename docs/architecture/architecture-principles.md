# 架构维护原则

> 本文档回答「设计上不可违反的护栏」与「如何防止架构腐朽」。当前架构「为什么这样组织」见 [`architecture.md`](architecture.md)；每条护栏背后的取舍见 [`docs/adr/`](../adr/)。

## 1. 架构原则（不可违反）

### 1.1 依赖向内

HTTP、OpenAI、文件系统、天气站点都属于基础设施；业务用例不得直接依赖 Express SDK 或 `fetch`。

- **为什么**：把「业务规则」与「外部世界」隔离，业务逻辑才能被纯函数化测试（本仓库单测零 `vi.mock`，全靠端口注入）。
- **违反的代价**：用例一旦 import `fetch`/`express`，单测就必须 mock 网络/框架，测试变慢、变脆，业务与供应商绑定后难以切换（如 Assistants API → Responses API 迁移）。
- **反例**：在 `application/` 里直接 `fetch('https://wttr.in/...')`，而不是调用 `WeatherProvider` 端口。

### 1.2 一个概念一个真相源

任务状态、文件元数据、错误码、API 契约各自只能有一个定义位置。

- **为什么**：同一事实多处维护必然漂移，最终没人知道哪个是对的。
- **权威映射**：任务状态/进度 → `task-list.md`；API 契约 → `openapi.yaml`；目录结构 → `project-structure.md`；端口 → `domain/ports.ts`；取舍 → `docs/adr/`。
- **反例**：既在架构文档里抄一份环境变量表，又在 `config.ts`/`.env.example` 里各维护一份。

### 1.3 同步入口，异步耗时工作

上传接口只负责受理；转录/摘要不占用 HTTP 请求生命周期。

- **为什么**：转录耗时分钟级，长连接同步会占满 HTTP worker、超时不可控，也无法追踪进度。
- **实现**：`202` 受理 + 内存队列 + 固定并发 worker + 轮询查询（见 [`architecture.md` §2.1](architecture.md) 与 ADR-0004）。
- **反例**：在请求处理函数里 `await` 完整转录再返回结果。

### 1.4 契约先行且可验证

对外 REST 契约由 `openapi.yaml` 定义；请求校验、集成测试和文档由该契约约束。

- **为什么**：契约是前后端、测试、文档的公共锚点；先定契约再实现，可并行开发并避免「实现即契约」的隐性漂移。
- **实现**：`openapi.yaml` 是唯一权威；`tests/contract/openapi-contract.test.ts` 用 ajv 按契约校验真实响应。
- **反例**：路由里返回一个 openapi 没定义的字段/错误码，契约测试却仍然通过。

### 1.5 失败显式化

不吞异常、不以 `null` 代替失败（唯一例外：时长探测降级，见 `AudioDurationProbe`）；统一映射为稳定错误码与可关联的 `requestId`。

- **为什么**：静默失败无法排查、无法重试、也无法向上游问责。
- **实现**：`domain/errors.ts` 的 `ErrorCode` 与 HTTP 状态一一映射；未知错误 `500 INTERNAL_ERROR`，不泄漏堆栈。
- **反例**：`catch {}` 后返回成功空对象；把上游报错原文直接透传进响应体。

### 1.6 可删除性优先

新增临时字段、兼容分支、功能开关必须指定责任人、删除条件和最晚删除版本。

- **为什么**：只增不减的「疤痕组织」会让系统无法演进（ADR 治理术语）。
- **实现**：临时字段须在 ADR/代码注释中写明删除条件与负责人。
- **反例**：为兼容某中间态加一个 `if (legacy)` 分支，却没有任何「何时删」的记录。

### 1.7 示例与产品隔离

`book-examples/chapter-*` 保持为教材验证证据；生产服务只复用经适配器封装后的逻辑。

- **为什么**：教材示例是「如何学」的证据，产品代码是「如何用」的工程；混用会让示例被产品约束（或反之）扭曲。
- **反例**：把教材里 `audio/*` 的宽松 MIME 前缀匹配直接搬进产品接口（产品有意收紧为白名单）。

## 2. 防腐化治理

### 2.1 决策记录与变更规则

在 `docs/adr/` 保存 ADR，文件名 `NNNN-短标题.md`，包含：背景、决策、备选方案、后果、不可做事项、触发复审的条件。当前 ADR：

- ADR-0001：以 Responses API 替代已关闭的 Assistants API。
- ADR-0002：短期使用 `temp/` + 文件任务仓储，切换边界是 `FileStore/JobRepository`。
- ADR-0003：wttr.in 经 `WeatherProvider` 隔离，禁止其返回结构扩散。
- ADR-0004：音频处理采用后台任务而非长连接同步请求。
- ADR-0005：新增独立 `web/` 最小工作台作答辩交互层，不引入 Redux/Next.js/完整 CMS。
- ADR-0006：路由级 IP 限流 + 白名单 CORS（默认同源、禁 `*`）。

任一 PR 若改变端口、公开 API、状态机、存储策略、重试语义或安全边界，必须同步更新 ADR / OpenAPI / 测试；代码评审清单中明确检查这一项。

### 2.2 架构测试（可执行规则）

- `domain/**` 不得导入 `express`、`openai`、`multer`、`fs` 或 `infrastructure/**`。
- `application/**` 只能依赖 `domain/**` 与 `shared/**`。
- `interfaces/http/**` 不得导入 `infrastructure/**`，只能调用 application 用例。
- 每个 `/api/v1` 路由必须有 OpenAPI 定义及至少一个集成测试。
- 每个新环境变量必须进入配置 schema 与 `.env.example`，不得散落读取 `process.env`（集中 `config.ts`）。

用 dependency-cruiser、ESLint import rules 或同等工具在 CI 强制执行；规则本身需定期审阅误报，不能永久 `skip`。

### 2.3 代谢节奏

每个里程碑/阶段结束时进行 30 分钟架构健康检查（冲刺期可按需加密）：删除已过期 feature flag/字段；审查 90 天无人改动但稳定的模块是否可版本化封装；核对运行日志高频错误；核对 ADR 与实现是否仍一致。每次检查产出一条 `docs/records/` 下 `YYYY-MM-DD-architecture-health.md` 命名的记录，包含结论、证据、责任人与截止日。
