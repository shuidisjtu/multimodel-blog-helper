# D2 Web 工作台骨架与天气/DTO 模块：实施证据

- **日期**：2026-09-01
- **责任人**：ym-hello
- **分支**：`feature/d2-web-weather-dto`
- **范围**：D2 的共享 React 工作台骨架、天气查询与前端 DTO/HTTP 解析；不包含音频上传、Job 轮询、转录下载、B7 或 C7。

## 交付内容

1. 新增独立 `web/` React + Vite + TypeScript 包，并保留自己的 `package-lock.json`。
2. 浏览器仅使用相对路径 `POST /api/v1/assistant/weather`；Vite 开发服务器将 `/api` 代理到 `http://localhost:3000`，不依赖开发期 CORS 放行。
3. 新增浅色博客助手共享外壳与明确的音频模块接入槽位。音频区域只说明后续接入合同，不提供或伪装任何上传、轮询、下载能力。
4. 天气面板支持本地空白/200 字符输入提示、请求中防重复提交、成功数据与 `requestId` 展示，以及 `INVALID_LOCATION`、`WEATHER_UNAVAILABLE`、`RATE_LIMITED`、网络/未知失败的安全映射和原地点重试。
5. 通用 HTTP 客户端只解析 OpenAPI 对应的成功/错误 envelope、`X-Request-Id` 与可选 `Retry-After`；不向 UI 暴露原始错误体、上游消息、服务器路径或环境信息。
6. 视觉事实源已归档于 [`docs/records/2026-09-01-d2-web-workbench-visual-design.md`](../../records/2026-09-01-d2-web-workbench-visual-design.md)：浅色博客助手风格、蓝绿色品牌高亮、响应式双栏/单栏、可访问性与音频接入边界均有明确定义。

## 自动化验证

本分支的天气交互测试全部 mock `fetch`，不访问 wttr.in、OpenAI 或其他外部网络。覆盖的关键场景包括：

- 空白输入不发请求；
- 成功 DTO、温度/描述和 `requestId` 渲染；
- `422 INVALID_LOCATION`、`503 WEATHER_UNAVAILABLE`、`429 RATE_LIMITED`（含 `Retry-After`）；
- 网络失败安全降级；
- 加载时重复提交拦截；
- 失败后重试保留原地点；
- 880px 移动端单列断点与 `prefers-reduced-motion` 规则。

本机执行结果（2026-09-01）：

- `npm run check:docs`：通过（rule-1/2/4/5 均为 0）。
- `npm run check:structure`：通过（结构文档保持最新）。
- `npm run verify`：通过。
  - 后端：291 项测试通过。
  - 覆盖率：Statements 92.61%、Branches 88.41%、Functions 93.82%、Lines 94.54%。
  - Web：lint、typecheck、生产 build、9 项 Vitest 测试全部通过。
- `git diff --check`：通过。

其中 `npm run verify` 会委托执行 Web 的 `lint`、`typecheck`、`build` 和 `test`，GitHub Actions 的两个 job 也会先安装 `web/` 依赖并执行对应质量门禁与测试。

## 真实联调边界

本证据仅记录可复现的本地 mock 测试与构建，不将 mock 画面称为实时服务结果。真实后端联调应在配置好本地服务后执行：先运行 `npm run dev`，再运行 `npm --prefix web run dev`，通过 Vite `/api` 代理查询天气。若要形成 D3 可用的真实展示截图或录屏，须另行记录联调时间、后端运行状态与 API 响应，并明确区分真实结果和离线展示。

## 后续接口

- `dorotheaqxq-code` 在此共享布局中接入音频上传、Job 轮询、摘要/转录展示与下载。
- `shuidisjtu` 负责 D2 跨模块集成验收与 D3 展示叙事。
- `ym-hello` 后续继续负责 C7 轻量故障运行手册。
