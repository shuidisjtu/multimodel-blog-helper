from datetime import datetime
import os
import json
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
assistant_id = os.getenv("ASSISTANT_ID")

client = OpenAI()

assistant_definition = None
with open('./assistant.json', 'r', encoding="utf-8") as f:
    assistant_definition = json.load(f)


def update_assistant(assistant_id, assistant_definition):
    updated_assistant = client.beta.assistants.update(
        assistant_id,
        instructions=assistant_definition["instructions"],
        name=assistant_definition["name"],
        tools=assistant_definition["tools"],
        model=assistant_definition["model"]
    )

    return updated_assistant

def backup_assistant(assistant_id):
    origin_assistant_definition = client.beta.assistants.retrieve(assistant_id)
    
    name = origin_assistant_definition.name
    instructions = origin_assistant_definition.instructions
    model = origin_assistant_definition.model
    tools = origin_assistant_definition.tools

    backup_assistant = client.beta.assistants.create(
        name=f"{name}-backup-{datetime.now().strftime('%Y-%m-%d-%H-%M-%S')}",
        instructions=instructions,
        model=model,
        tools=tools
    )

    return backup_assistant.id

def delete_backup_assistant(backup_assistant_id):
    client.beta.assistants.delete(backup_assistant_id)

backup_assistant_id = backup_assistant(assistant_id)
print(f"Backup assistant created with ID: {backup_assistant_id}")

update_assistant(assistant_id, assistant_definition)
print("Assistant updated")

delete_backup_assistant(backup_assistant_id)
print("Backup assistant deleted")


