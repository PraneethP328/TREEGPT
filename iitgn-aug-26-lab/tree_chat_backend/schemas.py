from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from tree_chat_backend.openrouter import DEFAULT_MODEL


class CreateConversationRequest(BaseModel):
    title: str = Field(default="New Chat")
    prompt: str
    model: str = Field(default=DEFAULT_MODEL)


class ConversationSummary(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime


class CreateConversationResponse(BaseModel):
    conversation: ConversationSummary
    root_node_id: uuid.UUID


class CreateNodeRequest(BaseModel):
    parent_id: uuid.UUID
    prompt: str
    include_parent_context: bool = True
    model: str = Field(default=DEFAULT_MODEL)


class TreeNodeResponse(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    parent_id: uuid.UUID | None
    prompt: str
    response: str
    include_parent_context: bool
    main_child_id: uuid.UUID | None
    model_used: str
    created_at: datetime


class SetMainChildRequest(BaseModel):
    child_id: uuid.UUID

