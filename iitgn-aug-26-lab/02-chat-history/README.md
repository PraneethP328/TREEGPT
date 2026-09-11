# Step 02: Multi-Turn Chat with History

Welcome to **Step 02** of the IIT Gandhinagar AI Harness Lab!

In Step 01, we made a single stateless API call. In this demo, we build a **multi-turn interactive chat application** where the conversation history is preserved across turns.

---

## 💡 Core Concept: Stateless APIs & Client-Side Memory

LLMs are **stateless**. The model does not remember past interactions on its own.

To create the illusion of a continuous conversation, the **agent harness** must maintain a list of messages (`messages = []`) and send the entire conversation history back to the model on every single turn.

### Message Array Structure
```python
messages = [
    {"role": "system",    "content": "You are a helpful demo model in a CS lab."},
    {"role": "user",      "content": "What is binary search?"},
    {"role": "assistant", "content": "Binary search is an O(log n) algorithm..."},
    {"role": "user",      "content": "Can you give me a C++ example?"}, # Model now knows "it" refers to binary search!
]
```

---

## 🚀 Running the Demo (from repo root)

```bash
# Run with default free model
python 02-chat-history/main.py

# Or pass a model name directly as an argument
python 02-chat-history/main.py google/gemma-4-31b-it:free
```

---

## 🔍 How It Works (Line-by-Line)

1. **System Prompt**: We seed `messages` with a system message telling the model its role:
   ```python
   messages = [{"role": "system", "content": "You are a helpful demo model interacting with students in a computer science lab."}]
   ```
2. **User Input**: In each iteration of the `while True` loop, we ask the user for input and append it:
   ```python
   messages.append({"role": "user", "content": user_message})
   ```
3. **Model Generation**: We pass the accumulated `messages` list to `client.chat.completions.create()`.
4. **Append Assistant Reply**: We append the assistant's reply so future turns have full context:
   ```python
   messages.append({"role": "assistant", "content": assistant_reply})
   ```
