# D2 Web 音频主流程接入证据

- 日期：2026-09-05（Asia/Shanghai）
- 分支：`feature/d2-web-audio-integration`
- 基线：`bf5fa74`；本记录对应未提交的功能工作区，未虚构 feature commit SHA
- 原始联调记录：[`2026-09-05-d2-web-audio-live-output.txt`](2026-09-05-d2-web-audio-live-output.txt)

## 完成范围

- `multipart/form-data` 音频上传，客户端自动生成并在上传重试时复用 `Idempotency-Key`。
- 上传后立即查询，之后每 2 秒无重叠轮询；成功、失败、查询错误或三分钟超时后停止。
- Job ID 恢复、处理中时间线、稳定中文错误、requestId、摘要和模型展示。
- 成功后按需加载 `text/plain` 转录，并从已加载文本生成 UTF-8 TXT 下载。
- 所有音频 URL 限制为同源 `/api/v1/audio-jobs/...`，UI 不展示原始错误体或服务器路径。
- 保持既有天气模块、880px/620px 响应式断点、ARIA 状态反馈与减少动画规则。

## 自动化验证

`npm run verify` 在本机通过：

- 根项目 lint、OpenAPI lint、typecheck、文档、结构和安全例外检查通过。
- 后端：41 个测试文件、299 项测试通过。
- 覆盖率：Statements 92.61%、Branches 88.41%、Functions 93.82%、Lines 94.54%。
- Web：lint、typecheck、生产 build 通过；2 个测试文件、26 项测试通过，其中 17 项覆盖音频主流程。
- `git diff --check` 另行执行并要求通过。

Web mock 测试覆盖 202/200 上传、FormData 与幂等键、网络重试、状态轮询、成功/失败终态、404/410、Job ID 恢复、查询暂停、三分钟超时、按需转录、Blob 下载、限流及信息隐藏；既有 9 项天气测试保持通过。

## 本地真实链路联调

请求从浏览器工作台与脚本通过 Vite `http://127.0.0.1:5173/api` 代理进入真实 Express 服务。真实本地组件包括上传校验、文件存储、内存队列、Worker、Job 仓储、查询接口和转录下载接口。

联调结果：上传返回 202；观察到 `transcribing` 并到达 `succeeded`；成功 DTO 含摘要、模型与 transcriptUrl；转录返回 200 和 23 字符纯文本；不支持媒体类型返回 415 `UNSUPPORTED_MEDIA_TYPE` 且具有 requestId。浏览器随后通过 Job ID 恢复该任务，展示摘要，并在用户点击后展示转录与 TXT 下载按钮。

## 外部服务边界

本机没有配置可用的 OpenAI API key。为验证真实前端、HTTP、文件与异步处理链路，本次转录和 Responses 上游使用 `127.0.0.1:4010` 的临时确定性 OpenAI 兼容 stub。它没有访问公网，也不构成真实 OpenAI 模型调用证据。既有真实 OpenAI 后端演示仍以 `docs/evidence/release-cbafff1/` 为准；若答辩要求当前版本的公网模型截图，应在单独配置有效凭据后补跑并另行归档。
