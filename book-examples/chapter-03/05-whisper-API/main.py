import whisper

model = whisper.load_model("turbo")
result = model.transcribe("./audio-sample.mp3")
content = result["text"]