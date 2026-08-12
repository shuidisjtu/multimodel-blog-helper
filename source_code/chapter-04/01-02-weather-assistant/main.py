# 01-02: 使用 Responses API 实现带工具调用的天气助手
#
# 原示例依赖 Assistants API(threads + runs, 官方已关闭), 现迁移为 Responses API。
# Responses API 的工具调用循环:
#   1. 第一轮调用: 模型返回 function_call
#   2. 本地执行工具函数
#   3. 第二轮调用: 携带 previous_response_id + tool_outputs 回传结果
#   4. 模型基于工具结果给出最终回答

import json
import urllib.parse
import requests
from dotenv import load_dotenv
load_dotenv()

from openai import OpenAI
client = OpenAI()

def get_current_temperature(location):
    """真实天气查询函数。使用免费无 key 的 wttr.in(仅限个人/非商业用途),
    返回摄氏温度字符串。"""
    url = f"https://wttr.in/{urllib.parse.quote(location)}?format=j1"
    response = requests.get(url, timeout=15)
    return response.json()["current_condition"][0]["temp_C"]

# 第一轮调用: 模型识别问题需要工具
response = client.responses.create(
    model="gpt-4o",
    input="What is the temperature in Beijing today?",
    tools=[{
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
    }],
    tool_choice="auto",
)

# 执行模型请求的工具, 收集结果
tool_outputs = []
for item in response.output:
    if item.type == "function_call" and item.name == "get_current_temperature":
        arguments = json.loads(item.arguments)
        location = arguments.get("location")
        print(f"模型调用工具: {item.name}({location})")
        result = get_current_temperature(location)
        tool_outputs.append({
            "call_id": item.call_id,
            "output": json.dumps(result, ensure_ascii=False)
        })

# 第二轮调用: 把工具执行结果作为 function_call_output 条目回传(SDK v2 官方方式)
if tool_outputs:
    response = client.responses.create(
        model="gpt-4o",
        previous_response_id=response.id,
        input=[{
            "type": "function_call_output",
            "call_id": item.call_id,
            "output": json.dumps(result, ensure_ascii=False),
        }],
    )
    print("\n=== 最终回答 ===")
    print(response.output_text)
else:
    print("模型未调用工具, 直接回答:", response.output_text)
