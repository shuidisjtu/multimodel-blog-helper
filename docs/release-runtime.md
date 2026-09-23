# 发布制品运行说明

本目录由 `npm run release:build` 生成。`manifest.json` 记录完整 commit SHA、是否为未提交预览，以及每个文件的 SHA-256。CI 只上传 `dirty: false` 的 `release-<sha>` 制品；本地 `--allow-dirty` 生成 `release-preview-<sha>`，不可当成该提交的正式制品。

## 复现与校验

1. 检出 `manifest.json` 中的完整 `commit`。要求 Node.js ≥ 24。
2. 在仓库根目录执行 `npm ci`、`npm ci --prefix web`、`npm run verify`。
3. 在**仓库根目录**执行 `npm run release:build`（制品生成到 `.release/release-<sha>/`），再执行 `npm run release:check -- .release/release-<sha>` 校验清单与磁盘自洽。该校验同时拒绝含 `.env`（`.env.example` 除外）、`node_modules/` 或 `temp/` 的制品。
4. 要证明「两次构建字节一致」，把一份可信来源的 `manifest.json` 作为外部锚点逐项比对：`npm run release:check -- .release/release-<sha> --expect <可信 manifest.json 路径>`。锚点必须来自制品之外——指向制品自身的清单是与自己比对，会被拒绝。只做第 3 步的自洽校验无法发现「篡改文件后重算清单」的伪造。请在同一操作系统与 Node 24 环境下比较构建输出。
5. GitHub Actions 的 `Reproducible release candidate` 仅在 `main` 推送的静态检查、测试与覆盖率、依赖审计、Secret Scan 全部成功后上传同名 artifact，随后依次：下载并校验文件清单与 SHA-256、本地重建并与下载的清单比对（`--expect`）、用 `npm run release:smoke -- <制品目录>` 安装生产依赖、启动制品并断言业务路由返回预期错误码。

> **CI 那一步 `--expect` 的证明边界**：被比对的重建产物与下载的 artifact 出自同一个 job、同一次 checkout，所以它证明的是「上传/下载往返无损 + 同环境构建确定」，**不**证明跨机器可复现，也发现不了构建链本身被污染。跨机器复现要靠检查单里「在另一台机器上从同一 SHA 重建后比对哈希」那一条。

> **顺序契约**：`release:smoke` 会往制品目录写入 `.env` 与 `node_modules`，因此必须排在所有 `release:check` **之后**；冒烟过的目录不再是可校验的制品（再次 `check` 会因其含凭据/依赖被拒）。

## 运行

在制品根目录执行 `npm ci --omit=dev`，复制 `.env.example` 为 `.env`，填写实际配置并设置 `NODE_ENV=production`，然后执行 `npm start`（即 `node dist/server/bootstrap/server.js`）启动后端。`npm run release:smoke -- <制品目录>` 会自动完成上述安装与启动，并断言服务能返回带 `X-Request-Id` 的响应。编译后的后端位于 `dist/server/`，与仓库布局一致；`web/dist/` 是已编译的静态站点文件；部署时由静态文件服务器提供，并将 `/api` 代理到后端。运行期 `temp/` 数据、`.env`、`node_modules` 不包含在制品中。

这个制品是单机演示版的发布候选包，核心闭环的自动化验收使用确定性 fake 上游；真实 OpenAI 和 wttr.in 演示需要单独记录。
