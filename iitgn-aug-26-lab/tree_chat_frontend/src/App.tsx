// Tree Chat web app. Layout and look ported from the TreeGPT side panel (cs437--KTP--hack);
// answers come from the FastAPI backend (OpenRouter), with JWT auth and per-message context:
// Full · Selected · None. Long branches are summarized by the backend; the UI warns before that.
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createConversation,
  getConfig,
  getMe,
  getTree,
  listConversations,
  loginUser,
  registerUser,
  setMainChild,
  streamNode,
  toTreeNode,
} from "./api";
import { Icon } from "./Icons";
import Markdown from "./Markdown";
import TreeView from "./TreeView";
import Dropdown, { type DropdownItem } from "./ui/Dropdown";
import Notice from "./ui/Notice";
import ContextPicker from "./ui/ContextPicker";
import { DEFAULT_CONFIG, contextForNew, fmtTokens, modeLabel, previewFor, sumTokens, windowIds } from "./contextView";
import type { AppConfig, ContextMode, ConversationSummary, TreeNode, User } from "./types";

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

const LS = {
  token: "tree_chat_jwt",
  user: "tree_chat_user",
  apiKey: "tree_chat_openrouter_key",
  model: "tree_chat_model",
};

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: keep working for this session */
  }
}

type BranchState = { nodeId: string; prompt: string; mode: ContextMode };
type Pending = { parentId: string | null; kind: "send" | "branch"; prompt: string; conversationId: string | null };
type SummaryInfo = { from: number; to: number; trimmed: boolean };

// Enter sends, Shift+Enter is a new line; ignored while an IME is composing a character.
function isSendKey(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;
}

const short = (text: string, max = 60): string => (text.length > max ? text.slice(0, max) + "…" : text);
const plural = (n: number, one: string, many = one + "s"): string => `${n} ${n === 1 ? one : many}`;
const modelShort = (m: string): string => m.split("/").pop()?.replace(/:free$/, "") ?? m;

function pathTo(byId: Map<string, TreeNode>, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out.reverse();
}

function mainPathFrom(byId: Map<string, TreeNode>, startId: string): string[] {
  const out = pathTo(byId, startId);
  const seen = new Set(out);
  let cur = byId.get(startId);
  while (cur?.mainChildId && !seen.has(cur.mainChildId)) {
    const next = byId.get(cur.mainChildId);
    if (!next) break;
    seen.add(next.id);
    out.push(next.id);
    cur = next;
  }
  return out;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export default function App() {
  // ── auth ──
  const [token, setToken] = useState<string | null>(() => lsGet(LS.token));
  const [user, setUser] = useState<User | null>(() => {
    try {
      const raw = lsGet(LS.user);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  });
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  // ── settings ──
  const [apiKey, setApiKey] = useState<string>(() => lsGet(LS.apiKey) || "");
  const [keyModal, setKeyModal] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [model, setModel] = useState<string>(() => lsGet(LS.model) || MODELS[0]);
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

  // ── data ──
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [pathIds, setPathIds] = useState<string[]>([]);

  // ── composing ──
  const [prompt, setPrompt] = useState("");
  const [composerMode, setComposerMode] = useState<ContextMode>("full");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [ctxPopOpen, setCtxPopOpen] = useState(false);
  const ctxPopRef = useRef<HTMLDivElement>(null);
  const [branchState, setBranchState] = useState<BranchState | null>(null);

  // ── request in flight ──
  const [pending, setPending] = useState<Pending | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [progress, setProgress] = useState("");

  // ── notices ──
  const [error, setError] = useState<string | null>(null);
  const [summaryInfo, setSummaryInfo] = useState<SummaryInfo | null>(null);
  const [dismissedWarn, setDismissedWarn] = useState<Set<string>>(new Set());

  // ── tree drawer ──
  const [showTree, setShowTree] = useState(false);
  const [treeFocusId, setTreeFocusId] = useState<string | null>(null);
  const [treeContextOf, setTreeContextOf] = useState<string | null>(null);
  const [treeSelecting, setTreeSelecting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const messagesRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pathRef = useRef<string[]>([]);
  const convRef = useRef<string | null>(null);
  const branchRef = useRef<BranchState | null>(null);
  pathRef.current = pathIds;
  convRef.current = conversationId;
  branchRef.current = branchState;

  const byId = useMemo(() => new Map(treeNodes.map((n) => [n.id, n])), [treeNodes]);
  const pathNodes = useMemo(() => pathIds.map((id) => byId.get(id)).filter(Boolean) as TreeNode[], [pathIds, byId]);
  const activePathIds = useMemo(() => new Set(pathIds), [pathIds]);
  const tipId = pathIds[pathIds.length - 1] ?? null;
  const childCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of treeNodes) if (n.parentId) m.set(n.parentId, (m.get(n.parentId) ?? 0) + 1);
    return m;
  }, [treeNodes]);
  const isLoading = pending !== null;

  // Which picker the ticked messages belong to: the branch form if it is open, else the composer.
  const activeMode: ContextMode = branchState ? branchState.mode : composerMode;
  const selectionActive = activeMode === "selected";
  const selectedList = useMemo(() => [...selectedIds], [selectedIds]);

  // ── startup ──
  useEffect(() => {
    getConfig().then(setConfig, () => {});
  }, []);

  const handleLogout = useCallback((message?: string) => {
    lsSet(LS.token, null);
    lsSet(LS.user, null);
    setToken(null);
    setUser(null);
    setConversations([]);
    setConversationId(null);
    setTreeNodes([]);
    setPathIds([]);
    setPrompt("");
    setBranchState(null);
    setShowTree(false);
    if (message) setAuthError(message);
  }, []);

  const refreshConversations = useCallback(
    async (authToken: string) => {
      try {
        setConversations(await listConversations(authToken));
      } catch (err) {
        const msg = getErrorMessage(err);
        if (/401|credential|token/i.test(msg)) handleLogout("Your session has expired. Please sign in again.");
        else setError(msg);
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    if (!token) return;
    getMe(token)
      .then((u) => {
        setUser(u);
        lsSet(LS.user, JSON.stringify(u));
        void refreshConversations(token);
      })
      .catch(() => handleLogout("Your session has expired. Please sign in again."));
  }, [token, refreshConversations, handleLogout]);

  // ── scrolling and composer size ──
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [pathIds, streamingText, progress]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [prompt]);

  // A context choice belongs to the reply point: moving elsewhere resets it to Full.
  useEffect(() => {
    setComposerMode("full");
    setSelectedIds(new Set());
  }, [tipId, conversationId]);

  useEffect(() => {
    if (!ctxPopOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ctxPopRef.current && !ctxPopRef.current.contains(e.target as Node)) setCtxPopOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ctxPopOpen]);

  // ── tree loading ──
  async function loadTree(convId: string): Promise<Map<string, TreeNode>> {
    if (!token) return new Map();
    const nodes = await getTree(token, convId);
    if (convRef.current === convId) setTreeNodes(nodes);
    return new Map(nodes.map((n) => [n.id, n]));
  }

  async function openConversation(convId: string): Promise<void> {
    setConversationId(convId);
    convRef.current = convId;
    setBranchState(null);
    setError(null);
    setSummaryInfo(null);
    setSidebarOpen(false);
    try {
      const map = await loadTree(convId);
      const root = [...map.values()].find((n) => n.parentId === null);
      setPathIds(root ? mainPathFrom(map, root.id) : []);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  function startNewChat(): void {
    setConversationId(null);
    convRef.current = null;
    setTreeNodes([]);
    setPathIds([]);
    setPrompt("");
    setError(null);
    setBranchState(null);
    setSummaryInfo(null);
    setSidebarOpen(false);
    setTimeout(() => composerRef.current?.focus(), 0);
  }

  // ── selection ──
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Choosing "Selected" starts with the reply point ticked, so the default is still sensible.
  function chooseMode(mode: ContextMode, replyPoint: string | null, apply: (m: ContextMode) => void): void {
    if (mode === "selected" && selectedIds.size === 0 && replyPoint) setSelectedIds(new Set([replyPoint]));
    apply(mode);
  }

  // ── sending ──
  async function runStream(
    convId: string,
    parentId: string,
    text: string,
    mode: ContextMode,
    selected: string[],
    kind: Pending["kind"],
  ): Promise<TreeNode | null> {
    if (!token) return null;
    setPending({ parentId, kind, prompt: text, conversationId: convId });
    setStreamingText("");
    setProgress("Thinking…");
    setError(null);
    setSummaryInfo(null);
    let done: TreeNode | null = null;
    let streamError: string | null = null;
    try {
      await streamNode(
        token,
        apiKey,
        { conversationId: convId, parentId, prompt: text, model, contextMode: mode, contextNodeIds: selected },
        (ev) => {
          if (ev.type === "context") {
            setProgress(ev.summarizing ? `Summarizing earlier conversation (~${fmtTokens(ev.tokens)} tokens)…` : "Thinking…");
          } else if (ev.type === "summarized") {
            setSummaryInfo({ from: ev.from_tokens, to: ev.to_tokens, trimmed: ev.trimmed });
            setProgress("Thinking…");
          } else if (ev.type === "token") {
            setProgress("");
            setStreamingText((t) => t + ev.token);
          } else if (ev.type === "done") {
            done = toTreeNode(ev.node);
          } else if (ev.type === "error") {
            streamError = ev.error;
          }
        },
      );
      if (streamError) throw new Error(streamError);
      if (!done) throw new Error("The reply ended before it was saved. Please try again.");
      await loadTree(convId).catch(() => {});
      return done;
    } catch (err) {
      setError(getErrorMessage(err));
      return null;
    } finally {
      setPending(null);
      setStreamingText("");
      setProgress("");
    }
  }

  async function sendComposer(): Promise<void> {
    const text = prompt.trim();
    if (!text || isLoading || branchState || !token) return;
    if (composerMode === "selected" && selectedIds.size === 0) {
      setError("Pick at least one message for Selected context, or switch to Full or None.");
      return;
    }
    setPrompt("");
    setCtxPopOpen(false);

    if (!conversationId || !tipId) {
      // First message: creates the conversation and its root.
      setPending({ parentId: null, kind: "send", prompt: text, conversationId: null });
      setProgress("Thinking…");
      setError(null);
      try {
        const res = await createConversation(token, apiKey, text, model);
        const convId = res.conversation.id;
        setConversationId(convId);
        convRef.current = convId;
        void refreshConversations(token);
        const map = await loadTree(convId);
        setPathIds(pathTo(map, res.root_node_id));
      } catch (err) {
        setError(getErrorMessage(err));
        setPrompt((now) => (now.trim() ? now : text));
      } finally {
        setPending(null);
        setProgress("");
      }
      return;
    }

    const parentId = tipId;
    const convId = conversationId;
    const node = await runStream(convId, parentId, text, composerMode, selectedList, "send");
    if (!node) {
      setPrompt((now) => (now.trim() ? now : text)); // give the text back for a retry
      return;
    }
    setComposerMode("full");
    setSelectedIds(new Set());
    const cur = pathRef.current;
    if (convRef.current === convId && cur[cur.length - 1] === parentId) setPathIds([...cur, node.id]);
  }

  async function handleBranchSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!branchState || !conversationId) return;
    const text = branchState.prompt.trim();
    if (!text || isLoading) return;
    if (branchState.mode === "selected" && selectedIds.size === 0) {
      setError("Pick at least one message for Selected context, or switch to Full or None.");
      return;
    }
    const parentId = branchState.nodeId;
    const convId = conversationId;
    const node = await runStream(convId, parentId, text, branchState.mode, selectedList, "branch");
    if (!node) return;
    setSelectedIds(new Set());
    if (branchRef.current?.nodeId === parentId && convRef.current === convId) {
      setBranchState(null);
      setPathIds([...pathTo(byId, parentId), node.id]);
    }
  }

  // ── tree actions ──
  const handleSelectLeaf = useCallback(
    (leafId: string) => {
      setPathIds(pathTo(byId, leafId));
      setBranchState(null);
      setShowTree(false);
      setError(null);
    },
    [byId],
  );

  const handleChatFromNode = useCallback(
    (nodeId: string) => {
      setPathIds(pathTo(byId, nodeId));
      setBranchState(null);
      setShowTree(false);
      setError(null);
      setTimeout(() => composerRef.current?.focus(), 0);
    },
    [byId],
  );

  // Makes root -> node the tree's main path (each parent's main child along the way).
  const handleSetMain = useCallback(
    async (nodeId: string) => {
      if (!token || !conversationId) return;
      try {
        const ids = pathTo(byId, nodeId);
        for (let i = 1; i < ids.length; i++) {
          const parent = byId.get(ids[i - 1]);
          if (parent && parent.mainChildId !== ids[i]) await setMainChild(token, parent.id, ids[i]);
        }
        await loadTree(conversationId);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, conversationId, byId],
  );

  function openTree(focusId: string | null = null, contextOf: string | null = null, selecting = false): void {
    setTreeFocusId(focusId);
    setTreeContextOf(contextOf);
    setTreeSelecting(selecting);
    setShowTree(true);
  }

  // ── auth handlers ──
  async function handleAuthSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setAuthError(null);
    if (!authUsername.trim() || !authPassword.trim()) {
      setAuthError("Username and password are required.");
      return;
    }
    setAuthBusy(true);
    try {
      const resp =
        authMode === "register"
          ? await registerUser(authUsername, authPassword, authEmail)
          : await loginUser(authUsername, authPassword);
      lsSet(LS.token, resp.access_token);
      lsSet(LS.user, JSON.stringify(resp.user));
      setToken(resp.access_token);
      setUser(resp.user);
      setAuthUsername("");
      setAuthPassword("");
      setAuthEmail("");
    } catch (err) {
      setAuthError(getErrorMessage(err));
    } finally {
      setAuthBusy(false);
    }
  }

  function handleSaveApiKey(e: FormEvent): void {
    e.preventDefault();
    const clean = keyDraft.trim();
    setApiKey(clean);
    lsSet(LS.apiKey, clean || null);
    setKeyModal(false);
  }

  function chooseModel(m: string): void {
    setModel(m);
    lsSet(LS.model, m);
  }

  // ── auth screen ──
  if (!token || !user) {
    return (
      <div className="gate">
        <form className="landing auth-card" onSubmit={(e) => void handleAuthSubmit(e)}>
          <div className="landing-brand">
            <span className="landing-logo">
              <Icon name="tree" size={20} />
            </span>
            <h1>TreeGPT</h1>
          </div>
          <p className="landing-lead">Chat as a tree: branch from any reply and choose exactly what context each message carries.</p>
          <div className="seg auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={authMode === "login"} className={authMode === "login" ? "on" : ""} onClick={() => setAuthMode("login")}>
              Sign in
            </button>
            <button type="button" role="tab" aria-selected={authMode === "register"} className={authMode === "register" ? "on" : ""} onClick={() => setAuthMode("register")}>
              Create account
            </button>
          </div>
          <label className="field">
            <span className="field-label">Username</span>
            <input className="input" autoComplete="username" value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} autoFocus />
          </label>
          {authMode === "register" ? (
            <label className="field">
              <span className="field-label">Email (optional)</span>
              <input className="input" type="email" autoComplete="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
            </label>
          ) : null}
          <label className="field">
            <span className="field-label">Password</span>
            <input
              className="input"
              type="password"
              autoComplete={authMode === "register" ? "new-password" : "current-password"}
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
            />
          </label>
          {authError ? <Notice kind="error" title={authMode === "register" ? "Could not create the account" : "Could not sign in"} detail={authError} onDismiss={() => setAuthError(null)} /> : null}
          <button type="submit" className="btn btn-primary btn-lg" disabled={authBusy}>
            {authBusy ? <span className="spinner spinner--dark" /> : null}
            {authMode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  // ── main screen ──
  const composerPreview = previewFor(byId, tipId, composerMode, selectedList, config);
  const fullTokens = tipId ? sumTokens(contextForNew(byId, tipId, "full", [])) : 0;
  const longLevel = fullTokens > config.summarize_tokens ? "sum" : fullTokens > config.warn_tokens ? "warn" : null;
  const warnKey = longLevel ? `${conversationId}:${longLevel}` : null;
  const showLongWarn = !!warnKey && !dismissedWarn.has(warnKey) && !isLoading;
  const currentConv = conversations.find((c) => c.id === conversationId) ?? null;
  const pendingHere =
    pending !== null && pending.kind === "send" && (pending.parentId === null ? pathIds.length === 0 : pending.parentId === tipId);

  const modelItems: DropdownItem[] = MODELS.map((m) => ({
    id: m,
    label: modelShort(m),
    sub: m,
    selected: m === model,
    onSelect: () => chooseModel(m),
  }));

  return (
    <>
      <div className={`layout${sidebarOpen ? " sidebar-open" : ""}`}>
        <aside className="sidebar">
          <div className="sidebar-brand">
            <span className="landing-logo landing-logo--sm">
              <Icon name="tree" size={16} />
            </span>
            <span>TreeGPT</span>
            <button className="icon-btn icon-btn--bare sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
              <Icon name="close" size={14} />
            </button>
          </div>
          <button className="btn sidebar-new" onClick={startNewChat}>
            <Icon name="plus" size={15} /> New chat
          </button>
          <div className="sidebar-label">Chats</div>
          <nav className="conv-list">
            {conversations.length === 0 ? <div className="conv-empty">No chats yet. Ask a question to start one.</div> : null}
            {conversations.map((c) => (
              <button key={c.id} className={`conv-item${c.id === conversationId ? " active" : ""}`} onClick={() => void openConversation(c.id)} title={c.title}>
                <Icon name="chat" size={14} />
                <span className="conv-title">{c.title || "Untitled"}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <button
              className={`btn btn-sm key-btn${apiKey ? " set" : ""}`}
              onClick={() => {
                setKeyDraft(apiKey);
                setKeyModal(true);
              }}
              title="Your OpenRouter API key (stored in this browser only)"
            >
              <Icon name="key" size={14} /> {apiKey ? "API key set" : "Add API key"}
            </button>
            <div className="user-row">
              <span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span>
              <span className="user-name">{user.username}</span>
              <button className="icon-btn icon-btn--bare" onClick={() => handleLogout()} title="Sign out" aria-label="Sign out">
                <Icon name="logout" size={15} />
              </button>
            </div>
          </div>
        </aside>
        {sidebarOpen ? <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} /> : null}

        <main className="chat-shell">
          <header className="topbar">
            <button className="icon-btn icon-btn--bare menu-btn" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <Icon name="list" size={18} />
            </button>
            <div className="topbar-title" title={currentConv?.title ?? "New chat"}>
              {currentConv?.title ?? "New chat"}
            </div>
            <div className="topbar-model">
              <Dropdown icon="sparkle" text={modelShort(model)} title={`Model: ${model}`} items={modelItems} alignRight />
            </div>
            <button
              className="btn btn-tree"
              disabled={!conversationId}
              onClick={() => openTree(null)}
              title={conversationId ? "View this conversation as a tree" : "Ask a question first"}
            >
              <Icon name="tree" size={15} /> Tree
            </button>
          </header>

          <section className="messages" ref={messagesRef}>
            <div className="messages-inner">
              {pathNodes.length === 0 && !pendingHere ? (
                <div className="empty-state">
                  <Icon name="tree" size={30} />
                  <div className="empty-title">What do you want to explore?</div>
                  <div className="empty-sub">
                    Ask anything. Branch from any reply to explore a side question, and choose for each message whether the
                    model sees the full branch, selected messages, or nothing earlier.
                  </div>
                </div>
              ) : null}

              {pathNodes.map((node) => {
                const showBranchFormHere = branchState?.nodeId === node.id;
                const branches = childCount.get(node.id) ?? 0;
                const ticked = selectedIds.has(node.id);
                const seen = node.parentId ? windowIds(byId, node.id).length - 1 : 0;
                return (
                  <div key={node.id} className={`turn${selectionActive && ticked ? " turn--picked" : ""}`}>
                    <article className="msg msg--user">
                      <header className="msg-head">
                        {selectionActive ? (
                          <button
                            type="button"
                            className={`pick-btn${ticked ? " on" : ""}`}
                            onClick={() => toggleSelect(node.id)}
                            aria-pressed={ticked}
                            title={ticked ? "Remove this exchange from the context" : "Use this exchange (question + reply) as context"}
                          >
                            <Icon name={ticked ? "checkSquare" : "square"} size={15} /> {ticked ? "In context" : "Use as context"}
                          </button>
                        ) : null}
                        <span className="msg-role">You</span>
                        {node.parentId && node.contextMode === "none" ? (
                          <span className="tag" title="Sent without the earlier messages">No earlier context</span>
                        ) : null}
                        {node.contextMode === "selected" ? (
                          <span className="tag tag--ctx" title="Sent with only hand-picked messages">
                            Selected context · {node.contextNodeIds.length}
                          </span>
                        ) : null}
                        {node.contextSummarized ? (
                          <span className="tag tag--sum" title="Older messages were summarized to keep the input short">
                            <Icon name="compress" size={11} /> Summarized
                          </span>
                        ) : null}
                      </header>
                      <div className="plain">{node.prompt}</div>
                    </article>

                    <article className="msg msg--assistant">
                      <header className="msg-head">
                        <span className="msg-role" title={node.modelUsed}>
                          {modelShort(node.modelUsed)}
                        </span>
                        {node.parentId ? (
                          <button className="chip-btn" onClick={() => openTree(null, node.id)} title="See in the tree exactly which messages the model saw">
                            <Icon name="layers" size={12} /> Context: {plural(seen, "message")}
                          </button>
                        ) : null}
                        {branches >= 2 ? (
                          <button className="chip-btn" onClick={() => openTree(node.id)} title="See these branches in the tree">
                            <Icon name="branch" size={12} /> {branches} branches here
                          </button>
                        ) : null}
                      </header>
                      <Markdown text={node.response || "_(empty reply)_"} />
                      <footer className="msg-foot">
                        {!showBranchFormHere ? (
                          <button
                            className="btn btn-sm"
                            title="Ask a side question from this reply, in its own branch"
                            disabled={isLoading}
                            onClick={() => {
                              setBranchState({ nodeId: node.id, prompt: "", mode: "full" });
                              setSelectedIds(new Set());
                            }}
                          >
                            <Icon name="branch" size={13} /> Branch
                          </button>
                        ) : (
                          <button className="btn btn-sm" onClick={() => setBranchState(null)} disabled={pending?.kind === "branch"}>
                            <Icon name="close" size={13} /> Cancel branch
                          </button>
                        )}
                        {node.contextTokens ? <span className="msg-meta">~{fmtTokens(node.contextTokens)} tokens in</span> : null}
                      </footer>
                    </article>

                    {showBranchFormHere && branchState ? (
                      <BranchForm
                        state={branchState}
                        preview={previewFor(byId, node.id, branchState.mode, selectedList, config)}
                        selectedCount={selectedIds.size}
                        isLoading={isLoading}
                        busy={pending?.kind === "branch"}
                        progress={progress}
                        streamingText={pending?.kind === "branch" ? streamingText : ""}
                        onChange={(patch) => setBranchState((prev) => (prev ? { ...prev, ...patch } : prev))}
                        onMode={(mode) => chooseMode(mode, node.id, (m) => setBranchState((prev) => (prev ? { ...prev, mode: m } : prev)))}
                        onPickInTree={() => openTree(null, null, true)}
                        onClearSelection={clearSelection}
                        onSubmit={(e) => void handleBranchSubmit(e)}
                        onCancel={() => setBranchState(null)}
                      />
                    ) : null}
                  </div>
                );
              })}

              {pendingHere && pending ? (
                <div className="turn">
                  <article className="msg msg--user">
                    <header className="msg-head">
                      <span className="msg-role">You</span>
                    </header>
                    <div className="plain">{pending.prompt}</div>
                  </article>
                  <article className="msg msg--assistant msg--pending">
                    <header className="msg-head">
                      <span className="msg-role">{modelShort(model)}</span>
                    </header>
                    {streamingText ? (
                      <Markdown text={streamingText} />
                    ) : (
                      <div className="typing">
                        <span className="spinner" /> {progress || "Thinking…"}
                      </div>
                    )}
                  </article>
                </div>
              ) : null}
            </div>
          </section>

          <div className="notes">
            {summaryInfo ? (
              <Notice
                kind="info"
                title={summaryInfo.trimmed ? "Oldest messages were left out to fit" : "Earlier conversation was summarized"}
                detail={
                  summaryInfo.trimmed
                    ? `The summary could not be made, so the oldest messages were dropped (~${fmtTokens(summaryInfo.from)} → ~${fmtTokens(summaryInfo.to)} tokens).`
                    : `Older messages were condensed into a summary (~${fmtTokens(summaryInfo.from)} → ~${fmtTokens(summaryInfo.to)} tokens). The latest ${config.keep_recent_turns} stay word for word.`
                }
                onDismiss={() => setSummaryInfo(null)}
              />
            ) : null}

            {showLongWarn ? (
              <Notice
                kind="warn"
                title={longLevel === "sum" ? `This branch is very long (~${fmtTokens(fullTokens)} tokens)` : `This branch is getting long (~${fmtTokens(fullTokens)} tokens)`}
                detail={
                  longLevel === "sum"
                    ? "Older messages are now summarized before each reply, so some detail may be lost. For a new topic, start a separate chat, or use Selected / None context."
                    : `Consider starting a separate chat for new topics, or use Selected / None context. Past ~${fmtTokens(config.summarize_tokens)} tokens, older messages will be summarized automatically.`
                }
                action={{ label: "New chat", onClick: startNewChat }}
                onDismiss={() => setDismissedWarn((s) => new Set(s).add(warnKey!))}
              />
            ) : null}

            {error ? (
              <Notice
                kind="error"
                title="Something went wrong"
                detail={error}
                action={/api key|OPENROUTER_API_KEY|401/i.test(error) ? { label: "Set API key", onClick: () => { setKeyDraft(apiKey); setKeyModal(true); } } : undefined}
                onDismiss={() => setError(null)}
              />
            ) : null}
          </div>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void sendComposer();
            }}
          >
            {pathNodes.length && !branchState ? (
              <div className="ctx-chip-row" ref={ctxPopRef}>
                <button
                  type="button"
                  className={`chip-btn ctx-chip${composerMode !== "full" ? " on" : ""}`}
                  onClick={() => setCtxPopOpen((o) => !o)}
                  aria-expanded={ctxPopOpen}
                  title="How much of the earlier conversation the model sees with your next message"
                >
                  <Icon name="layers" size={12} /> Context: {modeLabel(composerMode, selectedIds.size)} <Icon name="chevronDown" size={11} />
                </button>
                <span className={`ctx-inline${composerPreview.summarize ? " sum" : composerPreview.warn ? " warn" : ""}`}>
                  {composerMode === "none" ? "only your question" : composerPreview.tokens ? `~${fmtTokens(composerPreview.tokens)} tokens of context` : ""}
                </span>
                {ctxPopOpen ? (
                  <div className="ctx-pop">
                    <ContextPicker
                      value={composerMode}
                      onChange={(m) => chooseMode(m, tipId, setComposerMode)}
                      preview={composerPreview}
                      selectedCount={selectedIds.size}
                      onPickInTree={() => {
                        setCtxPopOpen(false);
                        openTree(null, null, true);
                      }}
                      onClearSelection={clearSelection}
                    />
                    <div className="ctx-pop-note">Applies to your next message only.</div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className={`composer-box${branchState ? " disabled" : ""}`}>
              <textarea
                ref={composerRef}
                rows={1}
                placeholder={
                  branchState ? "Close the branch form above to continue here…" : pathNodes.length ? "Ask a follow-up on this path…" : "Ask your first question…"
                }
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (isSendKey(e)) {
                    e.preventDefault();
                    void sendComposer();
                  }
                }}
                disabled={!!branchState}
              />
              <button
                type="submit"
                className="send-btn"
                disabled={isLoading || prompt.trim().length === 0 || !!branchState}
                title={isLoading ? "Wait for the current reply to finish" : "Send (Enter). Shift+Enter adds a new line."}
                aria-label="Send"
              >
                {isLoading ? <span className="spinner spinner--dark" /> : <Icon name="send" size={16} />}
              </button>
            </div>
          </form>
        </main>
      </div>

      {showTree && conversationId ? (
        <TreeView
          treeNodes={treeNodes}
          activePathIds={activePathIds}
          activeTipId={tipId}
          focusId={treeFocusId}
          contextOf={treeContextOf}
          onShowBranch={handleSelectLeaf}
          onChatFromNode={handleChatFromNode}
          onSetMain={(nodeId) => void handleSetMain(nodeId)}
          onClose={() => {
            setShowTree(false);
            setTreeSelecting(false);
          }}
          selecting={treeSelecting && selectionActive}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onClearSelection={clearSelection}
        />
      ) : null}

      {keyModal ? (
        <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && setKeyModal(false)}>
          <form className="landing modal-card" onSubmit={handleSaveApiKey}>
            <div className="landing-brand">
              <span className="landing-logo">
                <Icon name="key" size={18} />
              </span>
              <h1 className="modal-title">OpenRouter API key</h1>
            </div>
            <p>
              Stored only in this browser and sent with each request. Leave it empty to use the server's <code>OPENROUTER_API_KEY</code>.
            </p>
            <input className="input" type="password" placeholder="sk-or-v1-…" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} autoFocus />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setKeyModal(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

// ── BranchForm ───────────────────────────────────────────────────────────────
type BranchFormProps = {
  state: BranchState;
  preview: ReturnType<typeof previewFor>;
  selectedCount: number;
  isLoading: boolean;
  /** This branch's own request is running. */
  busy: boolean;
  progress: string;
  streamingText: string;
  onChange: (patch: Partial<BranchState>) => void;
  onMode: (mode: ContextMode) => void;
  onPickInTree: () => void;
  onClearSelection: () => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
};

function BranchForm({ state, preview, selectedCount, isLoading, busy, progress, streamingText, onChange, onMode, onPickInTree, onClearSelection, onSubmit, onCancel }: BranchFormProps) {
  return (
    <form className="branch-form" onSubmit={onSubmit}>
      <div className="branch-form-header">
        <span className="branch-form-title">
          <Icon name="branch" size={14} /> New branch
        </span>
        <span className="branch-form-hint">
          {state.mode === "full"
            ? "Continues from this reply with everything before it"
            : state.mode === "none"
              ? "Starts fresh: the model sees only this question"
              : "The model sees only the messages you tick"}
        </span>
      </div>
      <textarea
        className="branch-textarea"
        placeholder="Your side question… (Enter sends, Shift+Enter adds a new line)"
        value={state.prompt}
        rows={3}
        onChange={(e) => onChange({ prompt: e.target.value })}
        onKeyDown={(e) => {
          if (isSendKey(e)) {
            e.preventDefault();
            if (!isLoading && state.prompt.trim()) e.currentTarget.form?.requestSubmit();
          }
        }}
        disabled={busy}
        autoFocus
      />
      <ContextPicker
        value={state.mode}
        onChange={onMode}
        preview={preview}
        selectedCount={selectedCount}
        onPickInTree={onPickInTree}
        onClearSelection={onClearSelection}
        disabled={busy}
      />
      <div className="branch-form-controls">
        <div className="branch-form-actions">
          <button type="button" className="btn btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-sm btn-primary" disabled={isLoading || state.prompt.trim().length === 0}>
            {busy ? "Branching…" : isLoading ? "Waiting…" : "Send branch"}
          </button>
        </div>
      </div>
      {busy ? (
        streamingText ? (
          <div className="branch-stream">
            <Markdown text={streamingText} />
          </div>
        ) : (
          <div className="typing">
            <span className="spinner" /> {progress || "Thinking…"}
          </div>
        )
      ) : null}
    </form>
  );
}
