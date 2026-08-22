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

将第 3、4 章示例整合为可部署的学习研究型 HTTP 服务：上传音频 → 异步转录 + 摘要 → 查询/下载；另含天气工具调用、健康监测与 CI。方案与计划已冻结，按任务清单驱动。当前进度：**A1–A5 与 B3 已完成**(架构 ADR / OpenAI 适配器 / 任务用例 / 重试超时策略 / 答辩材料 / 上传校验与临时文件策略,158 测试,覆盖率全维度 ≥80%)；下一步 B1(上传受理接口)。

- **工程架构**：[`docs/architecture/architecture-design.md`](docs/architecture/architecture-design.md)(v1.3)
- **任务计划**：[`docs/project-division/task-list.md`](docs/project-division/task-list.md)(20 项，含验收标准与依赖)

## 重构项目快速开始

> 主线代码在 `src/` + `tests/`(TypeScript ESM)。按以下三步复现开发环境,约 2 分钟:

```bash
# 1. 获取代码(新队员:从 GitHub 克隆;已在仓库内可跳过)
git clone https://github.com/shuidisjtu/multimodel-blog-helper.git
cd multimodel-blog-helper

# 2. 安装依赖(要求 Node >= 24;npm ci 按 lock 文件精确安装)
npm ci

# 3. 配置环境变量(模板见 .env.example;OPENAI_API_KEY 为 openai-hk 中转站 key,`hk-` 前缀,向项目成员获取)
cp .env.example .env      # Windows: copy .env.example .env

# 4. 验证环境就绪(类型检查 + 全部测试 + 覆盖率,全绿即 OK)
npm run verify
```

> **当前阶段说明**：重构主线仍在开发中（A1–A5 与 B3 完成，HTTP 接口层 B1 上传受理待实现）。上面的快速开始验证的是**环境就绪**（依赖/配置/测试全绿）；服务功能演示（上传音频 → 异步转录/摘要 → 查询下载）将在 B 系列完成后补充。可直接运行的教材示例见下方"快速开始(教材示例)"。

**环境要求与已知坑**：

- **Node ≥ 24**——`openAsBlob` 等内置 API 依赖新版本；启动时也会校验,版本过低直接报 `ConfigError`。版本不符用 `nvm install 24` / 官网安装包
- `.env` 缺失或 key 未填时,启动会抛 `ConfigError` 并退出,不会带病运行(不会静默缺 key)
- npm 11 的 allow-scripts 会拦 esbuild postinstall——**不影响 vitest/tsx 运行**,可忽略
- Windows 终端中文乱码是 GBK 显示问题(数据正确):先执行 `chcp 65001`；Node 程序需 `cd` 进项目目录再运行(dotenv 从 cwd 找 .env)

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

> 首次运行前:复制各项目 `.env.example` 为 `.env` 并填 `OPENAI_API_KEY`(中转站 key)。Node 必须 `cd` 进项目目录再运行(dotenv 从 cwd 找 .env)。

## 文档

- [`docs/architecture/architecture-design.md`](docs/architecture/architecture-design.md) — 工程架构设计（分层、状态机、接口契约、防护与观测；重构依据）
- [`docs/project-structure.md`](docs/project-structure.md) — 工程目录结构（代码/测试/文档/运行产物的组织与落地状态）
- [`docs/project-division/task-list.md`](docs/project-division/task-list.md) — 任务清单（任务、验收标准、依赖链）
- [`docs/adr/`](docs/adr/) — 决策记录（ADR-0001~0004）
- [`docs/records/`](docs/records/) — 过程记录与答辩材料
- [`docs/evidence/`](docs/evidence/) — 验收证据归档（运行命令输出、覆盖率记录）
- [`CLAUDE.md`](CLAUDE.md) — 开发协作约定（SDK v2 差异、运行注意事项、中转站限制等），供 Claude Code 读取，该文件未上传到github中
- 本书配套文档与示例细节见各 chapter 目录
