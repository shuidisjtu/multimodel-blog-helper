# ADR-0002：短期使用 temp/ + 文件任务仓储

- 状态：已接受（2026-08-12）
- 触发复审：需要多实例/多进程处理任务，或文件数量超过单目录可维护量时

## 背景

重构需要一个可持久化、可恢复的任务仓储：Job 状态不能只放进程内存（重启即失忆），同时数据库集群、对象存储均为永久非目标（开源学习研究定位，架构文档 §1.2）。

## 决策

- `JobRepository` 实现为 `temp/jobs/<jobId>.json` 的原子写入：先写 `<jobId>.json.tmp` 再 `rename`，避免读到半截文件。
- 输入文件 `temp/uploads/<jobId>/input.<ext>`；转录与摘要产物 `temp/outputs/<jobId>/`。
- 幂等键互斥使用 `fs.open(path, 'wx')`（O_EXCL）原子创建占位文件（见 ADR-0004 的配套语义与架构文档 §5）。
- 启动恢复：`queued` 任务重新入队；进行中任务标记 `failed: PROCESS_INTERRUPTED`。
- 过期清理保留最小 tombstone（`id`/`status: expired`/`expiresAt`），二次清理期限后移除（架构文档 §4.2）。
- 切换边界锁定为 `JobRepository` 与 `FileStore` 两个端口：未来换 SQLite/对象存储只替换 `infrastructure/` 实现，不动领域层与 HTTP 契约。

## 备选方案

- **SQLite**：需引入原生依赖与学习成本，本期无多实例需求。暂缓。
- **内存仓储**：重启即丢，无法满足"任务可追踪、不假装成功"的约束。否决。
- **PostgreSQL/对象存储**：永久非目标。否决。

## 后果

- 单机单进程内的任务能力受文件系统语义约束（原子性依赖 rename/O_EXCL），并发语义需在实现中严格按架构文档 §5/§6 落地。
- 文件在 `temp/`（gitignored），不随仓库分发。

## 不可做事项

- 禁止把任务状态只放在进程内存。
- 禁止领域层知道文件路径或直接读写 `fs`。

## 实现记录（A3 落地, 2026-08-12）

- `FileJobRepository`（infrastructure/repository/）与 `LocalFileStore`（infrastructure/storage/）已实现：tmp+rename 原子写、O_EXCL 幂等占位、列表扫描容忍单文件损坏（记录跳过）。
- 端口演进（§11.1 同步义务）：`JobRepository` 追加 `listInProgress`（启动恢复标记用）与 `remove`（tombstone 二次清理）；`CreateJobParams` 增加可选 `id`（用例层预生成 jobId，使文件目录与任务 id 一致）。
- `BlogJob.input` 改为可选：tombstone 最小化后任务无 input，仓储校验（isBlogJob）对 `expired` 放行、其余状态仍严格。
- 幂等占位文件以 `sha256(idempotencyKey)` 命名，防 key 中的路径分隔符注入。
- **幂等占位互斥细节**：O_EXCL 创建成功者拥有该 key；收到 `EEXIST` 的请求回读既有记录，比较 `sha256` 后返回 `replayed` 或 `conflict`（不能依赖 `rename` 失败判定冲突——POSIX/Node 的 rename 到已有目标会覆盖而非失败）；占位创建成功但后续步骤失败时须清除，防止幂等键永久卡死。
- **原子性边界**：read-modify-write 的"原子"是单进程单线程内的近似语义（update 的 mutator 以仓储最新状态执行）；多进程/多实例部署时须复审本决策（见触发复审条件）。

## 触发复审的条件

- 需要多实例横向扩展、任务量超过单目录可维护性，或运行环境要求独立存储服务时。
