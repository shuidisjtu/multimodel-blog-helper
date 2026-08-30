# 最小 Web 工作台实现设计

> 日期：2026-08-30 ｜ 状态：设计稿 ｜ 关联任务：D1、D2、D3
>
> 本文记录最小工作台的实现方式和验证边界；长期有效的选型原因见 [ADR-0005](../adr/0005-web-workbench-for-defense-showcase.md)，任务依赖见 [`task-list.md`](../project-division/task-list.md)。

## 1. 目标

在不改动现有 Express 领域逻辑的前提下，增加一个单页面浏览器工作台，直观呈现：

```text
选择音频 → 上传 → Job 状态变化 → 摘要/转录结果 → 下载
                                      ↘ 天气查询
```

它既是基本用户交互层，也是答辩 PPT 中可嵌入的真实界面素材。现场实时启动不是硬性要求。

## 2. 前端结构

```text
web/
├── package.json
├── vite.config.ts
├── src/
│   ├── api/              # fetch 客户端、DTO、错误解析
│   ├── components/       # 上传、状态时间线、结果、天气面板
│   ├── App.tsx           # 单页面工作台编排
│   └── styles/           # 普通 CSS 或 CSS Modules
└── tests/                # 关键交互测试（如采用独立测试目录）
```

技术约束：React + Vite + TypeScript；原生 `fetch`；React `useState`/`useEffect`；暂不引入 Redux、React Query 或大型 UI 组件库。开发环境通过 Vite proxy 将 `/api` 转发到 `http://localhost:3000`，生产构建只生成静态文件。

## 3. 页面模块与接口映射

| 页面模块 | 调用接口 | 核心行为 |
| --- | --- | --- |
| 音频上传 | `POST /api/v1/audio-jobs` | 发送 `FormData(file)`，处理 `202`、`jobId` 和错误 envelope |
| 状态时间线 | `GET /api/v1/audio-jobs/{id}` | 定时轮询 `queued`、`transcribing`、`summarizing`，在 `succeeded/failed` 时停止 |
| 结果面板 | 查询接口返回的 `summary` | 成功后展示中文要点摘要和模型信息 |
| 转录下载 | `GET /api/v1/audio-jobs/{id}/transcript` | 使用 `text/plain` 响应下载或预览，不依赖服务器路径 |
| 天气面板 | `POST /api/v1/assistant/weather` | 发送 `{location}`，显示天气 DTO 或 `422/503` 安全错误 |

前端只依赖 OpenAPI 定义的 HTTP envelope，不读取 `temp/`、Job JSON 或上游 wttr.in/OpenAI 字段。

## 4. 交互状态

### 音频任务

```text
idle
  → uploading
  → queued
  → transcribing
  → summarizing
  → succeeded
```

异常分支：

```text
uploading → upload_error
任一处理中状态 → failed
轮询网络异常 → polling_error（可重试）
```

前端必须避免重复提交按钮造成误操作，并在任务成功或失败后停止轮询；页面刷新后不承诺恢复未保存的浏览器状态，可通过任务 ID 重新查询。

### 天气请求

```text
idle → loading → success
             ↘ INVALID_LOCATION / WEATHER_UNAVAILABLE
```

## 5. 真实联调与答辩材料

D2 至少完成一次真实前端 + 本地后端联调，并保留可嵌入 PPT 的结果：

- 音频上传后显示 `202` 和 Job ID；
- 状态时间线显示后台处理阶段；
- 成功后显示摘要并下载转录；
- 天气面板显示成功和稳定失败响应；
- 画面不包含 API key、真实个人数据、服务器路径或内部堆栈。

D3 将 Web 工作台画面、已有 B1/B2/B4 真实证据、架构图和测试数据整合进唯一正式展示物 PPT。录屏或截图只是 PPT 的内嵌元素；现场实时启动仅作为可选加分项。离线 replay 仅在后续风险评估后决定，且必须明确标注为基于真实结果的离线展示。

## 6. 测试边界

前端只覆盖关键交互，不追求全面组件覆盖率：

- 上传成功并保存 `jobId`；
- 轮询在 `succeeded`/`failed` 后停止；
- 成功摘要和转录下载入口显示；
- 统一错误 envelope 能转成用户可读提示；
- 天气成功、无效地点和服务不可用提示。

测试使用 fake fetch 或本地 mock，不调用真实 OpenAI/wttr.in。后端既有 `npm run verify` 仍需保持通过；前端构建和测试脚本应在文档中明确。

## 7. 非目标

- 不实现登录、权限、任务历史、多人协作、多租户或 CMS 发布。
- 不实现完整富文本编辑、SEO/GEO、品牌知识库或文章自动发布。
- 不因前端开发提前实现 metrics、Grafana 或其他长期维护增强。
- 不把“现场实时启动”作为项目完成的必要条件。

