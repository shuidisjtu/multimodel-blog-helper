# B7 核心闭环集成验证 — 本机验收记录

> 日期：2026-09-04 ｜ 责任人：dorotheaqxq-code ｜ 分支：`feature/b7-core-flow`
>
> 基线：`feature/b7-core-flow` 直接建立在当前 `main`（`341005650096779eb32a10d9059951df32868b23`）上。B7 与尚未合并的 C3 分支相互独立，两者共同祖先均为该 main 提交。

## 范围

B7 使用真实 HTTP、文件仓储、文件存储、内存队列和 Worker，使用确定性 fake 替换 OpenAI、wttr.in 与时长探针。测试不访问公网、不读取 API key、不产生模型费用。

覆盖范围：

- 音频上传 → `queued` → `transcribing` → `summarizing` → `succeeded` → 摘要查询 → 转录下载。
- 非法音频、处理失败可查询、同 key 重放、幂等冲突、队列满及回滚。
- 上传/天气独立 IP 限流、动态 `Retry-After`、查询不受上传限流影响。
- 天气成功、无效地点、上游异常和安全错误 envelope。
- 白名单 CORS、预检、非白名单 Origin 和默认同源策略。

## 本机执行结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| B7 专用测试 | `npm run test:b7` | ✅ 8 tests passed |
| 类型检查 | `npm run typecheck` | ✅ passed |
| Lint | `npm run lint` | ✅ passed |
| 全量门禁 | `npm run verify` | ✅ 独立 main 基线上通过（299 后端测试、覆盖率 Statements 92.61%） |
| GitHub Actions | PR/main run | N/A（按要求不提交 GitHub；本机门禁已通过） |

初始专用测试原始输出见 [`2026-09-04-b7-test-output.txt`](./2026-09-04-b7-test-output.txt)。
初始全量输出见 [`2026-09-04-verify-output.txt`](./2026-09-04-verify-output.txt)；最终独立 main 基线复验及 C3 兼容性结果见 [`2026-09-04-main-b7-verify-summary.txt`](./2026-09-04-main-b7-verify-summary.txt)。

> 环境说明：本机 Node 24.20.0 在 `tsx` 启动时调用 Windows `os.userInfo()` 返回 `uv_os_get_passwd ENOMEM`。为验证项目本身，执行全量门禁前只临时修改了 ignored 的 `node_modules/tsx` 运行文件，将用户名回退到环境变量；命令结束后已恢复依赖文件。CI/Linux 不需要该临时处理。

## 完成判定

- [x] 独立 `feature/b7-core-flow` worktree 和测试装配器已建立。
- [x] 真实 HTTP/文件仓储/队列/Worker 的核心闭环已通过。
- [x] 计划中的异常、防护、天气和 CORS 场景已通过。
- [x] `npm run verify` 全量门禁通过：299 后端测试、Web 9 测试、覆盖率所有指标高于 80%。
- [x] 按当前范围不创建 PR、不提交 GitHub；本机 `npm run verify` 作为正式验收证据。
- [x] 独立 main 基线上的 B7 实现提交 SHA 已记录：`5bb93bb`。
- [x] 与 C3 `06def5b` 的合并树预演无冲突；组合结果同时保留 B7 测试入口和 C3 安全门禁。
- [x] `task-list.md` 中 B7 已标记为本机完成。

## 可选真实实跑

本记录不把真实 OpenAI 或 wttr.in 调用写成已通过。若答辩需要，可在本地配置环境变量后按独立演示指引执行；脚本输出不得包含 API key。
