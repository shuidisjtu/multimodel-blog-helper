# C4 发布检查单：正式发布

> 对应 main 提交 `ea9979b332f73638f10e684e74fdf71ad9015736`（`Feature/c4 release (#17)`，squash 合并）。本单是 C4 的**正式发布**检查单，取代 `c4-release/` 目录下此前的本地预览检查单。

## 版本与执行

- 执行人：shuidisjtu（经 Claude Code 代执行；C4 实现为 dorotheaqxq-code，两轮修复与最终验收收尾为 shuidisjtu）
- 执行时间与时区：2026-09-24 +08:00（CI run 完成于 2026-09-23T15:26:14Z）
- 发布 commit SHA（40 位）：`ea9979b332f73638f10e684e74fdf71ad9015736`
- Actions `main` push 运行链接：<https://github.com/shuidisjtu/multimodel-blog-helper/actions/runs/35881539816>
- Actions artifact 名称：`release-ea9979b332f73638f10e684e74fdf71ad9015736`（153636 字节）
- 制品 `manifest.json`：`commit` = `ea9979b…`、`dirty` = `false`、48 个 payload 文件；本地 Windows 重建与 CI Linux 下载版逐文件 SHA-256 **一致**（跨平台可复现）

## 必过项

- [x] 从上述 SHA 的干净检出执行 `npm ci` 与 `npm ci --prefix web`（CI 各 job 与本地均完成）。
- [x] 本地 `npm run verify` 全绿：315 项后端测试（42 文件）+ 35 项 Web 测试；覆盖率 Statements 92.69% / Branches 88.18% / Functions 93.86% / Lines 94.59%（阈 ≥80%）。原始输出见 CI 的 Tests and coverage job。
- [x] `npm run test:b7` 核心闭环 8 项通过（上传 → 状态迁移 → 摘要查询 → 转录下载），并覆盖错误与防护场景。
- [x] `npm run release:build` 生成 `release-<sha>`，`npm run release:check -- .release/release-<sha>` 通过（48 文件、清单与磁盘自洽、无 `.env`/`node_modules`/`temp`）。
- [x] Actions 六 job：Static quality gates / Tests and coverage / Dependency audit / Secret scan / **Reproducible release candidate** 均 success；Dependency review 为 PR-only，在 `main` push 上 skipped（设计如此）。
- [x] 下载的 artifact 文件清单和 SHA-256 与 `manifest.json` 一致；本地 Windows 按相同 SHA 重建后，用 `release:check --expect` 与 CI Linux 下载版比对**逐文件一致**（跨平台字节级可复现）。
- [x] `.env`、密钥、`node_modules`、运行期 `temp/` 不在制品中（`release:check` 已自动拒绝这三类条目）。

## 结论

- 结论：**放行**
- 问题与处理：C4 实现（dorotheaqxq-code）经两轮修复后收口——`180994a` 修正制品入口路径、补充 `--expect` 外部锚点与启动冒烟；`8c469a4` 收紧校验，堵住端口占用假通过、锚点自指同义反复、无内容黑名单等路径。最终在 `main` push 上首次真实执行 `Reproducible release candidate` 成功，全部门禁与可复现性达标。
- 核心闭环证据链接：<https://github.com/shuidisjtu/multimodel-blog-helper/actions/runs/35881539816>；既有 B7 闭环验收见 [`../b7-core-flow/2026-09-04-b7-core-flow-dorotheaqxq-code.md`](../b7-core-flow/2026-09-04-b7-core-flow-dorotheaqxq-code.md)。
- 门禁、覆盖率与安全扫描证据链接：<https://github.com/shuidisjtu/multimodel-blog-helper/actions/runs/35881539816>
- 制品或功能演示截图、视频索引：本次无截图；制品为单机演示版发布候选包，真实 OpenAI / wttr.in 演示需单独记录（见 `release-runtime.md`）。
- 复核人和时间：shuidisjtu，2026-09-24 +08:00
