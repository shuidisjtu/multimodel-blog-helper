import 'dotenv/config'
import fs from "fs";
import OpenAI from "openai";

const openai = new OpenAI();

function formatTimestamp(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function convertTranscriptionToHumanReadable(transcriptionResponse) {
    const lines = [];
    transcriptionResponse.segments.forEach(segment => {
        const startTime = segment.start;
        const text = segment.text;
        const timestamp = formatTimestamp(startTime);
        lines.push(`${timestamp} - ${text}`);
    });

    return lines.join('\n');
}

export async function transcript(filePath) {
    const result = await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: "whisper-1",
        response_format: "verbose_json"
    });
    return convertTranscriptionToHumanReadable(result);
}

