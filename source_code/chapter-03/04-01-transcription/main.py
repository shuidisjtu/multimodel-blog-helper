from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
client = OpenAI()

audio_file= open("./audio-sample.mp3", "rb")
transcription = client.audio.transcriptions.create(
    model="whisper-1",
    file=audio_file,
    prompt="Please use commas to separate sentences",
    language="zh"
)
print(transcription)
content = transcription.text