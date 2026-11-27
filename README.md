# Tree-Chat — A Branching Conversation Interface for LLMs

A prototype chat application that replaces the usual **linear** conversation
model (ChatGPT, Claude, etc.) with a **tree** model — every message is a node,
you can branch off any point in the conversation, and you explicitly control
whether a new branch inherits the previous context or starts completely fresh.

Built on top of the [`iitgn-aug-26-lab`](https://github.com/championswimmer/iitgn-aug-26-lab)
lab repo, reusing its OpenRouter client setup as the LLM-calling foundation.

---

## Why this project

Normal LLM chats are one long list of messages. As a conversation grows,
every new question drags the *entire* history along as context — even when
the question has nothing to do with most of it.

Example: you're mid-conversation about CPU scheduling (Round Robin, FCFS,
SJF, preemption...) and you suddenly ask "what exactly is a thread?" That
question doesn't need any of the scheduling discussion, but a linear chat
sends it all anyway. You end up with:

- wasted tokens / cost on irrelevant context
- the model's attention diluted across unrelated tangents
- no clean way to revisit one line of thought without the others bleeding in
- zero control over what the model actually "remembers" for a given question

**Tree-Chat** fixes this by letting every message be a node with its own
parent, its own branch, and its own explicit choice: *inherit everything
above me, use only the messages I pick, or start clean.*

## Goal / Aim

Build a working prototype that demonstrates:

1. Conversations represented as a **tree**, not a flat list.
2. Any node can be branched from, creating a new child conversation path.
3. Each new message explicitly chooses its context: **Full** (the whole
   branch above it), **Selected** (any messages you tick, from any branch),
   or **None** (start clean).
4. A visual tree explorer to see and navigate all branches.
5. A familiar, ChatGPT-style chat UI on top of all this — the tree model
   should feel like an enhancement, not a replacement for normal chatting.
6. Long branches stay usable: the UI warns when a branch gets long, and the
   backend automatically summarizes older turns once it passes a token limit.

This is a prototype for demonstration purposes — it favors "everything is
usable end-to-end" over production hardening.

---

## Core concepts

| Concept | What it means here |
|---|---|
| **Node** | One full turn: a user prompt + the assistant's response. Has a parent, optionally a set of children. |
| **Branch** | A path from the root node down to any node — effectively a full linear conversation. |
| **Context mode** | Chosen per message. **Full**: everything the parent saw, plus the parent. **Selected**: only the messages you tick (any branch of the same conversation). **None**: only the new prompt. |
| **Main child** | Each node with multiple children designates one as its "main" line of continuation (the first child created, by default — you can change it with the ★ in the tree). |
| **Leaf node** | A node with no children. Opening a path follows main children down to a leaf. |
| **Summary** | When a message's context passes the summarize limit, older turns are condensed into a summary and only the latest few are sent word for word. |

### How context is assembled (`tree_chat_backend/context.py`)

```
effective_context(node):            # what the model saw for this node
    full     -> effective_context(node.parent) + [node]
    none     -> [node]
    selected -> selected_nodes (oldest first) + [node]

context for a new child of P:
    full     -> effective_context(P)
    none     -> []
    selected -> the ticked nodes
```

### Long chats: warning and summarization (`tree_chat_backend/summarize.py`)

| Setting (env var) | Default | Effect |
|---|---|---|
| `CONTEXT_WARN_TOKENS` | 6000 | Above this, the UI shows a "this branch is getting long — start a separate chat" warning. |
| `CONTEXT_SUMMARIZE_TOKENS` | 12000 | Above this, older turns are summarized before the reply is generated. |
| `KEEP_RECENT_TURNS` | 4 | Turns that are always sent word for word. |

Tokens are estimated as characters ÷ 4. When a send goes over the limit, the
backend summarizes everything except the last `KEEP_RECENT_TURNS` turns with
the same model, sends the summary as a system message, and caches it on the
node where it ends (`Node.context_summary`). The next message on that branch
reuses the cached summary and only folds in the turns added since. If the
summary call fails, the oldest turns are dropped instead. Messages that used a
summary are tagged **Summarized** in the chat and the tree. The frontend reads
the thresholds from `GET /config`.

---

## Repo structure

```
iitgn-aug-26-lab/
├── common/                      # OpenRouter base URL, DEFAULT_MODEL (from the lab repo)
├── tree_chat_backend/
│   ├── app.py                   # FastAPI app: auth, conversations, SSE streaming, /config
│   ├── models.py                # User / Conversation / Node (SQLModel)
│   ├── schemas.py               # request / response models
│   ├── db.py                    # SQLite engine + lightweight migrations
│   ├── auth.py                  # bcrypt passwords, JWT tokens
│   ├── context.py               # effective_context(), context modes, token estimate
│   ├── summarize.py             # long-chat summarization + thresholds
│   ├── openrouter.py            # OpenRouter client (header key or env key)
│   ├── auth_checks.py           # auth / isolation checks
│   ├── sanity_checks.py         # context-building checks
│   └── summarize_checks.py      # context modes + summarization checks (temp DB, fake LLM)
├── tree_chat_frontend/          # React + Vite + TypeScript
│   └── src/
│       ├── App.tsx              # sidebar, chat, composer, branch form, auth, API key
│       ├── TreeView.tsx         # reactflow tree: search, folding, context view, picking
│       ├── treeModel.ts / treeLayout.ts / treeSearch.ts
│       ├── contextView.ts       # mirrors backend context rules for previews
│       ├── ui/ContextPicker.tsx # Full · Selected · None
│       ├── api.ts, types.ts, Markdown.tsx, Icons.tsx, index.css
└── requirements.txt
```

The UI design (palette, tree view, run cards, search) is ported from the
TreeGPT Chrome extension in `cs437--KTP--hack`.

---

## Requirements

- **Python** 3.10+
- **Node.js** 18+ and npm
- A free **OpenRouter API key** — get one at
  [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)

---

## Setup

### 1. Backend (port 8000)

```bash
cd iitgn-aug-26-lab
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn tree_chat_backend.app:app --reload --port 8000
```

- The OpenRouter key can come from `iitgn-aug-26-lab/.env`
  (`OPENROUTER_API_KEY=...`, loaded automatically), the shell environment, or
  the **API key** button in the UI (stored in the browser, sent per request).
- Set `JWT_SECRET_KEY` to your own secret outside local development.
- The SQLite DB (`tree_chat_backend/tree_chat.db`) is created on first run;
  older DBs are migrated automatically (new columns are added).

### 2. Frontend (port 5173)

```bash
cd iitgn-aug-26-lab/tree_chat_frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

### 3. Checks

```bash
cd iitgn-aug-26-lab
python -m tree_chat_backend.summarize_checks   # temp DB, no API key needed
python -m tree_chat_backend.auth_checks        # note: writes test users to tree_chat.db
```

---

## How to use it

1. **Create an account / sign in.** Each user only sees their own chats.
2. **Ask a question** — this creates a new chat (root node). Follow-ups are
   chained to the message on screen.
3. **Set context** with the *Context* chip above the composer (or in the
   branch form): **Full**, **Selected** or **None**. The line underneath says
   exactly how many messages and roughly how many tokens will be sent.
   - In **Selected** mode, tick *Use as context* on messages in the chat, or
     press **Pick in tree** to tick messages from any branch.
4. **Branch** from any reply to ask a side question with its own context.
5. **Tree** opens the full tree: open a path, continue from any node, make a
   path the main one (★), search, fold branches, and press the layers icon to
   see exactly which messages the model saw for a reply.
6. **Long chats**: past the warn limit a banner suggests a separate chat;
   past the summarize limit older turns are summarized automatically.

---

## Model selection

Pick any of the free OpenRouter models from the dropdown in the top bar (the
choice is remembered). Free-tier models occasionally rate-limit or error — the
UI shows the error; pick a different model and retry.

---

## Known limitations (by design, for this prototype)

- No editing or deleting nodes, no re-parenting.
- No merging of branches (strictly a tree, not a DAG).
- Token counts are estimates (characters ÷ 4), not the model's tokenizer.
- Max **10 children per node**, to keep the tree visually readable.
