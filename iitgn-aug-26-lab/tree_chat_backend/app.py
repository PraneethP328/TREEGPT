from __future__ import annotations

import json
import uuid
from collections.abc import Iterator

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import OpenAIError
from sqlmodel import select

from tree_chat_backend.context import build_context, context_to_messages
from tree_chat_backend.db import get_session, init_db
from tree_chat_backend.models import Conversation, Node
from tree_chat_backend.openrouter import get_openrouter_client
from tree_chat_backend.schemas import (
    ConversationSummary,
    CreateConversationRequest,
    CreateConversationResponse,
    CreateNodeRequest,
    SetMainChildRequest,
    TreeNodeResponse,
)


SYSTEM_PROMPT = "You are a helpful assistant."
MAX_CHILDREN_PER_NODE = 10

app = FastAPI(title="Tree Chat Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def _to_tree_node_response(node: Node) -> TreeNodeResponse:
    return TreeNodeResponse(
        id=node.id,
        conversation_id=node.conversation_id,
        parent_id=node.parent_id,
        prompt=node.prompt,
        response=node.response,
        include_parent_context=node.include_parent_context,
        main_child_id=node.main_child_id,
        model_used=node.model_used,
        created_at=node.created_at,
    )


@app.post("/conversations", response_model=CreateConversationResponse)
def create_conversation(
    payload: CreateConversationRequest,
    openrouter_api_key: str | None = Header(default=None, alias="X-OpenRouter-API-Key"),
) -> CreateConversationResponse:
    try:
        client = get_openrouter_client(openrouter_api_key)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": payload.prompt},
    ]
    try:
        completion = client.chat.completions.create(model=payload.model, messages=messages)
    except OpenAIError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OpenRouter call failed for model '{payload.model}': {exc}",
        ) from exc
    assistant_text = completion.choices[0].message.content or ""

    with get_session() as session:
        conversation = Conversation(title=payload.title)
        session.add(conversation)
        session.commit()
        session.refresh(conversation)

        root_node = Node(
            conversation_id=conversation.id,
            parent_id=None,
            prompt=payload.prompt,
            response=assistant_text,
            include_parent_context=True,
            model_used=payload.model,
        )
        session.add(root_node)
        session.commit()
        session.refresh(root_node)

    return CreateConversationResponse(
        conversation=ConversationSummary(
            id=conversation.id,
            title=conversation.title,
            created_at=conversation.created_at,
        ),
        root_node_id=root_node.id,
    )


@app.post("/conversations/{conversation_id}/nodes")
def create_node(
    conversation_id: uuid.UUID,
    payload: CreateNodeRequest,
    openrouter_api_key: str | None = Header(default=None, alias="X-OpenRouter-API-Key"),
) -> StreamingResponse:
    with get_session() as session:
        conversation = session.get(Conversation, conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")

        parent = session.get(Node, payload.parent_id)
        if parent is None:
            raise HTTPException(status_code=404, detail="Parent node not found.")
        if parent.conversation_id != conversation_id:
            raise HTTPException(
                status_code=400,
                detail="Parent node does not belong to this conversation.",
            )

        child_count = session.exec(
            select(Node).where(Node.parent_id == payload.parent_id)
        ).all()
        if len(child_count) >= MAX_CHILDREN_PER_NODE:
            raise HTTPException(
                status_code=400,
                detail=f"Node already has {MAX_CHILDREN_PER_NODE} children. Choose another branch point.",
            )

        if payload.include_parent_context:
            context_nodes = build_context(parent)
            messages = context_to_messages(context_nodes, SYSTEM_PROMPT)
        else:
            messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.append({"role": "user", "content": payload.prompt})

    try:
        client = get_openrouter_client(openrouter_api_key)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        stream = client.chat.completions.create(
            model=payload.model,
            messages=messages,
            stream=True,
        )
    except OpenAIError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OpenRouter streaming call failed for model '{payload.model}': {exc}",
        ) from exc

    def event_stream() -> Iterator[str]:
        chunks: list[str] = []
        try:
            for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    chunks.append(delta)
                    yield f"data: {json.dumps({'type': 'token', 'token': delta})}\n\n"
        except OpenAIError as exc:
            yield f"data: {json.dumps({'type': 'error', 'error': f'Stream interrupted: {exc}'})}\n\n"
            return

        final_response = "".join(chunks)
        with get_session() as session:
            parent = session.get(Node, payload.parent_id)
            if parent is None:
                yield "data: {\"type\":\"error\",\"error\":\"Parent node missing during persistence.\"}\n\n"
                return

            node = Node(
                conversation_id=conversation_id,
                parent_id=payload.parent_id,
                prompt=payload.prompt,
                response=final_response,
                include_parent_context=payload.include_parent_context,
                model_used=payload.model,
            )
            session.add(node)
            session.commit()
            session.refresh(node)

            if parent.main_child_id is None:
                parent.main_child_id = node.id
                session.add(parent)
                session.commit()

            done_payload = {
                "type": "done",
                "node": _to_tree_node_response(node).model_dump(mode="json"),
            }
            yield f"data: {json.dumps(done_payload)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/conversations", response_model=list[ConversationSummary])
def list_conversations() -> list[ConversationSummary]:
    with get_session() as session:
        conversations = session.exec(
            select(Conversation).order_by(Conversation.created_at.desc())
        ).all()
        return [
            ConversationSummary(id=c.id, title=c.title, created_at=c.created_at)
            for c in conversations
        ]


@app.get("/conversations/{conversation_id}/tree", response_model=list[TreeNodeResponse])
def get_tree(conversation_id: uuid.UUID) -> list[TreeNodeResponse]:
    with get_session() as session:
        conversation = session.get(Conversation, conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")

        nodes = session.exec(
            select(Node)
            .where(Node.conversation_id == conversation_id)
            .order_by(Node.created_at.asc())
        ).all()
        return [_to_tree_node_response(node) for node in nodes]


@app.get("/conversations/{conversation_id}/path/{node_id}", response_model=list[TreeNodeResponse])
def get_path(conversation_id: uuid.UUID, node_id: uuid.UUID) -> list[TreeNodeResponse]:
    with get_session() as session:
        node = session.get(Node, node_id)
        if node is None:
            raise HTTPException(status_code=404, detail="Node not found.")
        if node.conversation_id != conversation_id:
            raise HTTPException(status_code=400, detail="Node not in this conversation.")

        lineage: list[Node] = []
        current: Node | None = node
        while current is not None:
            lineage.append(current)
            if current.parent_id is None:
                break
            current = session.get(Node, current.parent_id)

        lineage.reverse()
        return [_to_tree_node_response(item) for item in lineage]


@app.patch("/nodes/{node_id}/set-main-child", response_model=TreeNodeResponse)
def set_main_child(node_id: uuid.UUID, payload: SetMainChildRequest) -> TreeNodeResponse:
    with get_session() as session:
        parent = session.get(Node, node_id)
        if parent is None:
            raise HTTPException(status_code=404, detail="Parent node not found.")

        child = session.get(Node, payload.child_id)
        if child is None:
            raise HTTPException(status_code=404, detail="Child node not found.")
        if child.parent_id != node_id:
            raise HTTPException(status_code=400, detail="Provided child is not a child of this parent.")

        parent.main_child_id = child.id
        session.add(parent)
        session.commit()
        session.refresh(parent)
        return _to_tree_node_response(parent)
