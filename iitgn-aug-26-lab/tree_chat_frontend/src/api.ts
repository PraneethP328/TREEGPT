import type {
  ApiNode,
  AppConfig,
  AuthResponse,
  ContextMode,
  ConversationSummary,
  CreateConversationResponse,
  StreamEvent,
  TreeNode,
  User,
} from "./types";

const BASE_URL = "http://127.0.0.1:8000";

/** Backend timestamps are UTC; SQLite drops the zone, so add it back before parsing. */
function parseTime(value: string): number {
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(value);
  const ms = Date.parse(hasZone ? value : `${value}Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

export function toTreeNode(n: ApiNode): TreeNode {
  const mode: ContextMode = n.context_mode ?? (n.include_parent_context ? "full" : "none");
  return {
    id: n.id,
    conversationId: n.conversation_id,
    parentId: n.parent_id,
    prompt: n.prompt,
    response: n.response,
    contextMode: mode,
    contextNodeIds: n.context_node_ids ?? [],
    contextTokens: n.context_tokens ?? null,
    contextSummarized: !!n.context_summarized,
    mainChildId: n.main_child_id,
    modelUsed: n.model_used,
    createdAt: parseTime(n.created_at),
  };
}

export async function getConfig(): Promise<AppConfig> {
  const response = await fetch(`${BASE_URL}/config`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as AppConfig;
}

const jsonHeaders = (token: string, apiKey?: string | null): HeadersInit => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (apiKey) {
    headers["X-OpenRouter-API-Key"] = apiKey;
  }
  return headers;
};

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: unknown };
    return formatErrorDetail(data.detail) ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

function formatErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "msg" in item) {
          const message = (item as { msg?: unknown }).msg;
          return typeof message === "string" ? message : JSON.stringify(item);
        }
        return JSON.stringify(item);
      })
      .filter(Boolean);
    return messages.length > 0 ? messages.join("; ") : null;
  }

  if (detail && typeof detail === "object") {
    return JSON.stringify(detail);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

export async function registerUser(
  username: string,
  password: string,
  email?: string,
): Promise<AuthResponse> {
  const response = await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password,
      email: email?.trim() || undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as AuthResponse;
}

export async function loginUser(
  username: string,
  password: string,
): Promise<AuthResponse> {
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as AuthResponse;
}

export async function getMe(token: string): Promise<User> {
  const response = await fetch(`${BASE_URL}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as User;
}

// ---------------------------------------------------------------------------
// Conversations & Tree API (Authenticated)
// ---------------------------------------------------------------------------

export async function listConversations(
  token: string,
): Promise<ConversationSummary[]> {
  const response = await fetch(`${BASE_URL}/conversations`, {
    headers: jsonHeaders(token),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as ConversationSummary[];
}

export async function createConversation(
  token: string,
  apiKey: string,
  prompt: string,
  model: string,
): Promise<CreateConversationResponse> {
  const response = await fetch(`${BASE_URL}/conversations`, {
    method: "POST",
    headers: jsonHeaders(token, apiKey),
    body: JSON.stringify({
      title: prompt.slice(0, 40) || "New Chat",
      prompt,
      model,
    }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as CreateConversationResponse;
}

export async function getTree(
  token: string,
  conversationId: string,
): Promise<TreeNode[]> {
  const response = await fetch(
    `${BASE_URL}/conversations/${conversationId}/tree`,
    {
      headers: jsonHeaders(token),
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return ((await response.json()) as ApiNode[]).map(toTreeNode);
}

export async function getPath(
  token: string,
  conversationId: string,
  nodeId: string,
): Promise<TreeNode[]> {
  const response = await fetch(
    `${BASE_URL}/conversations/${conversationId}/path/${nodeId}`,
    {
      headers: jsonHeaders(token),
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return ((await response.json()) as ApiNode[]).map(toTreeNode);
}

export async function streamNode(
  token: string,
  apiKey: string,
  params: {
    conversationId: string;
    parentId: string;
    prompt: string;
    model: string;
    contextMode: ContextMode;
    /** Used when contextMode is "selected". */
    contextNodeIds?: string[];
  },
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const response = await fetch(
    `${BASE_URL}/conversations/${params.conversationId}/nodes`,
    {
      method: "POST",
      headers: jsonHeaders(token, apiKey),
      body: JSON.stringify({
        parent_id: params.parentId,
        prompt: params.prompt,
        include_parent_context: params.contextMode !== "none",
        context_mode: params.contextMode,
        context_node_ids: params.contextMode === "selected" ? params.contextNodeIds ?? [] : [],
        model: params.model,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response));
  }
  if (!response.body) {
    throw new Error("Streaming response body was empty.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const payload = trimmed.slice(5).trim();
      if (!payload) {
        continue;
      }
      const event = JSON.parse(payload) as StreamEvent;
      onEvent(event);
    }
  }
}

export async function setMainChild(
  token: string,
  parentId: string,
  childId: string,
): Promise<TreeNode> {
  const response = await fetch(`${BASE_URL}/nodes/${parentId}/set-main-child`, {
    method: "PATCH",
    headers: jsonHeaders(token),
    body: JSON.stringify({ child_id: childId }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return toTreeNode((await response.json()) as ApiNode);
}
