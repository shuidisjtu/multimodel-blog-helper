# 工程目录结构

> 定位：记录仓库内代码、测试、文档与运行产物的实际组织方式（"东西放在哪"）。
> 架构分层、职责边界与依赖规则属架构设计范畴，见 [`docs/architecture/architecture-design.md`](architecture/architecture-design.md) §3.1/§11；两处描述同一分层，本文件只说明物理位置与落地状态。

## 目录总览

> 块内 `src/` 与 `tests/` 子树由 `scripts/generate-structure.ts` 自动生成（事实源: `git ls-files` 中的 .ts 文件；`--update` 重写 / `--check` 校验），其余根手写维护。标 `(planned)` 的行是有意记录的未来工作，磁盘落地后由生成器接管。tests/ 与 src 同层镜像；e2e/ 待 C6。

```text
src/
  bootstrap/
    config.ts # 环境配置加载与校验(启动失败即退出)
    server.ts # HTTP 服务启动入口(RecoverJobs 先于 worker 的启动顺序契约)
    container.ts # 依赖组装(配置→基础设施→用例→worker/recover, 业务依赖单点注入)
  domain/
    job.ts # Job 状态机
    errors.ts # 领域错误
    ports.ts # 端口接口
    audio-upload.ts # 上传校验器(MIME/大小/魔数白名单, 存储扩展名由 MIME 推断)
  application/
    submit-audio.ts # 受理上传并创建 queued 任务
    process-job.ts # 推进任务状态机直至完成
    query-job.ts # 查询任务与摘要
    recover-jobs.ts # 启动恢复未完成任务
    process-job-worker.ts # 订阅队列消费的 worker
    cleanup-expired.ts # 过期任务清理编排
    get-transcript.ts # 转录文本下载用例(FileStore 经端口访问; 404/409/410/500 语义与 QueryJob 一致)
    ask-weather.ts # 天气查询用例(WeatherProvider 编排与 requestId 日志)
  infrastructure/
    openai/
      transcriber.ts # whisper-1 转录适配器
      summarizer.ts # Responses API 摘要适配器
      retryable.ts # OpenAI 错误可重试判定
      options.ts # 上游调用配置(超时/重试策略)
    common/
      retry.ts # 指数退避重试
      music-metadata-duration-probe.ts # 时长探针(music-metadata 解析, 失败降级 null 不误杀)
    queue/
      memory-job-queue.ts # 有界 FIFO 内存队列
    repository/
      file-job-repository.ts # jobs/ JSON 文件仓储
    storage/
      file-store.ts # 临时目录文件存储
    weather/
      wttr-weather-provider.ts # wttr.in j1 适配器(超时/错误映射/Weather DTO)
  shared/
    logger.ts # 结构化 JSON 日志
    ids.ts # jobId/requestId 生成
    clock.ts # 时钟端口(ISO 8601)
  interfaces/
    http/ # 路由与中间件(POST 上传受理 + GET 查询/转录下载)
      middleware/
        error-handler.ts # 统一错误边界(ErrorCode→HTTP 状态/稳定消息/Retry-After; 未知错误 500 兜底不泄漏)
        request-id.ts # requestId 中间件(服务生成, 写 X-Request-Id 响应头与 res.locals)
        access-log.ts # 访问日志中间件(请求完成时一行 http.access: 方法/路由模式路径/状态/耗时/requestId)
        cors.ts # 白名单 CORS 中间件(默认同源/仅白名单 Origin 获允许头/OPTIONS 预检, B6)
        rate-limit.ts # 路由级 IP 限流(统一 429 envelope + 动态 Retry-After; TRUST_PROXY 语义, B6)
      routes/
        audio-jobs.ts # POST /api/v1/audio-jobs 上传受理(multer 内存暂存→校验→SubmitAudio→202/200/409)
        audio-job-query.ts # GET /api/v1/audio-jobs/{id} 查询与 /transcript 转录下载(UUID 校验, 非法一律 404)
        weather.ts # POST /api/v1/assistant/weather 天气查询(DTO 校验→AskWeather→统一 JSON 信封)
      schemas/ # 共享 HTTP 请求 DTO 解析与标准化(B5)
        idempotency-key.ts # Idempotency-Key 空白归一化与 255 字符上限(B5)
        job-id.ts # UUID jobId 校验(非法 ID 统一映射为 JOB_NOT_FOUND)
        weather-request.ts # weather 请求对象校验，原始值检查后 trim
      envelope.ts # HTTP 响应信封(成功 data/requestId; 失败 error/requestId, 契约 §5)
      app.ts # Express 应用组装(requestId→路由→错误边界, async rejection 自动转发)
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
    audio-upload.test.ts # 上传校验器单测
    music-metadata-duration-probe.test.ts # 时长探针单测(真实 mp3 + 损坏文件降级)
    envelope.test.ts # 响应信封与 submissionData 单测(openapi.yaml §components.schemas)
    error-handler.test.ts # 错误中间件单测(领域/multer/未知错误 → 状态码+信封+Retry-After)
    container.test.ts # buildContainer 组装单测(依赖注入完整性, §3.1)
    get-transcript.test.ts # GetTranscript 用例单测(成功/不存在/过期/未就绪/IO 错误)
    ask-weather.test.ts # AskWeather 用例单测(委派、日志与未知错误归一)
    wttr-weather-provider.test.ts # wttr.in 适配器单测(映射、超时与错误脱敏)
    idempotency-key-schema.test.ts # 幂等键 DTO 单测(空白、trim、255 上限)
    job-id-schema.test.ts # jobId DTO 单测(UUID/非法格式/路径注入)
    weather-request-schema.test.ts # weather DTO 单测(对象边界/原始长度/trim)
    rate-limit.test.ts # 限流纯函数单测(XFF 首段解析/动态 Retry-After 边界)
  integration/ # 跨模块集成测试
    cleanup-expired.test.ts
    file-job-repository.test.ts
    file-store.test.ts
    recover-with-real-repo.test.ts
    audio-jobs-route.test.ts # 上传受理集成测试(真实仓储/队列: 202/200/409/400/413/415/503 全场景)
    audio-job-query.test.ts # 查询与转录下载集成测试(真实仓储+真实文件: 200 全状态/404/409/410/路径注入)
    weather-route.test.ts # 天气路由集成测试(200 envelope、DTO 校验、422/503 脱敏)
    access-log.test.ts # 访问日志集成测试(成功/404/未匹配路由: 字段、路由模式路径与 requestId 关联)
    cors.test.ts # CORS 集成测试(白名单/默认同源/预检 204/非法 Origin 无允许头)
    rate-limit.test.ts # 限流集成测试(429 envelope/Retry-After/无效请求计数/XFF 信任)
  e2e/ (planned) # 待 C6
  scripts/ # 脚本测试
    generate-structure.test.ts # 结构生成器测试
    check-docs.test.ts # 文档一致性检查
  contract/ # OpenAPI 驱动的真实 HTTP 响应契约测试(B5)
    openapi-contract.test.ts # 读取 OpenAPI 并校验状态/头/媒体类型/JSON Schema
web/                package.json, vite.config.ts # 独立 React + Vite 答辩工作台(D2)
  src/             api/, components/, styles/, test/ # fetch DTO、共享模块、浅色博客助手样式与交互测试
fixtures/           audio-sample.mp3        # E2E 测试音频 fixture
docs/               adr/, architecture/, project-division/, records/, evidence/
                                            # 决策记录/架构设计/任务清单/过程证据/验收证据
temp/               uploads/, outputs/      # 运行期文件(gitignored, 启动后生成)
.github/workflows/  ci.yml                  # ✅ C1
```

## 各目录职责与落地状态

| 路径 | 内容 | 状态 |
| --- | --- | --- |
| `src/bootstrap/` | 环境配置集中加载与校验 + 容器组装 + 服务启停(架构文档 §3.1) | ✅ A2/B1/B4 |
| `src/domain/` | Job 状态机、领域错误、端口接口;不导入 SDK | ✅ A1–A2 |
| `src/application/` | 用例编排(只依赖 domain + shared) | ✅ A3–A4 |
| `src/infrastructure/` | OpenAI/队列/仓储/文件系统/天气实现(适配器) | ✅ A2–A4/B4 |
| `src/interfaces/http/` | 路由、共享 DTO 校验、中间件与 OpenAPI 契约 | ✅ B1/B2/B4/B5 |
| `src/shared/` | logger / ids / clock 基础工具 | ✅ |
| `tests/` | 单元 + 集成 + OpenAPI 驱动的契约测试(覆盖率门禁 80%) | ✅ B5/C2;e2e 待 C6 |
| `web/` | 独立 React + Vite 工作台；共享布局、天气 DTO/API、视觉令牌与交互测试 | 🚧 D2（ym-hello） |
| `fixtures/` | E2E 测试音频(随仓库分发) | ✅ |
| `docs/` | ADR / 架构设计 / 任务清单 / 过程证据(records) / 验收证据(evidence) | ✅;runbooks 待 C7 |
| `temp/` | 上传文件与处理产物(gitignored) | 运行期生成 |
| `.github/workflows/` | CI 流水线 | ✅ C1 |

## 变更规则

- 新增目录或调整结构时，同步更新本文件。
- 涉及架构（分层、依赖规则、端口）的变更，同时按架构文档 §11.1 更新 ADR。
- 教材示例代码位于 `book-examples/chapter-*`，保持独立，不并入 `src/`。
