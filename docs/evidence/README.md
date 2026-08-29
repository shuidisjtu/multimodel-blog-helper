# 验收证据归档

> 约定见任务清单 §5：证据文件按 `YYYY-MM-DD-主题-责任人` 命名；每个里程碑后编写一页总结（见 `docs/records/`）。
> 本目录保存**可归档的运行证据**（终端输出、覆盖率记录、报告截图等），供答辩查阅。
> 按类别分子目录：`verify/` 门禁输出、`api-contract/` 契约落地验证、`release-<sha>/` 按版本归档的功能演示素材与口述截图。

## verify/(门禁输出)

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `2026-08-22-verify-output.txt` | 全量门禁 `npm run verify` 输出（lint/typecheck/check-docs/check-structure/测试/覆盖率），158 测试全通过 | 2026-08-22 本机 |
| `2026-08-22-coverage-output.txt` | 覆盖率报告：Statements 95.13% / Branches 91.32% / Functions 98.95% / Lines 96.74%（阈 ≥80%） | 2026-08-22 本机 |
| `2026-08-24-verify-output.txt` | B2 完成态门禁输出：208 测试 / 覆盖率 Statements 92% / Branches 89.74% / Functions 92.8% / Lines 93.83% | 2026-08-24 本机 |
| `2026-08-29-b4-verify-output.txt` | B4 完成态门禁输出：237 测试 / 覆盖率 Statements 92.01% / Branches 88.86% / Functions 93.00% / Lines 94.06% | 2026-08-29 本机 |

## api-contract/(OpenAPI 契约验证)

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `2026-08-23-api-contract-and-verify.md` | B5 OpenAPI 契约落地及本机验证结果：质量门禁、158 测试、覆盖率与 HTTP 启动入口阻塞 | 2026-08-23 本机 |

## release-cbafff1/(功能演示:B1 上传受理 + B2 查询/转录下载,2026-08-24 实跑)

> 对应版本:main `cbafff1`(两个演示修复合并提交:transcriber File 上传 1ff7665 + rename EPERM 重试 0d9eca2)。演示素材与版本号一并归档,符合 task-list §5。

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `2026-08-24-api-demo-1-submit-query-download.png` | 终端截图:上传 202 → 查询 succeeded(含摘要 + transcriptUrl + model)→ 转录下载 200 全文 | 2026-08-24 实跑 |
| `2026-08-24-api-demo-2-server-log.png` | 服务端日志截图:状态机 queued→transcribing→summarizing→succeeded,whisper-1 9009ms / gpt-4o 3276ms,retryCount 0 | 2026-08-24 实跑 |
| `2026-08-24-api-demo-guide.md` | 答辩演示指引:准备/启动/①-⑨ 命令与预期输出/失败排查/清理 | 2026-08-24 |
| `2026-08-24-api-demo-check.ps1` | 一键检验脚本:③-⑦ + ⑨ 快检,每场景 PASS/FAIL 判定 | 2026-08-24 |
| `2026-08-24-api-demo-check-results.md` | 检验结果记录:9 场景 预期→实测对照表 + 发现并修复的 2 个问题 | 2026-08-24 |

## release-b4-20260829/(功能演示：B4 天气接口，2026-08-29 实跑)

> 对应尚未提交的 B4 工作树验证：真实 wttr.in 成功、未知地点与超时；自动化测试注入 fake fetch/provider，不访问公网。

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `2026-08-29-weather-demo-guide.md` | 答辩演示指引：真实成功/无效地点/超时、启动、清理与排障；使用临时 UTF-8 JSON 文件避免 PowerShell 参数改写请求体 | 2026-08-29 |
| `2026-08-29-weather-demo-check.ps1` | 一键检查脚本：按 `-Mode normal/timeout` 验证状态码、envelope、requestId 与脱敏；请求体通过临时文件传递 | 2026-08-29 |
| `2026-08-29-weather-demo-check-results.md` | 实测结果记录：原始终端实跑、后续截图实跑与质量门禁摘要 | 2026-08-29 |
| `2026-08-29-weather-demo-live-output.txt` | 首轮真实接口原始响应头/体：200、422、503 | 2026-08-29 实跑 |
| `2026-08-29-weather-demo-1-success.png` | 后续终端截图：真实 wttr.in 成功查询返回 200 和一致的 requestId | 2026-08-29 实跑 |
| `2026-08-29-weather-demo-2-invalid-location.png` | 后续终端截图：真实未知地点返回 422 `INVALID_LOCATION`，无上游原文 | 2026-08-29 实跑 |
| `2026-08-29-weather-demo-3-timeout.png` | 后续终端截图：`WEATHER_TIMEOUT_MS=1` 下真实上游请求返回 503 `WEATHER_UNAVAILABLE` | 2026-08-29 实跑 |

`release-9d94f90/`(对应 main 9d94f90):

| 文件 | 内容 |
| --- | --- |
| `2026-08-22-ci-actions.png` | GitHub Actions 页面：push 9d94f90，Static quality gates + Tests and coverage 双 job 绿（23s） |
| `2026-08-22-coverage-report.png` | 覆盖率报告页：95.13% Statements / 91.32% Branches / 98.95% Functions / 96.74% Lines |
| `2026-08-22-pr1-merged.png` | PR #1 页面：Merged 标签，10 commits 合并（+706/-41），含摘要 |

对应线上页面：Actions https://github.com/shuidisjtu/multimodel-blog-helper/actions ｜ PR #1 https://github.com/shuidisjtu/multimodel-blog-helper/pull/1

## 补充与失效声明

- 本目录**不保存**运行期 `temp/` 产物、`.env`、覆盖率 HTML（覆盖率为 gitignore，但截图已入 `release-9d94f90/`）。
- 证据随时间可能过期：重新运行对应命令后同步更新本索引。
- 后续里程碑（B6 等功能落地、release-<sha>）按任务清单 §5 约定继续归档截图。
