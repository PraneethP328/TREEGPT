export type User = {
  id: string;
  username: string;
  email?: string | null;
  created_at: string;
};

export type AuthResponse = {
  access_token: string;
  token_type: string;
  user: User;
};

export type ConversationSummary = {
  id: string;
  user_id?: string | null;
  title: string;
  created_at: string;
};

/** How a message was given earlier context. */
export type ContextMode = "full" | "none" | "selected";

/** A node exactly as the backend sends it. */
export type ApiNode = {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  prompt: string;
  response: string;
  include_parent_context: boolean;
  context_mode?: ContextMode;
  context_node_ids?: string[];
  context_tokens?: number | null;
  context_summarized?: boolean;
  main_child_id: string | null;
  model_used: string;
  created_at: string;
};

/** A node as the UI uses it (camelCase, createdAt in ms). */
export type TreeNode = {
  id: string;
  conversationId: string;
  parentId: string | null;
  prompt: string;
  response: string;
  contextMode: ContextMode;
  /** The messages chosen as context when contextMode is "selected". */
  contextNodeIds: string[];
  /** Estimated input tokens actually sent for this message. */
  contextTokens: number | null;
  /** Older turns were condensed into a summary (or trimmed) for this message. */
  contextSummarized: boolean;
  mainChildId: string | null;
  modelUsed: string;
  createdAt: number;
};

export type CreateConversationResponse = {
  conversation: ConversationSummary;
  root_node_id: string;
};

export type AppConfig = {
  warn_tokens: number;
  summarize_tokens: number;
  keep_recent_turns: number;
};

export type StreamEvent =
  | { type: "context"; mode: ContextMode; messages: number; tokens: number; warn: boolean; summarizing: boolean }
  | { type: "summarized"; trimmed: boolean; from_tokens: number; to_tokens: number }
  | { type: "token"; token: string }
  | { type: "done"; node: ApiNode }
  | { type: "error"; error: string };
