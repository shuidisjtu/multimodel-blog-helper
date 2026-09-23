# 发布制品运行说明

本目录由 `npm run release:build` 生成。`manifest.json` 记录完整 commit SHA、是否为未提交预览，以及每个文件的 SHA-256。CI 只上传 `dirty: false` 的 `release-<sha>` 制品；本地 `--allow-dirty` 生成 `release-preview-<sha>`，不可当成该提交的正式制品。

## 复现与校验

1. 检出 `manifest.json` 中的完整 `commit`。要求 Node.js ≥ 24。
2. 在仓库根目录执行 `npm ci`、`npm ci --prefix web`、`npm run verify`。
3. 执行 `npm run release:build`。在 `.release/release-<sha>/` 运行 `npm run release:check -- .release/release-<sha>`，比较 `manifest.json` 的文件列表与 SHA-256。请在同一操作系统与 Node 24 环境下比较构建输出。
4. GitHub Actions 的 `Reproducible release candidate` 仅在 `main` 推送的静态检查、测试与覆盖率、依赖审计、Secret Scan 全部成功后上传同名 artifact，并立即下载、重新校验文件清单与 SHA-256。

## 运行

在制品根目录执行 `npm ci --omit=dev`，复制 `.env.example` 为 `.env`，填写实际配置并设置 `NODE_ENV=production`，然后执行 `npm start` 启动后端。`web/dist/` 是已编译的静态站点文件；部署时由静态文件服务器提供，并将 `/api` 代理到后端。运行期 `temp/` 数据、`.env`、`node_modules` 不包含在制品中。

这个制品是单机演示版的发布候选包，核心闭环的自动化验收使用确定性 fake 上游；真实 OpenAI 和 wttr.in 演示需要单独记录。
