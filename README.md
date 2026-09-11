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
above me, or start clean.*

## Goal / Aim

Build a working prototype that demonstrates:

1. Conversations represented as a **tree**, not a flat list.
2. Any node can be branched from, creating a new child conversation path.
3. Each new node explicitly chooses to **inherit context from its parent
   chain** or **start with zero inherited context**.
4. A visual tree explorer to see and navigate all branches.
5. A familiar, ChatGPT-style chat UI on top of all this — the tree model
   should feel like an enhancement, not a replacement for normal chatting.

This is a prototype for demonstration purposes — it favors "everything is
usable end-to-end" over production hardening.

---

## Core concepts

| Concept | What it means here |
|---|---|
| **Node** | One full turn: a user prompt + the assistant's response. Has a parent, optionally a set of children. |
| **Branch** | A path from the root node down to any node — effectively a full linear conversation. |
| **`include_parent_context`** | A per-node flag. `true` → this node's prompt is sent to the LLM along with every ancestor back to the root. `false` → this node starts with no prior context at all. |
| **Main child** | Each node with multiple children designates one as its "main" line of continuation (the first child created, by default — user can change it). Clicking a non-leaf node in the tree follows main children down to a leaf. |
| **Leaf node** | A node with no children. Selecting a leaf reloads the full chat view for that entire branch, root to leaf. |

### How context is assembled

```
build_context(node):
    if node.parent is None or node.include_parent_context is False:
        return [node]
    return build_context(node.parent) + [node]
```

This one function is the heart of the project — it decides exactly what gets
sent to the LLM for any given message, based on where in the tree it lives
and whether it was told to "forget" everything above it.

---

## Repo structure

```
tree-chat/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app entrypoint
│   │   ├── models.py          # Node / Conversation DB models (SQLModel)
│   │   ├── schemas.py         # Pydantic request/response schemas
│   │   ├── context.py         # build_context() + related tree logic
│   │   ├── routes/
│   │   │   ├── conversations.py
│   │   │   └── nodes.py
│   │   └── llm.py             # OpenRouter client (extends common/ from the lab repo)
│   ├── db.sqlite3             # local SQLite database (created on first run)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ChatView.jsx       # linear message view for the active branch
│   │   │   ├── TreeView.jsx       # reactflow-based tree visualization
│   │   │   ├── Sidebar.jsx        # conversation list / "New Chat"
│   │   │   ├── BranchForm.jsx     # "branch from here" input + context toggle
│   │   │   └── ModelPicker.jsx    # dropdown of free OpenRouter models
│   │   ├── api.js              # fetch/SSE calls to the backend
│   │   ├── store.js             # app state (active conversation, active node)
│   │   └── App.jsx
│   ├── package.json
│   └── vite.config.js
├── common/                     # reused as-is from the original lab repo
│   └── __init__.py             # get_client(), DEFAULT_MODEL
└── README.md
```

*(Folder names above reflect the intended structure — adjust to match
whatever your IDE AI actually generates as you build it out step by step.)*

---

## Requirements

- **Python** 3.10+
- **Node.js** 18+ and npm
- A free **OpenRouter API key** — get one at
  [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)
- (Optional but recommended) a virtual environment for the backend

---

## Setup

### 1. Clone and set your API key

```bash
git clone <your-repo-url>
cd tree-chat
export OPENROUTER_API_KEY="sk-or-v1-..."
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API will be live at `http://localhost:8000`. SQLite database file is
created automatically on first run — no separate DB setup needed.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`).

---

## How to use it

1. **Start a new chat** from the sidebar — this creates a root node.
2. **Chat normally** — each message you send becomes a node, chained to the
   previous one, inheriting context by default (just like a normal chat).
3. **Branch off any message**: hit "Branch from here" on any message bubble.
   - Choose whether the new branch should **inherit** everything above it,
     or **start fresh** with no prior context.
   - Optionally pick a different model for this branch (useful if the
     current free model is rate-limited).
4. **Open the tree view** via the "Tree" button next to the chat.
   - Nodes with multiple children fan out visually.
   - The **main child** of each node is indicated (e.g. highlighted edge) —
     this is the default path followed when you click a non-leaf node.
5. **Navigate branches**:
   - Click any **non-leaf** node → chat loads that node, then follows its
     main-child chain down to a leaf.
   - Click a **leaf** node → chat reloads the *entire* branch from root to
     that leaf, showing every prompt/response pair along the way.
6. **Change the main child** of a node from the tree view if you want a
   different branch to be the "default" continuation.

---

## Model selection

A small dropdown lets you pick between a handful of free OpenRouter models
(e.g. `nvidia/nemotron-3.5-lightning:free`, `google/gemma-4-31b-it:free`,
`cohere/north-mini-code:free`). Free-tier models occasionally rate-limit or
return errors — if that happens, the UI will surface the error; just pick a
different model from the dropdown and retry.

---

## Known limitations (by design, for this prototype)

- No authentication / multi-user support — single local API key.
- No editing or deleting nodes, no re-parenting.
- No merging of branches (strictly a tree, not a DAG).
- No automatic/semantic context selection — inheritance is a manual on/off
  choice per branch.
- Max **10 children per node**, to keep the tree visually readable.
- Basic error handling only — no automatic retries on rate limits.

These are intentional scope cuts for a prototype, not oversights — see the
project write-up for the reasoning and what a V2 could add.

---

## Tech stack

- **Backend**: FastAPI, SQLite (SQLModel), Server-Sent Events for streaming
- **Frontend**: React + Vite, reactflow (tree visualization)
- **LLM provider**: OpenRouter (free-tier models)
