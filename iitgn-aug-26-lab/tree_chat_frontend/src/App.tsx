import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createConversation,
  getPath,
  getTree,
  listConversations,
  setMainChild,
  streamNode,
} from "./api";
import TreeView from "./TreeView";
import type { ConversationSummary, TreeNode } from "./types";

const MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-3-27b-it:free",
  "google/gemma-3-12b-it:free",
  "cohere/north-mini-code:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
  "qwen/qwen3-235b-a22b:free",
  "deepseek/deepseek-r1-0528:free",
];

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  nodeId: string;
  model?: string;
};

type BranchState = {
  nodeId: string;
  prompt: string;
  inheritContext: boolean;
  model: string;
};

function App() {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [model, setModel] = useState(MODELS[0]);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pathNodes, setPathNodes] = useState<TreeNode[]>([]);

  // Branch form: null = no branch form open
  const [branchState, setBranchState] = useState<BranchState | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Tree panel
  const [showTree, setShowTree] = useState(false);
  const [allTreeNodes, setAllTreeNodes] = useState<TreeNode[]>([]);

  // IDs of nodes in the currently displayed path (for highlighting in tree)
  const activePathIds = useMemo(() => new Set(pathNodes.map((n) => n.id)), [pathNodes]);

  const messages = useMemo(() => {
    const result: ChatMessage[] = [];
    for (const node of pathNodes) {
      result.push({ role: "user", content: node.prompt, nodeId: node.id });
      result.push({
        role: "assistant",
        content: node.response,
        nodeId: node.id,
        model: node.model_used,
      });
    }
    return result;
  }, [pathNodes]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    if (!apiKey) {
      return;
    }
    void refreshConversations(apiKey);
  }, [apiKey]);

  async function refreshConversations(key: string): Promise<void> {
    try {
      const items = await listConversations(key);
      setConversations(items);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function openConversation(id: string): Promise<void> {
    if (!apiKey) return;
    try {
      const nodes = await getTree(apiKey, id);
      const path = deriveMainPath(nodes);
      setConversationId(id);
      setPathNodes(path);
      setAllTreeNodes(nodes);
      setBranchState(null);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  /** Open the tree panel and (re-)fetch the latest node list. */
  async function openTree(): Promise<void> {
    if (!apiKey || !conversationId) return;
    try {
      const nodes = await getTree(apiKey, conversationId);
      setAllTreeNodes(nodes);
      setShowTree(true);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  /**
   * Called when the user clicks a node in the tree.
   * leafId is already the effective leaf (main-child chain resolved in TreeView).
   * Load the full root→leaf path into the chat view.
   */
  const handleSelectLeaf = useCallback(
    async (leafId: string): Promise<void> => {
      if (!apiKey || !conversationId) return;
      try {
        const path = await getPath(apiKey, conversationId, leafId);
        setPathNodes(path);
        setBranchState(null);
        setShowTree(false);
        setError(null);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    },
    [apiKey, conversationId],
  );

  /** Set a node as the main child of its parent, then refresh the tree. */
  const handleSetMainChild = useCallback(
    async (parentId: string, childId: string): Promise<void> => {
      if (!apiKey || !conversationId) return;
      try {
        await setMainChild(apiKey, parentId, childId);
        // Refresh tree nodes to reflect the updated main_child_id
        const nodes = await getTree(apiKey, conversationId);
        setAllTreeNodes(nodes);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    },
    [apiKey, conversationId],
  );

  /**
   * "Chat from here" — navigates to exactly nodeId (not the main-child leaf).
   * The chat view shows root→nodeId. The composer will then create a child of nodeId.
   * This is how the user continues a branch from a mid-tree node.
   */
  const handleChatFromNode = useCallback(
    async (nodeId: string): Promise<void> => {
      if (!apiKey || !conversationId) return;
      try {
        const path = await getPath(apiKey, conversationId, nodeId);
        setPathNodes(path);
        setBranchState(null);
        setShowTree(false);
        setError(null);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    },
    [apiKey, conversationId],
  );

  async function handleSend(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!apiKey) {
      setError("Enter your OpenRouter API key first.");
      return;
    }
    const text = prompt.trim();
    if (!text || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setStreamingText("");
    setPrompt("");

    try {
      if (!conversationId || pathNodes.length === 0) {
        const created = await createConversation(apiKey, text, model);
        setConversationId(created.conversation.id);
        await refreshConversations(apiKey);
        const path = await getPath(apiKey, created.conversation.id, created.root_node_id);
        setPathNodes(path);
        return;
      }

      const parentNode = pathNodes[pathNodes.length - 1];
      let doneNode: TreeNode | null = null;

      await streamNode(
        apiKey,
        {
          conversationId,
          parentId: parentNode.id,
          prompt: text,
          model,
        },
        (streamEvent) => {
          if (streamEvent.type === "token") {
            setStreamingText((prev) => prev + streamEvent.token);
          } else if (streamEvent.type === "error") {
            setError(streamEvent.error);
          } else if (streamEvent.type === "done") {
            doneNode = streamEvent.node;
          }
        },
      );

      if (!doneNode) {
        throw new Error("The model stream ended without a final node.");
      }
      setStreamingText("");

      // Reload the full path from DB so every node has fresh main_child_id.
      // The `done` event gives us the new node but the parent's main_child_id
      // is updated on the server AFTER that — so we must re-fetch.
      const freshPath = await getPath(apiKey, conversationId!, (doneNode as TreeNode).id);
      setPathNodes(freshPath);

      await refreshConversations(apiKey);
      const updatedTree = await getTree(apiKey, conversationId!);
      setAllTreeNodes(updatedTree);

    } catch (err) {
      setStreamingText("");
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  function startNewChat(): void {
    setConversationId(null);
    setPathNodes([]);
    setPrompt("");
    setStreamingText("");
    setError(null);
    setBranchState(null);
  }

  /** Called when the user submits the inline branch form. */
  async function handleBranchSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!apiKey || !conversationId || !branchState) return;
    const text = branchState.prompt.trim();
    if (!text || isLoading) return;

    setIsLoading(true);
    setError(null);
    setStreamingText("");

    try {
      let doneNode: TreeNode | null = null;

      await streamNode(
        apiKey,
        {
          conversationId,
          parentId: branchState.nodeId,
          prompt: text,
          model: branchState.model,
          includeParentContext: branchState.inheritContext,
        },
        (streamEvent) => {
          if (streamEvent.type === "token") setStreamingText((prev) => prev + streamEvent.token);
          else if (streamEvent.type === "error") setError(streamEvent.error);
          else if (streamEvent.type === "done") doneNode = streamEvent.node;
        },
      );

      if (!doneNode) throw new Error("Stream ended without a final node.");
      const newPath = await getPath(apiKey, conversationId, (doneNode as TreeNode).id);
      setPathNodes(newPath);
      setStreamingText("");
      setBranchState(null);
      await refreshConversations(apiKey);
      const updatedTree = await getTree(apiKey, conversationId);
      setAllTreeNodes(updatedTree);

    } catch (err) {
      setStreamingText("");
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  function openBranchForm(nodeId: string): void {
    setBranchState({ nodeId, prompt: "", inheritContext: true, model });
  }

  function handleSetApiKey(event: FormEvent): void {
    event.preventDefault();
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setError("Please enter a valid OpenRouter API key.");
      return;
    }
    setApiKey(trimmed);
    setApiKeyInput("");
    setError(null);
  }

  if (!apiKey) {
    return (
      <div className="key-gate">
        <form className="key-card" onSubmit={handleSetApiKey}>
          <h1>Tree Chat Prototype</h1>
          <p>Enter your OpenRouter API key to start.</p>
          <input
            type="password"
            placeholder="sk-or-v1-..."
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
          />
          <button type="submit">Continue</button>
          {error ? <div className="error">{error}</div> : null}
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-header">
            <button onClick={startNewChat}>+ New Chat</button>
          </div>
          <div className="conversation-list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={conversation.id === conversationId ? "conversation active" : "conversation"}
                onClick={() => void openConversation(conversation.id)}
              >
                {conversation.title}
              </button>
            ))}
          </div>
        </aside>

        <main className="chat-shell">
          <header className="chat-header">
            <h2>{conversationId ? "Conversation" : "New Chat"}</h2>
            <div className="chat-header-controls">
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {MODELS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              {conversationId && (
                <button
                  className="tree-open-btn"
                  title="View conversation tree"
                  onClick={() => void openTree()}
                >
                  🌲 Tree
                </button>
              )}
            </div>
          </header>

          <section className="messages">
            {messages.length === 0 ? (
              <div className="empty-state">Ask anything to begin.</div>
            ) : (
              messages.map((message, index) => {
                const showBranchFormHere =
                  message.role === "assistant" &&
                  branchState?.nodeId === message.nodeId;

                return (
                  <div key={`${message.nodeId}-${message.role}-${index}`}>
                    <div className={`bubble ${message.role}`}>
                      <div className="role">{message.role === "user" ? "You" : "Assistant"}</div>
                      <div>{message.content}</div>
                      {message.role === "assistant" && message.model ? (
                        <div className="model-tag">{message.model}</div>
                      ) : null}
                      {/* Branch button — only on assistant bubbles, only when a conversation is open */}
                      {message.role === "assistant" && conversationId && !isLoading ? (
                        <div className="bubble-actions">
                          {!showBranchFormHere ? (
                            <button
                              className="branch-btn"
                              title="Branch from this point"
                              onClick={() => openBranchForm(message.nodeId)}
                            >
                              ⎇ Branch
                            </button>
                          ) : (
                            <button
                              className="branch-btn cancel"
                              onClick={() => setBranchState(null)}
                            >
                              ✕ Cancel
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>

                    {/* Inline branch form anchored to this bubble */}
                    {showBranchFormHere && (
                      <BranchForm
                        state={branchState!}
                        models={MODELS}
                        isLoading={isLoading}
                        onChange={(patch) => setBranchState((prev) => prev ? { ...prev, ...patch } : prev)}
                        onSubmit={(e) => void handleBranchSubmit(e)}
                        onCancel={() => setBranchState(null)}
                      />
                    )}
                  </div>
                );
              })
            )}

            {streamingText ? (
              <div className="bubble assistant">
                <div className="role">Assistant</div>
                <div>{streamingText}</div>
                <div className="typing">Streaming…</div>
              </div>
            ) : null}

            <div ref={messagesEndRef} />
          </section>

          {error ? <div className="error-banner">{error}</div> : null}

          <form className="composer" onSubmit={(e) => void handleSend(e)}>
            <input
              placeholder={branchState ? "Close the branch form above to continue here…" : "Send a message…"}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isLoading || !!branchState}
            />
            <button type="submit" disabled={isLoading || prompt.trim().length === 0 || !!branchState}>
              {isLoading ? "Sending…" : "Send"}
            </button>
          </form>
        </main>
      </div>

      {/* Tree — position:fixed, full-screen, renders above everything */}
      {showTree && conversationId && (
        <TreeView
          treeNodes={allTreeNodes}
          activePathIds={activePathIds}
          onShowBranch={(id) => void handleSelectLeaf(id)}
          onChatFromNode={(id) => void handleChatFromNode(id)}
          onSetMainChild={(parentId, childId) => void handleSetMainChild(parentId, childId)}
          onClose={() => setShowTree(false)}
        />
      )}
    </>
  );
}

// ── BranchForm component ─────────────────────────────────────────────────────
type BranchFormProps = {
  state: BranchState;
  models: string[];
  isLoading: boolean;
  onChange: (patch: Partial<BranchState>) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
};

function BranchForm({ state, models, isLoading, onChange, onSubmit, onCancel }: BranchFormProps) {
  return (
    <form className="branch-form" onSubmit={onSubmit}>
      <div className="branch-form-header">
        <span className="branch-form-title">⎇ New Branch</span>
        <span className="branch-form-hint">Branching from this node — creates a sibling path</span>
      </div>

      <textarea
        className="branch-textarea"
        placeholder="Your branch prompt…"
        value={state.prompt}
        rows={3}
        onChange={(e) => onChange({ prompt: e.target.value })}
        disabled={isLoading}
        autoFocus
      />

      <div className="branch-form-controls">
        <label className={`context-toggle ${state.inheritContext ? "on" : "off"}`}>
          <input
            type="checkbox"
            checked={state.inheritContext}
            onChange={(e) => onChange({ inheritContext: e.target.checked })}
            disabled={isLoading}
          />
          {state.inheritContext ? "📎 Inheriting parent context" : "🔇 Fresh start (no context)"}
        </label>

        <select
          value={state.model}
          onChange={(e) => onChange({ model: e.target.value })}
          disabled={isLoading}
        >
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>

        <div className="branch-form-actions">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={isLoading}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={isLoading || state.prompt.trim().length === 0}
          >
            {isLoading ? "Branching…" : "Send Branch"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function deriveMainPath(nodes: TreeNode[]): TreeNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const root = nodes.find((node) => node.parent_id === null);
  if (!root) {
    return [];
  }

  const path: TreeNode[] = [root];
  let current = root;
  while (current.main_child_id) {
    const next = byId.get(current.main_child_id);
    if (!next) {
      break;
    }
    path.push(next);
    current = next;
  }
  return path;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong.";
}

export default App;
