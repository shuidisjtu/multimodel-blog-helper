# 验收证据归档

> 约定见任务清单 §5：证据文件按 `YYYY-MM-DD-主题-责任人` 命名；每个里程碑后编写一页总结（见 `docs/records/`）。
> 本目录保存**可归档的运行证据**（终端输出、覆盖率记录、报告截图等），供答辩查阅。

## 索引

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `2026-08-22-verify-output.txt` | 全量门禁 `npm run verify` 输出（lint/typecheck/check-docs/check-structure/测试/覆盖率），158 测试全通过 | 2026-08-22 本机 |
| `2026-08-22-coverage-output.txt` | 覆盖率报告：Statements 95.13% / Branches 91.32% / Functions 98.95% / Lines 96.74%（阈 ≥80%） | 2026-08-22 本机 |

## 线上证据（GitHub 链接，不随仓库分发）

| 证据 | 链接 |
| --- | --- |
| GitHub Actions CI 记录（quality + tests） | 仓库 Actions 页：https://github.com/shuidisjtu/multimodel-blog-helper/actions |
| PR #1（B3 合并记录，10 提交） | https://github.com/shuidisjtu/multimodel-blog-helper/pull/1 |
| 覆盖率可视化报告 | 本机 `coverage/index.html`（`npx vitest run --coverage` 生成，不入库） |

## 补充与失效声明

- 本目录**不保存**运行期 `temp/` 产物、`.env`、覆盖率 HTML（gitignore 规则）。
- 截图等二进制证据未入库；若需留档，答辩前从以上链接/本机截图放入 `docs/evidence/release-<sha>/`（任务清单 §5 约定）。
- 证据随时间可能过期：重新运行对应命令后同步更新本索引。
