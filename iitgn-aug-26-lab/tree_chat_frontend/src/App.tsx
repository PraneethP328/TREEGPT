import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createConversation,
  getMe,
  getPath,
  getTree,
  listConversations,
  loginUser,
  registerUser,
  setMainChild,
  streamNode,
} from "./api";
import TreeView from "./TreeView";
import type { ConversationSummary, TreeNode, User } from "./types";

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
  // Auth state
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("tree_chat_jwt"));
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem("tree_chat_user");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  });
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);

  // OpenRouter API Key state
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem("tree_chat_openrouter_key") || "");
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");

  // Chat and Tree state
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
  // Ref for the LAST user message bubble — we scroll to it once a response finishes
  // so the question + answer are both visible (question at top, answer below).
  const lastUserMsgRef = useRef<HTMLDivElement>(null);

  // Tree panel
  const [showTree, setShowTree] = useState(false);
  const [allTreeNodes, setAllTreeNodes] = useState<TreeNode[]>([]);

  // Active path IDs for highlighting in the tree
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

  // While streaming: follow the incoming tokens by scrolling to the bottom.
  useEffect(() => {
    if (streamingText) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamingText]);

  // When a response finishes (messages array updates, streaming is done):
  // scroll to the last user question so the full Q+A exchange is in view.
  useEffect(() => {
    if (messages.length === 0) return;
    lastUserMsgRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [messages]);

  // Verify and load token on startup
  useEffect(() => {
    if (!token) return;
    getMe(token)
      .then((verifiedUser) => {
        setUser(verifiedUser);
        localStorage.setItem("tree_chat_user", JSON.stringify(verifiedUser));
        void refreshConversations(token);
      })
      .catch(() => {
        handleLogout("Your session has expired. Please sign in again.");
      });
  }, [token]);

  const handleLogout = useCallback((customError?: string) => {
    localStorage.removeItem("tree_chat_jwt");
    localStorage.removeItem("tree_chat_user");
    setToken(null);
    setUser(null);
    setConversations([]);
    setConversationId(null);
    setPathNodes([]);
    setAllTreeNodes([]);
    setPrompt("");
    setStreamingText("");
    setBranchState(null);
    if (customError) {
      setAuthError(customError);
    }
  }, []);

  async function refreshConversations(authToken: string): Promise<void> {
    try {
      const items = await listConversations(authToken);
      setConversations(items);
      setError(null);
    } catch (err) {
      const msg = getErrorMessage(err);
      if (msg.includes("401") || msg.toLowerCase().includes("credentials")) {
        handleLogout("Session expired. Please sign in again.");
      } else {
        setError(msg);
      }
    }
  }

  async function handleAuthSubmit(e: FormEvent) {
    e.preventDefault();
    setAuthError(null);
    if (!authUsername.trim() || !authPassword.trim()) {
      setAuthError("Username and password are required.");
      return;
    }

    setIsAuthSubmitting(true);
    try {
      let resp;
      if (authMode === "register") {
        resp = await registerUser(authUsername, authPassword, authEmail);
      } else {
        resp = await loginUser(authUsername, authPassword);
      }

      setToken(resp.access_token);
      setUser(resp.user);
      localStorage.setItem("tree_chat_jwt", resp.access_token);
      localStorage.setItem("tree_chat_user", JSON.stringify(resp.user));
      setAuthUsername("");
      setAuthPassword("");
      setAuthEmail("");
      await refreshConversations(resp.access_token);
    } catch (err) {
      setAuthError(getErrorMessage(err));
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function openConversation(id: string): Promise<void> {
    if (!token) return;
    try {
      const nodes = await getTree(token, id);
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

  async function openTree(): Promise<void> {
    if (!token || !conversationId) return;
    try {
      const nodes = await getTree(token, conversationId);
      setAllTreeNodes(nodes);
      setShowTree(true);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  const handleSelectLeaf = useCallback(
    async (leafId: string): Promise<void> => {
      if (!token || !conversationId) return;
      try {
        const path = await getPath(token, conversationId, leafId);
        setPathNodes(path);
        setBranchState(null);
        setShowTree(false);
        setError(null);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    },
    [token, conversationId],
  );

  const handleSetMainChild = useCallback(
    async (parentId: string, childId: string): Promise<void> => {
      if (!token || !conversationId) return;
      try {
        await setMainChild(token, parentId, childId);
        const nodes = await getTree(token, conversationId);
        setAllTreeNodes(nodes);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    },
    [token, conversationId],
  );

  const handleChatFromNode = useCallback(
    async (nodeId: string): Promise<void> => {
      if (!token || !conversationId) return;
      try {
        const path = await getPath(token, conversationId, nodeId);
        setPathNodes(path);
        setBranchState(null);
        setShowTree(false);
        setError(null);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    },
    [token, conversationId],
  );

  async function handleSend(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!token) return;

    if (!apiKey) {
      setShowApiKeyModal(true);
      setError("Please set your OpenRouter API key to chat with AI models.");
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
        const created = await createConversation(token, apiKey, text, model);
        setConversationId(created.conversation.id);
        await refreshConversations(token);
        const path = await getPath(token, created.conversation.id, created.root_node_id);
        setPathNodes(path);
        return;
      }

      const parentNode = pathNodes[pathNodes.length - 1];
      let doneNode: TreeNode | null = null;

      await streamNode(
        token,
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

      const freshPath = await getPath(token, conversationId, (doneNode as TreeNode).id);
      setPathNodes(freshPath);

      await refreshConversations(token);
      const updatedTree = await getTree(token, conversationId);
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

  async function handleBranchSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!token || !conversationId || !branchState) return;

    if (!apiKey) {
      setShowApiKeyModal(true);
      setError("Please set your OpenRouter API key.");
      return;
    }

    const text = branchState.prompt.trim();
    if (!text || isLoading) return;

    setIsLoading(true);
    setError(null);
    setStreamingText("");

    try {
      let doneNode: TreeNode | null = null;

      await streamNode(
        token,
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
      const newPath = await getPath(token, conversationId, (doneNode as TreeNode).id);
      setPathNodes(newPath);
      setStreamingText("");
      setBranchState(null);
      await refreshConversations(token);
      const updatedTree = await getTree(token, conversationId);
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

  function handleSaveApiKey(event: FormEvent): void {
    event.preventDefault();
    const cleanKey = apiKeyInput.trim();
    setApiKey(cleanKey);
    localStorage.setItem("tree_chat_openrouter_key", cleanKey);
    setShowApiKeyModal(false);
    setApiKeyInput("");
    setError(null);
  }

  // ── 1. If not authenticated, render Login / Register view ───────────────────
  if (!token || !user) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1>Tree Chat</h1>
            <p>Branching Conversations with Isolated User Chats</p>
          </div>

          <div className="auth-tabs">
            <button
              className={`auth-tab ${authMode === "login" ? "active" : ""}`}
              onClick={() => {
                setAuthMode("login");
                setAuthError(null);
              }}
              type="button"
            >
              Sign In
            </button>
            <button
              className={`auth-tab ${authMode === "register" ? "active" : ""}`}
              onClick={() => {
                setAuthMode("register");
                setAuthError(null);
              }}
              type="button"
            >
              Create Account
            </button>
          </div>

          <form className="auth-form" onSubmit={(e) => void handleAuthSubmit(e)}>
            <div className="form-field">
              <label>Username</label>
              <input
                type="text"
                placeholder="e.g. alice or user1"
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                autoFocus
                required
              />
            </div>

            {authMode === "register" && (
              <div className="form-field">
                <label>Email (Optional)</label>
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                />
              </div>
            )}

            <div className="form-field">
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                required
              />
            </div>

            {authError && <div className="error">{authError}</div>}

            <button type="submit" className="auth-submit-btn" disabled={isAuthSubmitting}>
              {isAuthSubmitting
                ? "Authenticating…"
                : authMode === "login"
                ? "Sign In to Your Workspace"
                : "Create Account & Sign In"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── 2. Authenticated Workspace ──────────────────────────────────────────────
  return (
    <>
      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-header">
            <button onClick={startNewChat}>+ New Chat</button>
          </div>

          <div className="conversation-list">
            {conversations.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: "13px", padding: "8px" }}>
                No chats yet. Start a new conversation!
              </div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={conversation.id === conversationId ? "conversation active" : "conversation"}
                  onClick={() => void openConversation(conversation.id)}
                >
                  {conversation.title}
                </button>
              ))
            )}
          </div>

          {/* User profile & isolated session footer */}
          <div className="sidebar-user-panel">
            <div className="user-badge-row">
              <div className="user-identity">
                <div className="user-avatar">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <div className="user-meta">
                  <span className="user-name">@{user.username}</span>
                  <span className="user-scope">● Private Workspace</span>
                </div>
              </div>
              <button
                type="button"
                className="btn-signout"
                title="Sign out of account"
                onClick={() => handleLogout()}
              >
                Sign Out
              </button>
            </div>
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

              <button
                type="button"
                className="api-key-btn"
                title={apiKey ? "Update OpenRouter API Key" : "Set OpenRouter API Key"}
                onClick={() => {
                  setApiKeyInput(apiKey);
                  setShowApiKeyModal(true);
                }}
              >
                {apiKey ? "🔑 Key Active" : "⚠️ Set API Key"}
              </button>

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
              <div className="empty-state">Ask anything to begin. Every branch you create is private to @{user.username}.</div>
            ) : (
              messages.map((message, index) => {
                const showBranchFormHere =
                  message.role === "assistant" &&
                  branchState?.nodeId === message.nodeId;

                // Identify the very last user message so we can attach the scroll ref.
                // Messages alternate user/assistant, so the last user msg is at
                // index messages.length - 2 (second-to-last overall).
                const isLastUserMsg =
                  message.role === "user" && index === messages.length - 2;

                return (
                  <div
                    key={`${message.nodeId}-${message.role}-${index}`}
                    ref={isLastUserMsg ? lastUserMsgRef : undefined}
                  >
                    <div className={`bubble ${message.role}`}>
                      <div className="role">{message.role === "user" ? "You" : "Assistant"}</div>
                      <div>{message.content}</div>
                      {message.role === "assistant" && message.model ? (
                        <div className="model-tag">{message.model}</div>
                      ) : null}
                      {/* Branch button — only on assistant bubbles */}
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

      {/* OpenRouter API Key Modal */}
      {showApiKeyModal && (
        <div className="key-modal-overlay">
          <form className="key-card" onSubmit={handleSaveApiKey}>
            <div className="auth-header">
              <h1>OpenRouter API Key</h1>
              <p>Enter your key from openrouter.ai/settings/keys</p>
            </div>
            <input
              type="password"
              placeholder="sk-or-v1-..."
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              autoFocus
            />
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "8px" }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowApiKeyModal(false)}
                style={{ background: "transparent", border: "1px solid #374151", color: "#9ca3af", borderRadius: "8px", padding: "10px 14px", cursor: "pointer" }}
              >
                Close
              </button>
              <button type="submit" style={{ background: "#2563eb", border: 0, color: "white", borderRadius: "8px", padding: "10px 14px", cursor: "pointer" }}>
                Save Key
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tree Visualization */}
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
