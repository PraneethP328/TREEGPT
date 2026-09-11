# IITGN AI Harness Lab

A pedagogical lab designed to teach undergraduate students how to build their own **AI agent harness** from scratch in incremental, self-contained steps.

---

## ⚙️ Environment Setup

### 1. Create and Activate Virtual Environment

```bash
# Create virtual environment
python3 -m venv .venv

# Activate virtual environment
source .venv/bin/activate       # On macOS/Linux
# .venv\Scripts\activate        # On Windows
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Set OpenRouter API Key

Get a free key from [OpenRouter Keys](https://openrouter.ai/settings/keys) and export it:

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

---

## 🧑‍💻 Editor / IDE Setup (Zed, VS Code, PyCharm)

If your editor (like Zed with Pyright) shows missing import warnings for `openai` or `common`:
- The included [`pyrightconfig.json`](file:///Users/championswimmer/Development/Teaching/iitgn-ai-harness/pyrightconfig.json) automatically links your active Python path, `.venv`, and `extraPaths: ["."]`.
- If using a custom virtual environment, ensure your editor's interpreter is set to `.venv/bin/python`.

---

## 📚 Lab Modules

| Step | Topic | Description |
| :--- | :--- | :--- |
| **[01-llm-api-call](file:///Users/championswimmer/Development/Teaching/iitgn-ai-harness/01-llm-api-call/)** | Direct LLM API Call | Make a single API call to OpenRouter free models and inspect token usage. |
| **[02-chat-history](file:///Users/championswimmer/Development/Teaching/iitgn-ai-harness/02-chat-history/)** | Multi-Turn Chat | Maintain conversational state across multi-turn interactions. |
| **[03-tool-calling](file:///Users/championswimmer/Development/Teaching/iitgn-ai-harness/03-tool-calling/)** | Function Calling & Tools | Equip the model with live tools (`time`, `weather`) and handle execution loop. |

---

## 🛠️ Shared Helpers (`common/`)

All demos use [`common/__init__.py`](file:///Users/championswimmer/Development/Teaching/iitgn-ai-harness/common/__init__.py):
- `get_client()`: Authenticated OpenAI client for OpenRouter.
- `DEFAULT_MODEL`: Centralized free model selector.
- `loading`: Terminal loading spinner (`. .. ... ....`).

---

## 🌳 Tree Chat Prototype (FastAPI + React)

This repository now also includes a prototype tree-chat stack:
- Backend: [`tree_chat_backend/`](/Users/praneethpabbathi/Desktop/TREEGPT/iitgn-aug-26-lab/tree_chat_backend)
- Frontend: [`tree_chat_frontend/`](/Users/praneethpabbathi/Desktop/TREEGPT/iitgn-aug-26-lab/tree_chat_frontend)

### Run backend
```bash
/Users/praneethpabbathi/Desktop/TREEGPT/.venv/bin/python -m uvicorn tree_chat_backend.app:app --host 127.0.0.1 --port 8000
```

### Run frontend
```bash
cd tree_chat_frontend
npm install
npm run dev
```

Frontend opens at `http://localhost:5173` and asks for an OpenRouter key at startup.
