# C4 可复现制品与发布检查里程碑

> 日期：2026-09-22 ｜ 责任人：dorotheaqxq-code ｜ 状态：本地实现待复核，正式 CI 与发布待提交后确认

## 目标

为单机演示版生成带完整 commit SHA 的可校验制品，并让发布候选 job 仅在质量、测试覆盖率与安全门禁全绿后运行；为每次发布留下执行人、时间和核心闭环证据。

## 实际结果

- 新增后端 TypeScript 编译配置与 `release:build`、`release:check`，清单记录每个文件的 SHA-256；未提交工作区自动标为 `dirty` 预览，正式构建拒绝脏工作区。
- `main` push 的发布候选 job 依赖质量、测试、依赖审计和 Secret Scan，上传名为 `release-<完整 SHA>` 的 artifact，并下载回校验，确认隐藏的环境模板与其他文件均完整。PR 的 Dependency review 继续由现有门禁执行。
- 制品仅包含编译后端、Web 静态资源、依赖锁文件、配置模板和运行说明；部署时重新按 lock 安装生产依赖。
- 本地双次构建清单哈希一致，篡改文件被校验拒绝；`npm run verify` 通过，后端 301 项、Web 35 项测试通过，覆盖率 Statements 93.17%。当前工作未提交，故没有新的 Actions 成功运行或正式 release SHA。
- 制品副本按锁文件安装生产依赖后可启动编译后的后端；本地 HTTP 请求得到 404 与请求 ID。根目录及 Web 的 high 阈值依赖审计退出码均为 0，根目录另有 3 个中危开发依赖项。

## 问题与解决

- GitHub Actions 无法在未提交改动上提供真实结果。检查单保留 CI、下载 artifact 和最终签字为待办，避免将本机预览声称为正式发布。
- 未提交改动会使 HEAD SHA 与工作区内容不完全对应。生成器拒绝普通 `release:build`，只有显式 `--allow-dirty` 才产生 `release-preview-<sha>` 并在清单标记 `dirty: true`。

## 证据

- [本地发布检查单](../evidence/c4-release/2026-09-22-c4-release-checklist-dorotheaqxq-code.md)
- [全量门禁原始输出](../evidence/c4-release/2026-09-22-c4-verify-output.txt)
- [B7 核心闭环复验输出](../evidence/c4-release/2026-09-22-c4-b7-output.txt)
- [制品运行冒烟记录](../evidence/c4-release/2026-09-22-c4-runtime-smoke-output.txt)
- [根目录审计输出](../evidence/c4-release/2026-09-22-c4-audit-root-output.txt)与[Web 审计输出](../evidence/c4-release/2026-09-22-c4-audit-web-output.txt)
- [B7 既有闭环验收记录](../evidence/b7-core-flow/2026-09-04-b7-core-flow-dorotheaqxq-code.md)

## 下一步

项目成员检验本地改动后再提交。提交后的 `main` push 应记录 Actions 运行链接，下载 `release-<sha>` 并比对清单，最后填写[正式发布检查单模板](../release-checklist.md)和同版本的功能截图索引。
