# C4 发布检查单：本地预览

> 状态：待发布。此记录是未提交工作区的本机验收，不能代替未来发布 commit 的 CI 成功记录。

## 执行信息

- 责任人：dorotheaqxq-code；本次操作执行人：Codex（本地代执行），项目成员复核待完成。
- 执行时间：2026-09-22 17:24 +08:00 起。
- 基线 HEAD：`fe699f5cdbee267740cdd72caaae39dc50802df4`；C4 改动尚未提交，制品标为 `release-preview-fe699f5cdbee267740cdd72caaae39dc50802df4`，`manifest.json` 中 `dirty: true`。
- 环境：Windows，Node `v24.20.0`，npm `11.19.0`。

## 本地检查

- [x] 根目录和 Web 目录已用 `npm ci` 安装依赖。
- [x] `npm run release:build -- --allow-dirty` 生成 48 个文件，含后端编译 JS、Web 静态资源、根依赖锁文件、环境模板和 SHA-256 清单；`npm run release:check -- .release/release-preview-fe699f5cdbee267740cdd72caaae39dc50802df4` 通过。
- [x] 同一工作区重复构建，`manifest.json` SHA-256 两次均为 `E0972F55832D88B14F57464D79F9AFDDE3D2398B25EBD14F45382C3F333FDBBF`。
- [x] 将预览制品复制到独立的 `.release/downloaded/` 路径后，`release:check` 仍通过；CI 将对真实上传后下载的 artifact 做同样校验。
- [x] 修改预览制品的 README 后，`release:check` 以退出码 1 拒绝，报 `Release file list or SHA-256 checksums do not match`；已重新构建恢复。
- [x] 未带 `--allow-dirty` 的 `npm run release:build` 以退出码 1 拒绝未提交工作区；原预览制品仍可校验。
- [x] `npm run verify` 最后一轮退出码 0：后端 301 项测试、Web 35 项测试通过；覆盖率 Statements 93.17%、Branches 88.84%、Functions 94.47%、Lines 94.99%。见 [原始输出](2026-09-22-c4-verify-output.txt)。
- [x] `npm run test:b7` 核心闭环 8 项测试通过，见 [原始输出](2026-09-22-c4-b7-output.txt)。
- [x] 从制品副本执行 `npm ci --omit=dev`（98 个生产依赖包），启动编译后的后端并请求本地未知路径，收到 HTTP 404 和 `X-Request-Id`；详见[运行冒烟记录](2026-09-22-c4-runtime-smoke-output.txt)。只使用模板占位 key，没有访问真实上游。
- [x] 本地 `npm audit --audit-level=high` 与 `npm audit --prefix web --audit-level=high` 均退出码 0；Web 无漏洞，根目录报告 3 个中危开发依赖项，未达到当前 CI 的 high 阈值。见[根目录审计输出](2026-09-22-c4-audit-root-output.txt)与[Web 审计输出](2026-09-22-c4-audit-web-output.txt)。
- [ ] GitHub Actions 质量、测试覆盖率、安全扫描、发布制品 job 全绿：未提交，待未来 main push 后填运行链接。
- [ ] 正式 `release-<sha>` artifact 下载、跨环境复现与 SHA-256 比较：待未来发布 commit。
- [ ] 正式执行人、复核人和放行时间：待项目成员检验后填写。

## 核心闭环与版本证据

- B7 已有 [核心闭环自动化验收记录](../b7-core-flow/2026-09-04-b7-core-flow-dorotheaqxq-code.md)，覆盖上传、异步状态、摘要查询、转录下载、非法文件、幂等冲突、队列满、限流、天气和 CORS；外部模型与天气上游使用 fake。
- 当前 C4 [本机 B7 输出](2026-09-22-c4-b7-output.txt) 与 [全量门禁输出](2026-09-22-c4-verify-output.txt) 用于验证当前未提交工作树。
- 功能演示截图按任务清单 §5 放入未来实际版本的 `docs/evidence/release-<sha>/`；当前预览无正式 release SHA，不创建虚假的版本截图目录。

## 发布判定

**待发布**：本地预览可以供检验；C4 的“CI 全绿”与正式 commit SHA 制品须在用户检验、提交并触发 Actions 后再确认。
