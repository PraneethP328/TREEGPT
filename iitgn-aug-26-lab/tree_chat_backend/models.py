import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, Relationship, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    username: str = Field(index=True, unique=True, nullable=False)
    email: str | None = Field(default=None, index=True)
    hashed_password: str = Field(nullable=False)
    created_at: datetime = Field(default_factory=utc_now, nullable=False)

    conversations: list["Conversation"] = Relationship(back_populates="user")


class Conversation(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID | None = Field(default=None, foreign_key="user.id", index=True)
    title: str
    created_at: datetime = Field(default_factory=utc_now, nullable=False)

    user: Optional[User] = Relationship(back_populates="conversations")
    nodes: list["Node"] = Relationship(back_populates="conversation")


class Node(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    conversation_id: uuid.UUID = Field(foreign_key="conversation.id", nullable=False, index=True)
    parent_id: uuid.UUID | None = Field(default=None, foreign_key="node.id", index=True)
    prompt: str
    response: str
    include_parent_context: bool = Field(default=True, nullable=False)
    # "full" | "none" | "selected" — how this node's prompt was given context.
    context_mode: str = Field(default="full", nullable=False)
    # JSON list of node ids used as context when context_mode == "selected".
    context_node_ids: str | None = Field(default=None)
    # Cached summary of this node's effective context up to and including it.
    context_summary: str | None = Field(default=None)
    # Estimated input tokens actually sent for this node.
    context_tokens: int | None = Field(default=None)
    # True if older turns were replaced by a summary (or trimmed) for this node.
    context_summarized: bool = Field(default=False, nullable=False)
    main_child_id: uuid.UUID | None = Field(default=None, foreign_key="node.id", index=True)
    model_used: str
    created_at: datetime = Field(default_factory=utc_now, nullable=False)

    conversation: Conversation = Relationship(back_populates="nodes")
    parent: Optional["Node"] = Relationship(
        back_populates="children",
        sa_relationship_kwargs={
            "remote_side": "Node.id",
            "foreign_keys": "[Node.parent_id]",
        },
    )
    children: list["Node"] = Relationship(
        back_populates="parent",
        sa_relationship_kwargs={"foreign_keys": "[Node.parent_id]"},
    )
    main_child: Optional["Node"] = Relationship(
        sa_relationship_kwargs={
            "foreign_keys": "[Node.main_child_id]",
            "post_update": True,
        }
    )
