import os
import sys

# Allow importing from the shared common package
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from common import DEFAULT_MODEL, get_client, loading

# Default prompt if none is provided via command-line arguments
DEFAULT_PROMPT = "hello! how are you? tell me an interesting fact about India"

# 1. Read prompt and optional model from command line arguments
# Usage: python main.py "Your prompt here" [optional_model_name]
prompt = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PROMPT
model = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_MODEL

# 2. Get OpenRouter client from our common library
client = get_client()

print(f"Calling model: {model}")
print(f"Prompt: {prompt}\n")

# 3. Make the API call with a loading spinner
with loading("Thinking"):
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
    )

# 4. Extract reply and usage stats
reply = response.choices[0].message.content
usage = response.usage

print("--- Response ---")
print(reply)
print("----------------")

print("\nStats:")
print(f"  • Model:             {response.model}")
if usage:
    print(f"  • Prompt Tokens:     {usage.prompt_tokens}")
    print(f"  • Completion Tokens: {usage.completion_tokens}")
    print(f"  • Total Tokens:      {usage.total_tokens}")
