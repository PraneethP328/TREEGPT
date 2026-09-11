from __future__ import annotations

from sqlmodel import select

from tree_chat_backend.context import build_context, context_to_messages
from tree_chat_backend.db import get_session, init_db
from tree_chat_backend.models import Conversation, Node


SYSTEM_PROMPT = "You are a helpful demo model."


def run() -> None:
    init_db()

    with get_session() as session:
        conversation = Conversation(title="Step 1 Sanity Conversation")
        session.add(conversation)
        session.commit()
        session.refresh(conversation)

        root = Node(
            conversation_id=conversation.id,
            parent_id=None,
            prompt="Root prompt",
            response="Root response",
            include_parent_context=True,
            model_used="nvidia/nemotron-3.5-lightning:free",
        )
        session.add(root)
        session.commit()
        session.refresh(root)

        child_with_context = Node(
            conversation_id=conversation.id,
            parent_id=root.id,
            prompt="Child prompt",
            response="Child response",
            include_parent_context=True,
            model_used="google/gemma-4-31b-it:free",
        )
        child_without_context = Node(
            conversation_id=conversation.id,
            parent_id=root.id,
            prompt="Fresh branch prompt",
            response="Fresh branch response",
            include_parent_context=False,
            model_used="cohere/north-mini-code:free",
        )

        session.add(child_with_context)
        session.add(child_without_context)
        session.commit()
        session.refresh(child_with_context)
        session.refresh(child_without_context)

        root.main_child_id = child_with_context.id
        session.add(root)
        session.commit()
        session.refresh(root)

        loaded_child = session.exec(
            select(Node).where(Node.id == child_with_context.id)
        ).one()
        loaded_fresh_branch = session.exec(
            select(Node).where(Node.id == child_without_context.id)
        ).one()

        path_with_context = build_context(loaded_child)
        path_without_context = build_context(loaded_fresh_branch)

        assert [node.prompt for node in path_with_context] == [
            "Root prompt",
            "Child prompt",
        ]
        assert [node.prompt for node in path_without_context] == ["Fresh branch prompt"]
        assert root.main_child_id == child_with_context.id

        messages = context_to_messages(path_with_context, SYSTEM_PROMPT)
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        assert messages[2]["role"] == "assistant"
        assert messages[3]["role"] == "user"
        assert messages[4]["role"] == "assistant"

    print("✅ Step 1 sanity checks passed.")


if __name__ == "__main__":
    run()

