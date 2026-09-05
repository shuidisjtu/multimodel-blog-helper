# Multimodel Blog Helper

> 跟随《零基础自学AI应用开发》(李光毅)学习 AI 应用开发的实践项目。
> 已跑通的教材示例**已随仓库分发**（[`book-examples/`](book-examples/)，chapter-03/04；其余章节已清理）。示例项目的 `.env` 含个人 key **不入库**——首次运行前复制各项目 `.env.example` 为 `.env` 并填写（见"快速开始(教材示例)"）。
>
> 当前阶段：第 3、4 章示例已全部跑通，正整合为可部署的学习研究型 HTTP 服务（见「重构」）。

## 环境

| 组件 | 配置 |
|---|---|
| Python | `book-examples/chapter-03/.venv` 共享环境(openai 2.53.0 + python-dotenv + requests);`.venv` 不入库,克隆后自行创建(uv / 原生 venv / Anaconda 任选,见"快速开始(教材示例)") |
| Node.js | v24,各章节项目自带 `node_modules` |
| LLM API | 第三方中转站 **openai-hk**(`OPENAI_BASE_URL=https://api.openai-hk.com/v1`),key 为 `hk-` 前缀,存于各项目 `.env`(用户自填) |
| 天气 API | 免费无 key 的 **wttr.in**(仅个人/非商业用途) |

## 进度

### 教材学习进度（教程配套示例是重构主线的移植参考，但不直接相关）

| 章节 | 状态 |
|---|---|
| 第 3 章 | 全部跑通(示例:whisper 转录 / 语音合成 / Express 文件上传等) |
| 第 4 章 | 全部跑通(工具调用 / 流式输出 / 路由 / 健壮性) |

**第 4 章关键迁移**:OpenAI 已弃用 Assistants API(threads/runs,将于 2026-08-26 关闭),5 个依赖它的示例全部重写为 **Responses API**:

- `01-01-create-assistant`(助手即配置)
- `01-02-weather-assistant`(工具调用循环 + 真实天气查询)
- `02-01-shownotes-assistant`(Node 流式 shownotes)
- `03-03-router-implement` / `03-04-resilience`(Express 路由集成)

**对原书的本地改造**:
- `04-02-word-timestamp`:中转站无 word 级时间戳,降级为 segment 级
- `01-02-weather-assistant`:天气查询改用 wttr.in(零配置,原书用的 WeatherAPI.com 需注册 key)

**遗留**：05-whisper-API 本地 whisper 模型(需下载 ~2GB,可选,非本项目任务)；第 4 章 04-05 小结的 pm2 示例(05-01-pm2-try)演示需全局安装 pm2(未装,未跑)；第 5 章起未开始。

###  重构主线进度（本仓库的任务,以 task-list.md 为唯一权威参考）

将第 3、4 章示例整合为单机可演示的学习研究型 HTTP 服务：上传音频 → 异步转录 + 摘要 → 查询/下载；另含天气工具调用与 CI。当前已完成 A1–A5、B1–B7、C1、C2；上传/天气接口 IP 限流（429 + 动态 Retry-After）、默认同源 + 白名单 CORS、错误边界与访问日志（统一 `X-Request-Id`、递归日志脱敏、`http.access` 每请求一行）就绪。B7 后端核心闭环已在独立 worktree 完成本机自动化验收；D2 最小 Web 工作台已接入音频上传、Job 轮询与恢复、摘要/转录展示、TXT 下载和天气查询；视觉规范见 [`2026-09-01-d2-web-workbench-visual-design.md`](docs/records/2026-09-01-d2-web-workbench-visual-design.md)。health/metrics 与完整运维治理仍属于后续工作，详见 [`task-list.md`](docs/project-division/task-list.md)。

- **工程架构**：[`docs/architecture/architecture-design.md`](docs/architecture/architecture-design.md)(v1.4)
- **任务计划**：[`docs/project-division/task-list.md`](docs/project-division/task-list.md)(22 项，含验收标准与依赖)
- **决策记录**：[`docs/adr/`](docs/adr/)(0001–0006，含 B6 限流/CORS 安全边界)

## 重构项目快速开始

> 主线代码在 `src/` + `tests/`(TypeScript ESM)。按以下步骤复现后端与 Web 开发环境,约 2 分钟:

```bash
# 1. 获取代码(新队员:从 GitHub 克隆;已在仓库内可跳过)
git clone https://github.com/shuidisjtu/multimodel-blog-helper.git
cd multimodel-blog-helper

# 2. 安装根服务与独立 Web 工作台依赖(要求 Node >= 24;npm ci 按 lock 文件精确安装)
npm ci
npm ci --prefix web

# 3. 配置环境变量(模板见 .env.example;OPENAI_API_KEY 为 openai-hk 中转站 key,`hk-` 前缀,向项目成员获取)
cp .env.example .env      # Windows: copy .env.example .env

# 4. 验证环境就绪(类型检查 + 全部测试 + 覆盖率,全绿即 OK)
npm run verify
```

### 本地启动后端与 Web 工作台

分别在两个终端运行：

```bash
# 终端 1：启动 Express 后端（默认 http://localhost:3000）
npm run dev

# 终端 2：启动 Vite Web 工作台（默认 http://localhost:5173）
npm --prefix web run dev
```

打开 Vite 输出的地址即可访问浅色博客助手工作台。音频任务与天气查询通过标签页切换并保留各自状态；音频面板调用 `/api/v1/audio-jobs` 完成上传、自动轮询、摘要/转录展示与下载，也可通过音频任务编号恢复查询；天气面板请求 `/api/v1/assistant/weather`。开发期均由 Vite `/api` proxy 转发到本地后端。

> **当前阶段说明**：重构主线开发中（A1–A5、B1–B7、C1、C2 已完成；B7 后端核心闭环自动化测试与本机全量门禁已通过；OpenAPI 契约与 B5 契约测试已落地，B4 实时天气演示见 [`docs/evidence/release-b4-20260829/`](docs/evidence/release-b4-20260829/2026-08-29-weather-demo-guide.md)，B1/B2 演示见 [`docs/evidence/release-cbafff1/`](docs/evidence/release-cbafff1/2026-08-24-api-demo-guide.md)，B6a 错误边界/访问日志记录见 [`docs/evidence/b6a-error-access-log/`](docs/evidence/b6a-error-access-log/2026-09-01-b6a-error-boundary-access-log-shuidisjtu.md)，B6b 限流/CORS 记录见 [`docs/evidence/b6b-rate-limit-cors/`](docs/evidence/b6b-rate-limit-cors/2026-09-01-b6b-rate-limit-cors-shuidisjtu.md)，D2 天气模块记录见 [`docs/evidence/d2-web-weather/`](docs/evidence/d2-web-weather/2026-09-01-d2-web-weather-dto-ym-hello.md)，D2 音频主流程与本地联调记录见 [`docs/evidence/d2-web-audio/`](docs/evidence/d2-web-audio/2026-09-05-d2-web-audio-integration.md)）。上面的快速开始验证的是**代码质量与测试环境**（后端与 Web 的依赖/类型/Lint/文档/结构/测试全绿）；`npm run dev` 可启动后端服务（需 `.env` 配置 key，见下），再运行 `npm --prefix web run dev` 启动前端并通过 Vite `/api` 代理访问本地 API。可直接运行的教材示例见下方“快速开始(教材示例)” 。

**环境要求与已知坑**：

- **Node ≥ 24**——`openAsBlob` 等内置 API 依赖新版本；启动时也会校验,版本过低直接报 `ConfigError`。版本不符用 `nvm install 24` / 官网安装包
- `.env` 缺失或 key 未填时,启动会抛 `ConfigError` 并退出,不会带病运行(不会静默缺 key)
- npm 11 的 allow-scripts 会拦 esbuild postinstall——**不影响 vitest/tsx 运行**,可忽略
- Windows 终端中文乱码是 GBK 显示问题(数据正确):先执行 `chcp 65001`；Node 程序需 `cd` 进项目目录再运行(dotenv 从 cwd 找 .env)
- Windows 个别 Node 24 环境可能让 `tsx` 启动时的 `os.userInfo()` 报 `uv_os_get_passwd ENOMEM`；根项目脚本已内置兼容预加载，不需要手工设置临时目录或用户名。

## 快速开始(教材示例)

> 前提：已按上方"重构项目快速开始"克隆仓库；示例代码随仓库分发于 `book-examples/`。

```bash
# 0. 创建共享 Python 环境(book-examples/chapter-03/.venv,三选一,按你的工具习惯)
#    方式 A: uv
#    uv venv book-examples/chapter-03/.venv
#    uv pip install --python book-examples/chapter-03/.venv/Scripts/python.exe openai python-dotenv requests
#    方式 B: 原生 venv(python 需 3.10+)
#    python -m venv book-examples/chapter-03/.venv
#    book-examples/chapter-03/.venv/Scripts/pip install openai python-dotenv requests
#    方式 C: Anaconda(conda 环境激活后直接用 python/pip 命令)
#    conda create -p book-examples/chapter-03/.venv python=3.13 -y
#    conda activate book-examples/chapter-03/.venv
#    pip install openai python-dotenv requests

# Python 示例(以 01-02 为例)
cd book-examples/chapter-04/01-02-weather-assistant
<venv>/Scripts/python.exe main.py     # venv = book-examples/chapter-03/.venv(上一步创建;conda 用户可先 activate 再直接 python main.py)

# Node 示例(以 02-01 为例)
cd book-examples/chapter-04/02-01-shownotes-assistant
node index.js
```

> 首次运行前:复制各项目 `.env.example` 为 `.env` 并填 `OPENAI_API_KEY`(中转站 key)。Node 必须 `cd` 进项目目录再运行(dotenv 从 cwd 找 .env)。主服务在开发模式下仅以项目 `.env` 覆盖 IDE 注入的 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL`；端口、超时、模型等其他配置以及测试/生产环境仍以显式进程变量优先。

## 文档

- [`docs/architecture/architecture-design.md`](docs/architecture/architecture-design.md) — 工程架构设计（分层、状态机、接口契约、防护与观测；重构依据）
- [`docs/project-structure.md`](docs/project-structure.md) — 工程目录结构（代码/测试/文档/运行产物的组织与落地状态）
- [`docs/project-division/task-list.md`](docs/project-division/task-list.md) — 任务清单（任务、验收标准、依赖链）
- [`docs/adr/`](docs/adr/) — 决策记录（ADR-0001~0005）
- [`docs/records/`](docs/records/) — 过程记录与答辩材料
- [`docs/evidence/`](docs/evidence/) — 验收证据归档（运行命令输出、覆盖率记录）
- [`CLAUDE.md`](CLAUDE.md) — 开发协作约定（SDK v2 差异、运行注意事项、中转站限制等），供 Claude Code 读取，该文件未上传到github中
- 本书配套文档与示例细节见各 chapter 目录
