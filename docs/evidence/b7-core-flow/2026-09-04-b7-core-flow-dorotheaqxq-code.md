# B7 核心闭环集成验证 — 本机验收记录

> 日期：2026-09-04 ｜ 责任人：dorotheaqxq-code ｜ 分支：`feature/b7-core-flow`
>
> 基线：本 worktree 从本地缓存的 `origin/main`（`341005650096779eb32a10d9059951df32868b23`）创建。由于当前环境未获准访问 GitHub，未能 fetch 更新的远端 main；该限制不影响本次测试使用的本地基线。

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
| 全量门禁 | `npm run verify` | ✅ passed（299 后端测试、覆盖率 Statements 93.10%） |
| GitHub Actions | PR/main run | ⏳ 尚未创建 PR；不得据此宣称 CI 通过 |

原始专用测试输出见 [`2026-09-04-b7-test-output.txt`](./2026-09-04-b7-test-output.txt)。

## 完成判定

- [x] 独立 `feature/b7-core-flow` worktree 和测试装配器已建立。
- [x] 真实 HTTP/文件仓储/队列/Worker 的核心闭环已通过。
- [x] 计划中的异常、防护、天气和 CORS 场景已通过。
- [x] `npm run verify` 全量门禁通过：299 后端测试、Web 9 测试、覆盖率所有指标高于 80%。
- [ ] 新分支 PR 创建并通过 GitHub Actions 全量门禁。
- [ ] 将 PR、Actions run 和最终 commit SHA 补入本记录与证据索引。
- [ ] 完成上述远端证据后，才把 `task-list.md` 中 B7 标记为完成。

## 可选真实实跑

本记录不把真实 OpenAI 或 wttr.in 调用写成已通过。若答辩需要，可在本地配置环境变量后按独立演示指引执行；脚本输出不得包含 API key。
