# Step 01: Direct LLM API Call

Welcome to **Step 01** of the IIT Gandhinagar AI Harness Lab!

In this module, we explore the fundamental building block of an AI agent harness: **making a direct API call to a Large Language Model (LLM)** and inspecting token usage statistics.

---

## 🎯 Learning Objectives

1. Understand how OpenAI-compatible API clients interact with OpenRouter endpoints.
2. Securely read `$OPENROUTER_API_KEY` via a shared common library ([`common/__init__.py`](file:///Users/championswimmer/Development/Teaching/iitgn-ai-harness/common/__init__.py)).
3. Send a prompt to a free model and inspect the response and token usage metrics.

---

## 🌐 OpenRouter Free Models

[OpenRouter](https://openrouter.ai/) provides a unified OpenAI-compatible endpoint that routes requests to dozens of model providers.

> [!NOTE]
> Read the official documentation on free models here:
> **https://openrouter.ai/openrouter/free**

By default, the demo uses `google/gemma-4-31b-it:free` (configured in `common`).

---

## 🚀 Running the Demo

### 1. Set Your API Key
```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

### 2. Run with Default Prompt (from repo root)
```bash
python 01-llm-api-call/main.py
```

### 3. Run with a Custom Prompt (and Optional Model)
```bash
# Custom prompt
python 01-llm-api-call/main.py "Explain binary search in one sentence."

# Custom prompt + specific free model
python 01-llm-api-call/main.py "What is recursion?" google/gemma-4-31b-it:free
```

---

## 🔍 Code Walkthrough

```python
from common import get_client, DEFAULT_MODEL

# 1. Get client authenticated via OPENROUTER_API_KEY
client = get_client()

# 2. Send prompt to the model
response = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": prompt}],
)

# 3. Print reply and token stats
print(response.choices[0].message.content)
print(f"Prompt Tokens: {response.usage.prompt_tokens}")
print(f"Completion Tokens: {response.usage.completion_tokens}")
```
