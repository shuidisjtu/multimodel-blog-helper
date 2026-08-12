# Multimodel Blog Helper

> 跟随《零基础自学AI应用开发》(李光毅)学习 AI 应用开发的实践项目。
> 已跑通的教材示例保留在 [`source_code/`](source_code/)(chapter-03/04;其余章节已清理,E 盘有原版备份)。
>
> 当前阶段：第 3、4 章示例已全部跑通，正整合为可部署的学习研究型 HTTP 服务（见「重构」）。

## 环境

| 组件 | 配置 |
|---|---|
| Python | `source_code/chapter-03/.venv` 共享环境(openai 2.53.0 + python-dotenv + requests),由 uv 管理 |
| Node.js | v24,各章节项目自带 `node_modules` |
| LLM API | 第三方中转站 **openai-hk**(`OPENAI_BASE_URL=https://api.openai-hk.com/v1`),key 为 `hk-` 前缀,存于各项目 `.env`(用户自填) |
| 天气 API | 免费无 key 的 **wttr.in**(仅个人/非商业用途) |

## 进度

### ✅ 已完成

| 章节 | 状态 |
|---|---|
| 第 3 章 | 全部跑通(示例:whisper 转录 / 语音合成 / Express 文件上传等) |
| 第 4 章 | 全部跑通(工具调用 / 流式输出 / 路由 / 健壮性) |

**第 4 章关键迁移**:OpenAI 已关闭 Assistants API(threads/runs,2026-04),5 个依赖它的示例全部重写为 **Responses API**:

- `01-01-create-assistant`(助手即配置)
- `01-02-weather-assistant`(工具调用循环 + 真实天气查询)
- `02-01-shownotes-assistant`(Node 流式 shownotes)
- `03-03-router-implement` / `03-04-resilience`(Express 路由集成)

**对原书的本地改造**:
- `04-02-word-timestamp`:中转站无 word 级时间戳,降级为 segment 级
- `01-02-weather-assistant`:天气查询改用 wttr.in(零配置,原书用的 WeatherAPI.com 需注册 key)

### ⏳ 待办

| 事项 | 说明 |
|---|---|
| 05-whisper-API(第 3 章遗留) | 本地 whisper 模型,需下载 ~2GB |
| 第 5 章起 | 未开始;05-01 需 `npm install -g pm2`(部署演示) |

### 🔧 重构(规划中)

将第 3、4 章示例整合为可部署的学习研究型 HTTP 服务：上传音频 → 异步转录 + 摘要 → 查询/下载；另含天气工具调用、健康监测与 CI。方案与计划已冻结，按任务清单驱动：

- **工程架构**：[`docs/architecture/architecture-design.md`](docs/architecture/architecture-design.md)(v1.3)
- **任务计划**：[`docs/project-division/task-list.md`](docs/project-division/task-list.md)(21 项，含验收标准与依赖)

## 快速开始

```bash
# Python 示例(以 01-02 为例)
cd source_code/chapter-04/01-02-weather-assistant
<venv>/Scripts/python.exe main.py     # venv = source_code/chapter-03/.venv

# Node 示例(以 02-01 为例)
cd source_code/chapter-04/02-01-shownotes-assistant
node index.js
```

> 首次运行前:在各项目 `.env` 中填 `OPENAI_API_KEY`(中转站 key)。Node 必须 `cd` 进项目目录再运行(dotenv 从 cwd 找 .env)。

## 文档

- [`docs/architecture/architecture-design.md`](docs/architecture/architecture-design.md) — 工程架构设计（分层、状态机、接口契约、防护与观测；重构依据）
- [`docs/project-division/task-list.md`](docs/project-division/task-list.md) — 任务清单（任务、验收标准、依赖链）
- [`CLAUDE.md`](CLAUDE.md) — 开发协作约定（SDK v2 差异、运行注意事项、中转站限制等），供 Claude Code 读取
- 本书配套文档与示例细节见各 chapter 目录
