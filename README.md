# Multimodel Blog Helper

> 跟随《零基础自学AI应用开发》(李光毅)学习 AI 应用开发的实践项目。
> 核心能力一句话：上传音频 → 异步转录 + 摘要 → 查询/下载；另含天气工具调用。
> 已跑通的教材示例**随仓库分发**（[`book-examples/`](book-examples/)），示例项目 `.env` 含个人 key **不入库**——首次运行前复制各项目 `.env.example` 为 `.env` 并填写。
> 进度与分工见 [`docs/project-division/task-list.md`](docs/project-division/task-list.md)。

## 环境

| 组件 | 配置 |
|---|---|
| Python | `book-examples/chapter-03/.venv` 共享环境(openai 2.53.0 + python-dotenv + requests);`.venv` 不入库,克隆后自行创建(uv / 原生 venv / Anaconda 任选,见"快速开始(教材示例)") |
| Node.js | v24,各章节项目自带 `node_modules` |
| LLM API | 第三方中转站 **openai-hk**(`OPENAI_BASE_URL=https://api.openai-hk.com/v1`),key 为 `hk-` 前缀,存于各项目 `.env`(用户自填) |
| 天气 API | 免费无 key 的 **wttr.in**(仅个人/非商业用途) |

## 快速开始（主线服务）

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

### 启动

依赖和 `.env` 已配置后，分别在两个终端运行（Windows 的 PowerShell 同样命令即可）：

```bash
# 终端 1：启动 Express 后端（默认 http://localhost:3000）
npm run dev

# 终端 2：启动 Vite Web 工作台（默认 http://localhost:5173）
npm --prefix web run dev
```

等待前端终端显示 `Local: http://localhost:5173/` 后，在浏览器打开 <http://localhost:5173/>。音频上传与天气查询需要两个窗口中的服务同时运行；只查看页面布局时可以只启动前端。开发期均由 Vite `/api` proxy 转发到本地后端。

需要按**编译产物**运行后端时（例如核对发布制品的行为），先构建再启动——`npm start` 读的是 `dist/server/`，未构建就执行会报模块找不到：

```bash
npm run build   # tsc 编译 src -> dist/server
npm start       # 等价于 node dist/server/bootstrap/server.js
```


### 环境要求与已知坑

- **Node ≥ 24**——`openAsBlob` 等内置 API 依赖新版本；启动时也会校验,版本过低直接报 `ConfigError`。版本不符用 `nvm install 24` / 官网安装包
- `.env` 缺失或 key 未填时,启动会抛 `ConfigError` 并退出,不会带病运行(不会静默缺 key)
- npm 11 的 allow-scripts 会拦 esbuild postinstall——**不影响 vitest/tsx 运行**,可忽略
- Windows 终端中文乱码是 GBK 显示问题(数据正确):先执行 `chcp 65001`；Node 程序需 `cd` 进项目目录再运行(dotenv 从 cwd 找 .env)
- Windows 个别 Node 24 环境可能让 `tsx` 启动时的 `os.userInfo()` 报 `uv_os_get_passwd ENOMEM`；根项目脚本已内置兼容预加载，不需要手工设置临时目录或用户名。
- **Windows 本地跑覆盖率偶发 Vitest `Worker exited unexpectedly`**：测试实际全绿，只是 worker 以 `0xC0000409`（Windows 原生层快速失败）退出，令命令返回非零。仅 Windows 本地出现（CI 为 Linux，从未复现）；升级 Vitest 5 后频率降低但未消除。**遇到重跑即可**，非代码缺陷。

## 快速开始（教材示例）

> 前提：已按上方"快速开始(主线服务)"克隆仓库；示例代码随仓库分发于 `book-examples/`。

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

## 教材学习进度

| 章节 | 状态 |
|---|---|
| 第 3 章 | 全部跑通(示例:whisper 转录 / 语音合成 / Express 文件上传等) |
| 第 4 章 | 全部跑通(工具调用 / 流式输出 / 路由 / 健壮性) |

> ⚠️ **转录相关示例现已无法运行**：上表为**当时的运行记录**。中转站 openai-hk 已撤销 `whisper-1` 上游渠道（实测返回 503「当前分组 default 下对于模型 whisper-1 无可用渠道」），以下 6 个示例均硬编码该模型且无回退，**当前运行会失败**：`chapter-03/04-01-transcription`、`04-02-segment-timestamp`、`04-02-word-timestamp`、`chapter-04/03-02-expressjs-upload`、`03-03-router-implement`、`03-04-resilience`。其余示例不受影响；主线服务 `src/` 的转录已于 A6 切换至阿里云百炼千问 ASR，同样不受影响。如需运行这些示例，须自行替换转录实现（本地 Whisper 或国内 ASR 服务）。
>
> 背景见 [issue #16](https://github.com/shuidisjtu/multimodel-blog-helper/issues/16)（已关闭）。

**第 4 章关键迁移**：OpenAI 已弃用 Assistants API(threads/runs,于 2026-08-26 关闭),5 个依赖它的示例全部重写为 **Responses API**：

- `01-01-create-assistant`(助手即配置)
- `01-02-weather-assistant`(工具调用循环 + 真实天气查询)
- `02-01-shownotes-assistant`(Node 流式 shownotes)
- `03-03-router-implement` / `03-04-resilience`(Express 路由集成)

**对原书的本地改造**：

- `04-02-word-timestamp`:中转站无 word 级时间戳,降级为 segment 级
- `01-02-weather-assistant`:天气查询改用 wttr.in(零配置,原书用的 WeatherAPI.com 需注册 key)

**遗留**：`05-whisper-API` 本地 whisper 模型(需下载 ~2GB,可选,非本项目任务)；第 4 章 04-05 小结的 pm2 示例(`05-01-pm2-try`)演示需全局安装 pm2(未装,未跑)；第 5 章起未开始。

## 文档

- [`docs/architecture/`](docs/architecture/) — 架构设计(分层、数据流、状态机、端口)与维护原则
- [`docs/project-structure.md`](docs/project-structure.md) — 工程目录结构(代码/测试/文档/运行产物的组织与落地状态)
- [`docs/project-division/task-list.md`](docs/project-division/task-list.md) — 任务清单、进度与分工(**唯一权威**)
- [`docs/adr/`](docs/adr/) — 决策记录(ADR-0001~0006)
- [`docs/records/`](docs/records/) — 过程记录与答辩材料
- [`docs/evidence/`](docs/evidence/) — 验收证据归档(运行命令输出、覆盖率记录)
- [`docs/release-checklist.md`](docs/release-checklist.md) — C4 正式发布检查单模板
- [`docs/release-runtime.md`](docs/release-runtime.md) — C4 制品复现与运行说明
- [`CLAUDE.md`](CLAUDE.md) — 开发协作约定(SDK v2 差异、运行注意事项、中转站限制等),供 Claude Code 读取,该文件未上传到 GitHub
- 本书配套文档与示例细节见各 chapter 目录
