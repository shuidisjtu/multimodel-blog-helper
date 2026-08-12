# 01-01: 使用 Responses API 定义"助手配置"
#
# 背景: OpenAI 已弃用 Assistants API(将于 2026 年 8 月 26 日关闭), 官方迁移方案为 Responses API。
# 在 Responses API 中, "助手"不再需要预先创建(assistants.create),
# 它只是一个配置对象: instructions(职责) + tools(可用工具)。
# 每次调用时把配置传给 responses.create 即可, 无需保存 assistant_id。

from dotenv import load_dotenv
load_dotenv()

from openai import OpenAI
client = OpenAI()

# 助手配置: 定义职责与可用工具
# (原 Assistants API 中 create_assistant() 的参数, 现在只是一个字典)
ASSISTANT_CONFIG = {
    "model": "gpt-4o",
    "instructions": "请提供给我指定城市的当日气温，以摄氏度为单位",
    "tools": [{
        "type": "function",
        "name": "get_current_temperature",
        "description": "获取指定地点的当日气温信息，以摄氏度为单位",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "地点或者城市名称，比如“北京”"
                }
            },
            "required": ["location"]
        }
    }]
}

# 一次真实调用: 模型识别出用户问题需要调用工具, 返回 function_call
response = client.responses.create(
    model=ASSISTANT_CONFIG["model"],
    instructions=ASSISTANT_CONFIG["instructions"],
    input="北京今天的天气怎么样?",
    tools=ASSISTANT_CONFIG["tools"],
    tool_choice="auto",
)

# 解析响应: 区分"调用工具"与"直接回答"
for item in response.output:
    if item.type == "function_call":
        print(f"模型决定调用工具: {item.name}")
        print(f"调用参数: {item.arguments}")
    elif item.type == "message":
        print("模型直接回答:", item.content[0].text)

print("\n提示: 真正执行工具并回传结果给模型, 见下一个示例 01-02-weather-assistant")
