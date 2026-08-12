// 03-04: 使用 Responses API 的播客摘要助手模块(带错误处理)
// 原实现依赖 Assistants API(threads + runs, 官方已关闭), 现迁移为 Responses API。
// 对外接口保持不变: askAssistant(filePath) → shownotes 文本。
// 相比 03-03 增加: 对工具调用异常与 API 调用异常的错误处理(健壮性演示)。

import 'dotenv/config'
import OpenAI from "openai";
import fs from 'fs'

const client = new OpenAI();

// 工具 1: 读取本地转录文件内容
function get_transcription_result(filePath) {
    return fs.readFileSync(filePath, 'utf-8');
}

// 工具 2: 返回播主公开信息
function get_podcast_host_info() {
    return "name: Guangyi Li, email: liguangyi08@gmail.com, website: https://www.v2think.com";
}

// 工具 schema
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

export async function askAssistant(filePath) {
    try {
        // 第一轮: 模型可能请求工具
        let response = await client.responses.create({
            model: "gpt-4o",
            instructions: "你是一个播客内容助手, 负责将播客转录内容整理为 shownotes",
            input: `我将一个音频转录结果文件保存到了本地，路径为"${filePath}"。转录由OpenAI实现并保存为txt格式，内容示例如下："00:00:00 - Hello \n 00:00:02 - World"。请将该转录内容转化为播客的shownotes。`,
            tools,
            tool_choice: "auto",
        });

        // 执行模型请求的工具并回传结果
        const toolMessages = [];
        for (const item of response.output) {
            if (item.type === "function_call") {
                console.log("模型调用工具:", item.name);
                let output;
                try {
                    if (item.name === "get_transcription_result") {
                        const path = JSON.parse(item.arguments).file_path;
                        output = get_transcription_result(path);
                    } else if (item.name === "get_podcast_host_info") {
                        output = get_podcast_host_info();
                    }
                } catch (err) {
                    // 工具执行异常时返回错误信息给模型, 让其降级处理
                    output = `工具执行出错: ${err.message}`;
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
    } catch (err) {
        // API 调用级错误处理
        console.error("askAssistant 调用失败:", err.message);
        return "生成 shownotes 时发生错误, 请稍后重试";
    }
}
