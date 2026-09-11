# Incremental Agent Harness Lab Plan

## Overview
This plan outlines the staged, step-by-step curriculum for undergraduate students at IIT Gandhinagar to build an AI agent harness from scratch. Each step lives in its own self-contained folder (e.g. `01-llm-api-call`, `02-...`) for clear incremental learning and demonstration.

---

## 🎯 Pedagogical Goals
- **Step 1: Direct LLM API Call (`01-llm-api-call`)**: Learn how OpenAI-compatible API clients interact with OpenRouter free-tier LLM endpoints, handle tokens/metadata, and manage environment secrets.
- **Future Incremental Steps (Roadmap)**:
  - Step 2: System Prompts & Structured Chat History (Role management, conversation loops).
  - Step 3: Tool Calling & Function Schemas (JSON schema definitions, model tool-call parsing).
  - Step 4: Tool Execution Loop & Error Handling (Executing native functions, returning tool results to context).
  - Step 5: Context Window & Compaction/Pruning (Token budget management, sliding windows).
  - Step 6: Memory & State Persistence (File/DB memory, scratchpads).
  - Step 7: Subagent & Multi-Agent Orchestration (Delegation, hierarchical agent loops).
  - Step 8: Evaluation & Benchmarking Harness (Testing harness resilience, task success rates).

---

## 📦 Step 01 Specification: `01-llm-api-call`

### Core Requirements
1. Use the official `openai` Python SDK configured with OpenRouter base URL (`https://openrouter.ai/api/v1`).
2. Read `$OPENROUTER_API_KEY` from environment variables (or `.env` file via `python-dotenv`).
3. Use a free OpenRouter model by default (e.g. `meta-llama/llama-3.3-70b-instruct:free` or `google/gemini-2.0-flash-lite-preview-02-05:free`).
4. Accept an optional CLI prompt argument (e.g. `python main.py "your prompt here"`).
5. Default prompt fallback: `"hello! how are you? tell me an interesting fact about India"`.
6. Neatly display LLM response and execution statistics (model name, prompt tokens, completion tokens, total tokens, latency).
7. Complete documentation in `README.md` referencing https://openrouter.ai/openrouter/free.

### Deliverables
- `01-llm-api-call/main.py`: Executable Python script with clean typing and error messages.
- `01-llm-api-call/requirements.txt`: Minimal dependencies (`openai`, `python-dotenv`).
- `01-llm-api-call/.env.example`: Template for setting API credentials.
- `01-llm-api-call/README.md`: Student tutorial and walkthrough.
