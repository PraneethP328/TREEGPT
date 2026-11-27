// What the model sees for a message, mirrored from the backend (tree_chat_backend/context.py):
//
//   full     – everything its parent saw, plus the parent
//   none     – only the new prompt
//   selected – an arbitrary set of messages chosen by the user (oldest first)
//
// Pure (no React).
import type { AppConfig, ContextMode, TreeNode } from "./types";

export const DEFAULT_CONFIG: AppConfig = { warn_tokens: 6000, summarize_tokens: 12000, keep_recent_turns: 4 };

const tokensOf = (text: string) => Math.ceil(String(text || "").length / 4);
export const turnTokens = (n: TreeNode) => tokensOf(n.prompt) + tokensOf(n.response);
export const sumTokens = (nodes: TreeNode[]) => nodes.reduce((s, n) => s + turnTokens(n), 0);

export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
}

export function modeLabel(mode: ContextMode, selectedCount = 0): string {
  if (mode === "none") return "None";
  if (mode === "selected") return `Selected (${selectedCount})`;
  return "Full";
}

/** Selected ids that exist, de-duplicated, oldest first. */
export function orderSelected(byId: Map<string, TreeNode>, ids: Iterable<string>): TreeNode[] {
  const seen = new Set<string>();
  const out: TreeNode[] = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (n && !seen.has(id)) {
      seen.add(id);
      out.push(n);
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** Ids of what the model saw for `id`, the message itself included, oldest first. */
export function windowIds(byId: Map<string, TreeNode>, id: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur.id);
    if (cur.contextMode === "none" || cur.parentId === null) break;
    if (cur.contextMode === "selected") {
      const sel = orderSelected(byId, cur.contextNodeIds).filter((n) => !seen.has(n.id));
      for (let i = sel.length - 1; i >= 0; i--) chain.push(sel[i].id);
      break;
    }
    cur = byId.get(cur.parentId);
  }
  return chain.reverse();
}

/** The earlier messages a new child of `parentId` would be sent with, oldest first. */
export function contextForNew(
  byId: Map<string, TreeNode>,
  parentId: string | null,
  mode: ContextMode,
  selected: Iterable<string>,
): TreeNode[] {
  if (!parentId || mode === "none") return [];
  if (mode === "selected") return orderSelected(byId, selected);
  return windowIds(byId, parentId)
    .map((id) => byId.get(id)!)
    .filter(Boolean);
}

export type Preview = { line: string; tokens: number; warn: boolean; summarize: boolean };

/** "The model will see 3 earlier messages (~1.4k tokens) + your question", plus long-chat hints. */
export function previewFor(
  byId: Map<string, TreeNode>,
  parentId: string | null,
  mode: ContextMode,
  selected: Iterable<string>,
  config: AppConfig,
): Preview {
  const msgs = contextForNew(byId, parentId, mode, selected);
  const tokens = sumTokens(msgs);
  const warn = tokens > config.warn_tokens;
  const summarize = tokens > config.summarize_tokens && msgs.length > config.keep_recent_turns;
  if (mode === "selected" && !msgs.length) {
    return { line: "Pick at least one message (tick the boxes in the chat or the tree).", tokens: 0, warn: false, summarize: false };
  }
  if (!msgs.length) return { line: "The model will see only your question.", tokens: 0, warn: false, summarize: false };
  let line = `The model will see ${msgs.length} earlier message${msgs.length === 1 ? "" : "s"} (~${fmtTokens(tokens)} tokens) + your question.`;
  if (summarize) {
    line += ` Older messages will be summarized automatically; the last ${config.keep_recent_turns} stay word for word.`;
  } else if (warn) {
    line += " This is getting long — consider a new chat or None/Selected context.";
  }
  return { line, tokens, warn, summarize };
}
