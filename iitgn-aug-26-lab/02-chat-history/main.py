import os
import sys
from openai.types.chat import ChatCompletionMessageParam

# Allow importing from the shared common package
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from common import DEFAULT_MODEL, get_client, loading

# Initialize client from common library
client = get_client()

# Optional model argument from CLI (defaults to openrouter/free)
model = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MODEL

# 1. Start with a system prompt defining the persona and environment
messages: list[ChatCompletionMessageParam] = [
    {
        "role": "system",
        "content": "You are a helpful demo model interacting with students in a computer science lab.",
    }
]

print(f"--- Chat Session Started (Model: {model}) ---")
print("Type 'exit' or 'quit' to stop.\n")

# 2. Continuous multi-turn chat loop
while True:
    user_message = input("User: ")
    if user_message.strip().lower() in ["exit", "quit"]:
        print("Exiting chat. Bye!")
        break

    # Append user's input to the message history
    messages.append({"role": "user", "content": user_message})

    # Send the full conversation history to the model with loading spinner
    with loading("Thinking"):
        response = client.chat.completions.create(
            model=model,
            messages=messages,
        )

    assistant_reply = response.choices[0].message.content or ""
    print(f"\nModel: {assistant_reply}\n")

    # Append model's reply so it remembers context in subsequent turns
    messages.append({"role": "assistant", "content": assistant_reply})
