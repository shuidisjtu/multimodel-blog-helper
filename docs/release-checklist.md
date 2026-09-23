# C4 发布检查单

每次正式发布复制本检查单到 `docs/evidence/release-<sha>/`，以 `YYYY-MM-DD-c4-release-checklist-责任人.md` 命名，填写真实执行人、时间、完整 commit SHA、Actions 运行链接和核心闭环证据。任何一项未通过时保持「待发布」，不得把本地未提交预览写成正式 release。

## 版本与执行

- 执行人：
- 执行时间与时区：
- 发布 commit SHA（40 位）：
- Actions `main` push 运行链接：
- Actions artifact 名称：`release-<sha>`
- 制品 `manifest.json` 的 `commit`、`dirty`、文件 SHA-256 校验结果：

## 必过项

- [ ] 从上述 SHA 的干净检出执行 `npm ci` 与 `npm ci --prefix web`。
- [ ] 本地 `npm run verify` 全绿，记录测试数与覆盖率，附原始输出。
- [ ] `npm run test:b7` 的上传→状态迁移→摘要查询→转录下载通过；记录错误与防护场景结果，附测试输出或实跑证据。
- [ ] `npm run release:build` 生成 `release-<sha>`，`npm run release:check -- .release/release-<sha>` 通过。
- [ ] Actions 的 Static quality gates、Tests and coverage、Dependency audit、Secret scan、Reproducible release candidate 均成功；PR 的 Dependency review 结果如适用也已记录。
- [ ] 下载的 artifact 文件清单和 SHA-256 与 `manifest.json` 一致；本地按相同 SHA 重建后文件哈希一致。
- [ ] `.env`、密钥、`node_modules`、运行期 `temp/` 不在制品中。

## 结论

- 结论：待发布 / 放行 / 阻塞
- 问题与处理：
- 核心闭环证据链接：
- 门禁、覆盖率与安全扫描证据链接：
- 制品或功能演示截图、视频索引：
- 复核人和时间：
