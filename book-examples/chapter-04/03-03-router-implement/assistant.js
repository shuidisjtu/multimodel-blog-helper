// 03-03: 使用 Responses API 的播客摘要助手模块
// 原实现依赖 Assistants API(threads + runs, 官方已关闭), 现迁移为 Responses API。
// 对外接口保持不变: askAssistant(transcriptionResult) → shownotes 文本。

import 'dotenv/config'
import OpenAI from "openai";

const client = new OpenAI();

// 播主信息工具
function get_podcast_host_info() {
    return "name: Guangyi Li, email: liguangyi08@gmail.com, website: https://www.v2think.com";
}

// 工具 schema
const tools = [
    {
        type: "function",
        name: "get_podcast_host_info",
        description: "获取播客主播的公开信息",
        parameters: { type: "object", properties: {} }
    }
];

export async function askAssistant(transcriptionResult) {
    // 第一轮: 模型可能请求工具
    let response = await client.responses.create({
        model: "gpt-4o",
        instructions: "你是一个播客内容助手, 负责将播客转录内容整理为 shownotes",
        input: `我将一个音频进行了转录，转录结果为"${transcriptionResult}"。请将该转录内容转化为播客的shownotes。`,
        tools,
        tool_choice: "auto",
    });

    // 执行模型请求的工具并回传结果
    const toolMessages = [];
    for (const item of response.output) {
        if (item.type === "function_call") {
            console.log("模型调用工具:", item.name);
            let output;
            if (item.name === "get_podcast_host_info") {
                output = get_podcast_host_info();
            }
            toolMessages.push({
                type: "function_call_output",
                call_id: item.call_id,
                output: String(output)
            });
        }
    }

    // 第二轮: 携带工具结果生成最终摘要
    if (toolMessages.length > 0) {
        response = await client.responses.create({
            model: "gpt-4o",
            previous_response_id: response.id,
            input: toolMessages,
        });
    }

    return response.output_text;
}
