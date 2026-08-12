// 02-01: 使用 Responses API 实现播客摘要助手(shownotes)
//
// 原示例依赖 Assistants API(threads + runs, 官方已关闭), 现迁移为 Responses API。
// 流程: 用户消息 → 模型请求工具(读转录文件 / 播主信息) → 执行工具并回传
//       → 流式输出最终 shownotes。
// 与 Assistants 版的差异: 不需要预创建 assistant 和 thread, 每次调用自带上下文。

import 'dotenv/config'
import OpenAI from "openai";
import fs from 'fs'

const client = new OpenAI();

// 请填写您的本地转录结果文件路径(OpenAI 转录输出的 txt)
const filePath = "./transcript-example.txt"

// 工具 1: 读取本地转录文件内容
function get_transcription_result(filePath) {
    return fs.readFileSync(filePath, 'utf-8');
}

// 工具 2: 返回播主公开信息
function get_podcast_host_info() {
    return "name: Guangyi Li, email: liguangyi08@gmail.com, website: https://www.v2think.com";
}

// 工具 schema(Responses API 格式)
const tools = [
    {
        type: "function",
        name: "get_transcription_result",
        description: "读取指定路径的音频转录结果文件, 返回其文本内容",
        parameters: {
            type: "object",
            properties: {
                file_path: { type: "string", description: "转录结果文件路径" }
            },
            required: ["file_path"]
        }
    },
    {
        type: "function",
        name: "get_podcast_host_info",
        description: "获取播客主播的公开信息",
        parameters: { type: "object", properties: {} }
    }
];

const userMessage = `我将一个音频转录结果文件保存到了本地，路径为"${filePath}"。转录由OpenAI实现并保存为txt格式，内容示例如下："00:00:00 - Hello \n 00:00:02 - World"。请将该转录内容转化为播客的shownotes。`;

// 第一轮: 模型识别任务, 可能请求工具
let response = await client.responses.create({
    model: "gpt-4o",
    instructions: "你是一个播客内容助手, 负责将播客转录内容整理为 shownotes",
    input: userMessage,
    tools,
    tool_choice: "auto",
});

// 执行模型请求的工具, 收集结果
const toolMessages = [];
for (const item of response.output) {
    if (item.type === "function_call") {
        console.log("模型调用工具:", item.name);
        let output;
        if (item.name === "get_transcription_result") {
            const path = JSON.parse(item.arguments).file_path;
            output = get_transcription_result(path);
        } else if (item.name === "get_podcast_host_info") {
            output = get_podcast_host_info();
        }
        toolMessages.push({
            type: "function_call_output",
            call_id: item.call_id,
            output: String(output)
        });
    }
}

// 第二轮: 回传工具结果, 流式输出最终摘要
if (toolMessages.length > 0) {
    const stream = client.responses.stream({
        model: "gpt-4o",
        previous_response_id: response.id,
        input: toolMessages,
    });
    stream.on("response.output_text.delta", (event) => process.stdout.write(event.delta));
    response = await stream.finalResponse();
} else {
    console.log("模型直接回答:", response.output_text);
}

console.log("\n=== shownotes 生成完成 ===");
