# Step 03: Function Calling & Tool Execution

Welcome to **Step 03** of the IIT Gandhinagar AI Harness Lab!

In Step 02, we implemented a multi-turn chat with conversation history. In this step, we give the model **tools** (also known as *Function Calling*) to interact with the external world and fetch live information.

---

## 💡 Core Concept: How Tool Calling Works

LLMs cannot directly run Python functions or make network requests on your machine. Instead, tool calling operates as a cooperative protocol between the model and your client harness:

1. **Tool Definition**: You provide the model with JSON schemas describing the available functions (name, description, parameter types).
2. **Model Decision**: When asked a question requiring external data (e.g., *"What's the weather in Tokyo?"*), the model responds with a structured `tool_calls` request instead of plain text.
3. **Client Execution**: Your harness parses the function name and arguments, executes the local Python function, and obtains the result.
4. **Tool Response**: Your harness appends the tool output as a message with `role: "tool"` and sends it back to the model.
5. **Final Synthesis**: The model reads the tool output and crafts a natural language response for the user.

```
User: "What's the weather in Tokyo?"
  │
  ▼
LLM  ──[ tool_calls: get_current_weather(city="Tokyo") ]──►  Harness (Python)
                                                                    │
                                                            Executes function
                                                            (wttr.in API call)
                                                                    │
LLM  ◄──[ role: "tool", content: "Tokyo: +27°C, Overcast" ]─────────┘
  │
  ▼
LLM: "The weather in Tokyo is currently overcast at 27°C."
```

---

## 📁 Module Structure

To keep our codebase clean and modular, Step 03 is divided into three focused files:

- [`tools.py`](file:///Users/championswimmer/Development/Teaching/iitgn-ai-harness/03-tool-calling/tools.py): Contains tool implementations (`get_current_time` via standard library `zoneinfo`/`datetime` and `get_current_weather` via `wttr.in`), along with the OpenAI-compatible `TOOLS_SCHEMA` and `AVAILABLE_TOOLS` dispatch dictionary.
- [`llm.py`](file:///Users/championswimmer/Development/Teaching/iitgn-ai-harness/03-tool-calling/llm.py): Encapsulates model interactions, system prompt initialization, and API calls via OpenRouter.
- [`main.py`](file:///Users/championswimmer/Development/Teaching/iitgn-ai-harness/03-tool-calling/main.py): The interactive chat loop with the tool execution handler that detects when functions are requested, runs them, and passes the output back to the model.

---

## 🚀 Running the Demo (from repo root)

```bash
# Run with default free model
python 03-tool-calling/main.py

# Or pass a specific model name
python 03-tool-calling/main.py google/gemma-4-31b-it:free
```

### Try Asking:
- *"What time is it right now in Tokyo and London?"*
- *"What is the weather like in Paris?"*
- *"Compare the temperature between Gandhinagar and New York."*
- *"Who was Alan Turing?"* (Notice: The model answers directly without invoking tools!)

---

## 🔍 How It Works (Step-by-Step)

1. **Expose Tools to the Model**:
   When invoking `client.chat.completions.create()`, we pass `tools=TOOLS_SCHEMA`.
2. **Detect Tool Calls**:
   ```python
   while response_message.tool_calls:
       # Process each tool call requested by the model
   ```
3. **Execute & Send Results**:
   ```python
   tool_fn = AVAILABLE_TOOLS.get(function_name)
   result = tool_fn(**arguments)
   messages.append({
       "role": "tool",
       "tool_call_id": tool_call.id,
       "content": str(result)
   })
   ```
4. **Iterate**: The harness calls the LLM again with the updated message list until the model returns a final text response.
