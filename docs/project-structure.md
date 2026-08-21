# 工程目录结构

> 定位：记录仓库内代码、测试、文档与运行产物的实际组织方式（"东西放在哪"）。
> 架构分层、职责边界与依赖规则属架构设计范畴，见 [`docs/architecture/architecture-design.md`](architecture/architecture-design.md) §3.1/§11；两处描述同一分层，本文件只说明物理位置与落地状态。

## 目录总览

> 块内 `src/` 与 `tests/` 子树由 `scripts/generate-structure.ts` 自动生成（事实源: `git ls-files` 中的 .ts 文件；`--update` 重写 / `--check` 校验），其余根手写维护。标 `(planned)` 的行是有意记录的未来工作，磁盘落地后由生成器接管。tests/ 与 src 同层镜像；e2e/ 待 C6。

```text
src/
  bootstrap/
    config.ts # 环境配置加载与校验(启动失败即退出)
    server.ts (planned) # 待 B/C 系列
    container.ts (planned) # 待 B/C 系列
  domain/
    job.ts # Job 状态机
    errors.ts # 领域错误
    ports.ts # 端口接口
  application/
    submit-audio.ts # 受理上传并创建 queued 任务
    process-job.ts # 推进任务状态机直至完成
    query-job.ts # 查询任务与摘要
    recover-jobs.ts # 启动恢复未完成任务
    process-job-worker.ts # 订阅队列消费的 worker
    cleanup-expired.ts # 过期任务清理编排
  infrastructure/
    openai/
      transcriber.ts # whisper-1 转录适配器
      summarizer.ts # Responses API 摘要适配器
      retryable.ts # OpenAI 错误可重试判定
      options.ts # 上游调用配置(超时/重试策略)
    common/
      retry.ts # 指数退避重试
    queue/
      memory-job-queue.ts # 有界 FIFO 内存队列
    repository/
      file-job-repository.ts # jobs/ JSON 文件仓储
    storage/
      file-store.ts # 临时目录文件存储
    weather/ (planned) # 待 B4
  interfaces/http/ (planned) # B 系列待建: routes/ middleware/ schemas/ openapi.yaml
  shared/
    logger.ts # 结构化 JSON 日志
    ids.ts # jobId/requestId 生成
    clock.ts # 时钟端口(ISO 8601)
tests/
  unit/ # 模块级单测
    cleanup-expired.test.ts
    config.test.ts
    ids-clock.test.ts
    job.test.ts
    logger.test.ts
    memory-job-queue.test.ts
    openai-retryable.test.ts
    openai-summarizer.test.ts
    openai-transcriber.test.ts
    process-job-worker.test.ts
    process-job.test.ts
    query-job.test.ts
    recover-jobs.test.ts
    retry.test.ts
    submit-audio.test.ts
  integration/ # 跨模块集成测试
    cleanup-expired.test.ts
    file-job-repository.test.ts
    file-store.test.ts
    recover-with-real-repo.test.ts
  e2e/ (planned) # 待 C6
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
