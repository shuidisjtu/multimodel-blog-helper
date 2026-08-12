# ADR-0001：以 Responses API 替代已关闭的 Assistants API

- 状态：已接受（2026-08-12）
- 触发复审：OpenAI 推出新的对话/助手类 API 且中转站跟进支持时

## 背景

书第 4 章 5 个示例（01-01/01-02/02-01/03-03/03-04）基于 Assistants API（threads/runs）。该 API 已于 2026-04 关闭；本项目使用的中转站 openai-hk（`OPENAI_BASE_URL=https://api.openai-hk.com/v1`）仅提供 Responses API 兼容端点。示例已全部重写为 Responses API 并实测跑通，本轮重构将其固化为核心决策。

## 决策

- 所有对话/工具调用交互统一走 Responses API（SDK v2 的 `responses.create`）。
- 工具调用循环固定为两轮：第一轮 `responses.create` 返回 `function_call` → 本地执行工具 → 第二轮 `responses.create` 携带 `previous_response_id`，在 `input` 中追加 `{"type": "function_call_output", "call_id", "output"}`。
- 流式输出使用 `client.responses.stream(...)` + `response.output_text.delta` 事件 + `finalResponse()`。

## 备选方案

- **Chat Completions API**：工具调用可用但无状态管理，需自行拼消息历史，5 个示例全部重写，工作量大于现有方案且不提供额外价值。否决。
- **继续使用 Assistants API**：已关闭，不可用。否决。

## 后果

- 工具调用与状态管理方式被 SDK v2 绑定，适配层（`infrastructure/openai/`）集中收口该差异，领域层不受影响。
- 历史示例的迁移成本已支付，重构直接复用验证过的模式。

## 不可做事项

- 不使用已失效的 `tool_outputs` 参数与 `role="tool"` 消息。
- 不在领域层直接依赖 OpenAI SDK 类型。

## 触发复审的条件

- OpenAI 或中转站新增/变更对话 API 形态，且影响工具调用或流式语义时。
