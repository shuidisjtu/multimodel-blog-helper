from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
client = OpenAI()

def format_timestamp(seconds):
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{minutes:02d}:{secs:02d}"

def convert_transcription_to_human_readable(transcription_response):
    lines = []
    for segment in transcription_response.segments:
        start_time = segment.start
        text = segment.text
        timestamp = format_timestamp(start_time)
        lines.append(f"{timestamp} - {text}")

    return "\n".join(lines)

audio_file= open("./audio-sample.mp3", "rb")
transcription = client.audio.transcriptions.create(
  model="whisper-1", 
  file=audio_file,
  response_format="verbose_json",
  timestamp_granularities=["segment"]
)
print(convert_transcription_to_human_readable(transcription))