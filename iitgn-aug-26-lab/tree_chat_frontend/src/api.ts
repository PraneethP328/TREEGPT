import type {
  ConversationSummary,
  CreateConversationResponse,
  StreamEvent,
  TreeNode,
} from "./types";

const BASE_URL = "http://127.0.0.1:8000";

const jsonHeaders = (apiKey: string): HeadersInit => ({
  "Content-Type": "application/json",
  "X-OpenRouter-API-Key": apiKey,
});

export async function listConversations(apiKey: string): Promise<ConversationSummary[]> {
  const response = await fetch(`${BASE_URL}/conversations`, {
    headers: jsonHeaders(apiKey),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as ConversationSummary[];
}

export async function createConversation(
  apiKey: string,
  prompt: string,
  model: string,
): Promise<CreateConversationResponse> {
  const response = await fetch(`${BASE_URL}/conversations`, {
    method: "POST",
    headers: jsonHeaders(apiKey),
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

export async function getTree(apiKey: string, conversationId: string): Promise<TreeNode[]> {
  const response = await fetch(`${BASE_URL}/conversations/${conversationId}/tree`, {
    headers: jsonHeaders(apiKey),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as TreeNode[];
}

export async function getPath(
  apiKey: string,
  conversationId: string,
  nodeId: string,
): Promise<TreeNode[]> {
  const response = await fetch(`${BASE_URL}/conversations/${conversationId}/path/${nodeId}`, {
    headers: jsonHeaders(apiKey),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as TreeNode[];
}

export async function streamNode(
  apiKey: string,
  params: {
    conversationId: string;
    parentId: string;
    prompt: string;
    model: string;
    includeParentContext?: boolean;
  },
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const response = await fetch(`${BASE_URL}/conversations/${params.conversationId}/nodes`, {
    method: "POST",
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({
      parent_id: params.parentId,
      prompt: params.prompt,
      include_parent_context: params.includeParentContext ?? true,
      model: params.model,
    }),
  });

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

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: string };
    return data.detail ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

export async function setMainChild(
  apiKey: string,
  parentId: string,
  childId: string,
): Promise<TreeNode> {
  const response = await fetch(`${BASE_URL}/nodes/${parentId}/set-main-child`, {
    method: "PATCH",
    headers: jsonHeaders(apiKey),
    body: JSON.stringify({ child_id: childId }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as TreeNode;
}
