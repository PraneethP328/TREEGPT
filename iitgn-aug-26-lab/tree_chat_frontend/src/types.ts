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

export type TreeNode = {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  prompt: string;
  response: string;
  include_parent_context: boolean;
  main_child_id: string | null;
  model_used: string;
  created_at: string;
};

export type CreateConversationResponse = {
  conversation: ConversationSummary;
  root_node_id: string;
};

export type StreamEvent =
  | { type: "token"; token: string }
  | { type: "done"; node: TreeNode }
  | { type: "error"; error: string };
