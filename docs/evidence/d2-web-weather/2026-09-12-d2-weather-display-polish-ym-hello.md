# D2 天气结果展示细化：实施证据

- **日期**：2026-09-12
- **责任人**：ym-hello
- **分支**：`feature/d2-weather-copy-polish`（基于 `main` = `cf3d4ab`）
- **范围**：仅 Web 天气面板的文案、成功态双名称展示、状态快照与对应测试/文档；不改动后端接口、`WeatherDto`、OpenAPI schema、错误码、限流与音频模块。

## 修改依据

本轮依据外部人工评审文档 `Web_Workbench_Advice.md`（维护者本机提供）。评审截图位于本机目录 `G:\code\Web\asserts`，**仅用于人工视觉对照，未复制进本仓库**，也不作为自动化截图快照基线。

落地的四项评审建议：

1. 天气面板说明去技术化：改为「查询当前地点天气；输入格式见下方提示。」。
2. 地点输入提示改为可操作建议：「建议输入城市名或“城市+区”，例如 南京市鼓楼区；最多 200 个字符。」。
3. 成功态双名称展示：温度 → 匹配站点 → 你输入的 → 天气描述。
4. idle 反馈区改为带示例的引导文案：「输入城市名或“城市+区”，例如 南京市鼓楼区。」。

## 成功态地点歧义的处理方式

- `weather.location` 是服务端/上游返回的**匹配站点名**（例如 `Pootung`、`Hsinchuangchen` 等英文音译），前端不做中文回译、反向地理编码或行政区划映射，也不引入省市区的三级联动数据。
- 「你输入的」取自新增的前端提交快照 `submittedLocation`，即本次真正提交给接口的原值（展示时才 `trim()`，请求仍发送未 trim 原值，服务端标准化语义不变）。
- 两个名称相同也保持双行显示，只有一套布局；查询成功后继续编辑输入框不会改变已显示结果；重新提交（含重试）会清空旧结果并写入新快照。
- `requestId` 展示策略保持上游现状：天气成功态与错误态**均不渲染** `requestId`，通用 HTTP 客户端对 `X-Request-Id` 的解析与错误 envelope 未改动。

## 代码与文档改动

| 文件 | 改动 |
| --- | --- |
| `web/src/components/WeatherPanel.tsx` | 新增 `submittedLocation` 提交快照；面板说明、输入提示、idle 文案改为面向用户的表述；成功态改为「匹配站点 / 你输入的」双名称结构 |
| `web/src/styles/global.css` | 新增 `.weather-places`、`.place-line:first-child`、`.place-label`、`.place-line strong` 四条规则；断点、`min-height: 196px`、`prefers-reduced-motion` 未改动 |
| `web/src/components/WeatherPanel.test.tsx` | 天气交互测试由 9 项增至 14 项 |
| `docs/records/2026-09-01-d2-web-workbench-visual-design.md` | 升版 v1.4；新增“成功态双名称展示”小节；修正反馈区既有漂移（`min-height: 196px`、桌面 `margin-top: 0`、≤880px 为 `20px`）；状态表与验收清单同步 |
| `docs/evidence/README.md`、`docs/project-division/task-list.md` | 登记本证据并将 D2 天气展示细化标记为已完成 |

未新增 `.ts`/`.tsx` 文件，因此 `docs/project-structure.md` 无需变更（`npm run check:structure` 已通过）。

## 自动化验证

本轮测试全部 mock `fetch`，不访问 wttr.in、OpenAI 或其他外部网络。天气模块新增覆盖：面板文案不含实现者表述、idle 示例文案、成功态双名称且无 `requestId`、编辑输入不改变已提交快照、重新提交清除旧快照与旧读数、`.place-line` 样式静态断言；并保留空白拦截、`INVALID_LOCATION`、`WEATHER_UNAVAILABLE`、`RATE_LIMITED`（含 `Retry-After`）、网络失败、重复提交拦截、重试保留输入、880px 与 `prefers-reduced-motion` 断言不回归。

本机执行结果（2026-09-12）：

- `npm run web:lint`、`npm run web:typecheck`、`npm run web:build`：通过（构建产物 CSS 11.17 kB、JS 215.03 kB）。
- `npm run web:test`：3 个文件 35 项通过（天气 14 / 音频 17 / App 4）。
- `npm run verify`：通过。
  - OpenAPI lint、`check:docs`（rule-1/2/4/5 均为 0）、`check:structure`、`check:security-exceptions`：通过。
  - 后端：41 个文件 301 项测试通过，与本轮前基线一致。
  - 覆盖率：Statements 92.69%、Branches 88.18%、Functions 93.86%、Lines 94.59%，不低于既有门禁。
- `git diff --check`：通过。

## 真实联调与视觉对照

本证据只记录可复现的 mock 自动化测试与构建结果，**不将 mock 画面表述为实时天气服务结果**。人工视觉对照需本机自行启动：先 `npm run dev`，再 `npm --prefix web run dev`，在「天气查询」标签下依次输入 `上海`、`上海市闵行区`、`北京市` 与一个无效地点，确认双名称、成功/失败态均无 `requestId`、idle 示例提示、880px/620px 布局无跳动。若后续形成 D3 可用截图或录屏，须另行记录联调日期、分支/commit 与「真实 API」来源标注。

## 边界与后续接口

- 未实现省/市/区三级联动、地理编码、第三方 UI 库或图标库；未引入外部截图资产。
- 未改动音频模块与 `.pipeline` 进度条样式；音频上传、轮询、摘要与转录仍由 `dorotheaqxq-code` 负责。
- `ym-hello` 后续继续负责 C7 轻量故障运行手册。
