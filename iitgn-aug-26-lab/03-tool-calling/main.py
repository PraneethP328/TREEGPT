import json
import os
import sys
from openai.types.chat import ChatCompletionMessageParam

# Allow importing from the shared common package and local directory
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.append(os.path.abspath(os.path.dirname(__file__)))
from common import DEFAULT_MODEL

from llm import call_llm, create_initial_messages
from tools import AVAILABLE_TOOLS, TOOLS_SCHEMA

# Optional model argument from CLI (defaults to openrouter/free)
model = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MODEL

messages: list[ChatCompletionMessageParam] = create_initial_messages()

print(f"--- Chat with Tools Started (Model: {model}) ---")
print("Available tools: get_current_time, get_current_weather")
print("Type 'exit' or 'quit' to stop.\n")

# Interactive chat loop
while True:
    user_message = input("User: ")
    if user_message.strip().lower() in ["exit", "quit"]:
        print("Exiting chat. Bye!")
        break

    # 1. Append user input to history
    messages.append({"role": "user", "content": user_message})

    # 2. Call LLM with tool schemas
    response_message = call_llm(messages, tools=TOOLS_SCHEMA, model=model)

    # 3. Tool execution loop: handle function calls requested by the model
    while response_message.tool_calls:
        # Append the assistant's tool call request to history
        messages.append(
            {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in response_message.tool_calls
                    if tc.type == "function"
                ],
            }
        )

        for tool_call in response_message.tool_calls:
            if tool_call.type != "function":
                continue

            function_name = tool_call.function.name
            arguments = json.loads(tool_call.function.arguments)

            print(f"\n⚙️  Tool Call: {function_name}({arguments})")

            # Execute corresponding tool function
            tool_fn = AVAILABLE_TOOLS.get(function_name)
            result = tool_fn(**arguments) if tool_fn else f"Error: Tool '{function_name}' not found"

            print(f"📥 Tool Output: {result}\n")

            # Append tool result to conversation history
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": str(result),
                }
            )

        # Let the model process the tool output and produce a reply (or call more tools)
        response_message = call_llm(messages, tools=TOOLS_SCHEMA, model=model)

    assistant_reply = response_message.content or ""
    print(f"\nModel: {assistant_reply}\n")

    # 4. Append assistant's final text reply to history
    messages.append({"role": "assistant", "content": assistant_reply})
