# 工程目录结构

> 定位：记录仓库内代码、测试、文档与运行产物的实际组织方式（"东西放在哪"）。
> 架构分层、职责边界与依赖规则属架构设计范畴，见 [`docs/architecture/architecture-design.md`](architecture/architecture-design.md) §3.1/§11；两处描述同一分层，本文件只说明物理位置与落地状态。

## 目录总览

```text
src/
  bootstrap/        config.ts               # 环境配置加载与校验(启动失败即退出);server.ts/container.ts 待 B/C 系列
  domain/           job.ts, errors.ts, ports.ts   # Job 状态机/领域错误/端口接口
  application/      submit-audio.ts, process-job.ts, query-job.ts,
                    recover-jobs.ts, process-job-worker.ts, cleanup-expired.ts
                                            # 用例编排
  infrastructure/   openai/(transcriber.ts, summarizer.ts, retryable.ts),
                    common/(retry.ts),
                    queue/(memory-job-queue.ts),
                    repository/(file-job-repository.ts),
                    storage/(file-store.ts) # 外部依赖与存储实现;weather/ 待 B4
  interfaces/http/  routes/, middleware/, schemas/, openapi.yaml
                                            # B 系列待建
  shared/           logger.ts, ids.ts, clock.ts    # 与领域无关的基础工具
tests/              unit/, integration/     # 与 src 同层镜像;e2e/ 待 C6
fixtures/           audio-sample.mp3        # E2E 测试音频 fixture
docs/               adr/, architecture/, project-division/, records/
                                            # 决策记录/架构设计/任务清单/过程证据
temp/               uploads/, outputs/      # 运行期文件(gitignored, 启动后生成)
.github/workflows/  ci.yml                  # 待 C1
```

## 各目录职责与落地状态

| 路径 | 内容 | 状态 |
| --- | --- | --- |
| `src/bootstrap/` | 环境配置集中加载与校验(架构文档 §7.2),禁止散落读取 `process.env` | ✅ A2;server/container 待 B/C 系列 |
| `src/domain/` | Job 状态机、领域错误、端口接口;不导入 SDK | ✅ A1–A2 |
| `src/application/` | 用例编排(只依赖 domain + shared) | ✅ A3–A4 |
| `src/infrastructure/` | OpenAI/队列/仓储/文件系统实现(适配器) | ✅ A2–A4;weather 待 B4 |
| `src/interfaces/http/` | 路由、DTO 校验、OpenAPI | 🚧 B 系列 |
| `src/shared/` | logger / ids / clock 基础工具 | ✅ |
| `tests/` | 单元 + 集成测试(覆盖率门禁 80%) | ✅;e2e 待 C6 |
| `fixtures/` | E2E 测试音频(随仓库分发) | ✅ |
| `docs/` | ADR / 架构设计 / 任务清单 / 过程证据(records) | ✅;runbooks 待 C7 |
| `temp/` | 上传文件与处理产物(gitignored) | 运行期生成 |
| `.github/workflows/` | CI 流水线 | 🚧 C1 |

## 变更规则

- 新增目录或调整结构时，同步更新本文件。
- 涉及架构（分层、依赖规则、端口）的变更，同时按架构文档 §11.1 更新 ADR。
- 教材示例代码位于 `book-examples/chapter-*`，保持独立，不并入 `src/`。
