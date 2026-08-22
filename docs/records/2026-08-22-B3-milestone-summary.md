# B3 里程碑总结：上传校验与临时文件策略

> 日期：2026-08-22 ｜ 责任人：shuidisjtu ｜ 里程碑：任务清单 B3 完成（已合并 main）
>
> 里程碑式编写机制：本文档为 B3 节点的过程证据；核心技术说明见 [2026-08-21-core-tech-defense.md](2026-08-21-core-tech-defense.md)（稳定文档，不随任务改动）；任务状态以任务清单为唯一权威。

## 目标

按架构文档 §5 为上传链路补齐校验与存储安全：仅允许约定音频类型、≤25 MB、时长上限（解析失败降级并记录）、随机存储名、`temp/` Git 忽略、tombstone 二次清理（后三项 A3 已实现，B3 收口核查）。

## 实际结果

- **domain 校验器**（新增 `src/domain/audio-upload.ts`）：白名单 MIME（audio/mpeg|wav|mp4|x-m4a）+ 大小 + 魔数一致性（mp3 双形态 ID3/MPEG 同步字、wav RIFF/WAVE、mp4/m4a 合并同家族）；存储扩展名按 MIME 推断
- **时长探测**（新增 `AudioDurationProbe` 端口 + `MusicMetadataDurationProbe`）：music-metadata（纯 JS，零系统依赖）；解析失败降级返回 null 并记录，不误杀合法音频
- **FileStore 收口**：`SaveInputParams.extension`（服务端受信），删除 `extractExtension`，用户文件名退出路径
- **SubmitAudio 编排**：落盘后探测时长，超长回滚清理 + `AUDIO_TOO_LONG`；降级（null）放行
- **文档蒸馏**：架构文档 §5/§7.2（ffprobe→music-metadata）、§2.5 null 例外、§5 幂等语义精确化；任务清单 B3 ✅；README/.env.example/目录结构同步

## 问题与解决方案

| 问题 | 解决方案 |
| --- | --- |
| 架构文档原定 ffprobe 检测时长，但本机/CI/队友环境未装，行为随环境漂移 | 改 music-metadata（纯 JS 锁版本），全环境一致；文档同步修订 |
| mp3 无固定文件头，通用检测库有误判短板 | 手工魔数表：ID3 帧头或 MPEG 同步字宽松匹配（架构文档 §5 实现注意） |
| mp4/m4a 为同容器（ISO-BMFF），细分 brand 易误杀 | 合并同家族，仅验证 `ftyp` |
| 日志 `filePath` 键绕过 `SENSITIVE_KEYS` 精确匹配脱敏（最终审查发现） | logger 补充 `filepath` 键，音频路径不落日志 |
| 答辩文档实现状态为日期快照，任务一推进即过时 | 改为引用 task-list.md，里程碑式新增总结文档 |

## 证据链接

- PR：[#1](https://github.com/shuidisjtu/multimodel-blog-helper/pull/1)（Rebase 合并 main，10 提交）
- 门禁：`npm run verify` 全绿——158 测试（23 文件）、覆盖率 Statements 95.13%、lint/typecheck/check:docs/check:structure 通过
- CI：GitHub Actions quality+tests 双 job success（main push 32575112664）
- 新增测试：校验器 8、时长探针 4、SubmitAudio 编排 4；file-store 重写（`../evil.MP3` 不入路径）

## 下一步

按分工 shuidisjtu → B1（上传受理接口）：`validateAudioUpload` 内存校验 + multer 暂存 + 路由/DTO 接线（SubmitAudio 与幂等 O_EXCL 占位已就绪）；B5 契约（OpenAPI）由 ym-hello 先行评审。
