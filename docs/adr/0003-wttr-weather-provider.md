# ADR-0003：wttr.in 通过 WeatherProvider 隔离

- 状态：已接受（2026-08-12）
- 触发复审：wttr.in 变更协议、服务不可持续，或需要多天气源聚合时

## 背景

01-02 天气助手原用 WeatherAPI.com（需注册 key）。已替换为 **wttr.in**：免费、无 key、国内直连可用；其限制为仅个人/非商业用途，`lang=zh` 只作用于文本渲染层，`?format=j1` 的 `weatherDesc` 字段为上游透传英文（数据源翻译缺失，实测确认）。

## 决策

- 定义 `WeatherProvider` 端口（最小接口 `current(location): Weather`），领域层只依赖该端口。
- `WttrWeatherProvider` 实现：`https://wttr.in/{quote(location)}?format=j1`，15 秒超时。
- 上游超时、限流、无效地点一律映射为稳定业务错误（`422 INVALID_LOCATION` / `503 WEATHER_UNAVAILABLE`），**不伪造结果**。
- 适配器负责把 wttr.in JSON 转换为内部 DTO，禁止上游字段结构扩散到领域对象或 HTTP 响应。

## 备选方案

- **WeatherAPI.com**：需 key、有付费层。否决。
- **模拟/固定数据**：违反"不可假装可用"约束。否决。

## 后果

- 天气能力可替换：换实现只动 `infrastructure/weather/`，领域层与接口契约不变。
- 上游字段变化（如 `weatherDesc` 语言）被适配层吸收，不影响查询接口。

## 不可做事项

- 禁止把 wttr.in 原始 JSON 字段直接序列化进 HTTP 响应。
- 禁止天气不可用时返回伪造数据。

## 触发复审的条件

- wttr.in 停止服务、变更授权条款，或需要多天气源时。
