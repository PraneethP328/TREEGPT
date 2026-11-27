"""Checks for context modes and long-chat summarization.

Uses a throw-away SQLite file and a fake OpenRouter client, so it never touches
tree_chat.db and needs no API key. Run from iitgn-aug-26-lab:

    python -m tree_chat_backend.summarize_checks
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace

# Tiny thresholds so a few turns are enough to trigger summarization.
os.environ["CONTEXT_WARN_TOKENS"] = "100"
os.environ["CONTEXT_SUMMARIZE_TOKENS"] = "200"
os.environ["KEEP_RECENT_TURNS"] = "2"

from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session, SQLModel, create_engine, select  # noqa: E402

from tree_chat_backend import app as app_module  # noqa: E402
from tree_chat_backend import db as db_module  # noqa: E402
from tree_chat_backend.context import effective_context  # noqa: E402
from tree_chat_backend.models import Node  # noqa: E402


class FakeClient:
    """Mimics the bits of the OpenAI client the backend uses."""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, model: str, messages: list[dict], stream: bool = False):
        self.calls.append({"messages": messages, "stream": stream})
        is_summary = messages[0]["content"].startswith("You condense conversations")
        text = "SUMMARY-%d" % len(self.calls) if is_summary else "reply " + "x" * 300
        if stream:
            return iter(
                [SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=text))])]
            )
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])

    def summary_calls(self) -> int:
        return sum(1 for c in self.calls if not c["stream"] and c["messages"][0]["content"].startswith("You condense"))


def events(response) -> list[dict]:
    out = []
    for block in response.text.split("\n\n"):
        block = block.strip()
        if block.startswith("data:"):
            out.append(json.loads(block[5:]))
    return out


def run() -> None:
    tmp = Path(tempfile.mkdtemp()) / "checks.db"
    db_module.engine = create_engine(f"sqlite:///{tmp}", connect_args={"check_same_thread": False})
    fake = FakeClient()
    app_module.get_openrouter_client = lambda key=None: fake

    with TestClient(app_module.app) as client:
        cfg = client.get("/config").json()
        assert cfg == {"warn_tokens": 100, "summarize_tokens": 200, "keep_recent_turns": 2}, cfg

        token = client.post("/auth/register", json={"username": "checker", "password": "secret1"}).json()["access_token"]
        auth = {"Authorization": f"Bearer {token}"}

        conv = client.post("/conversations", headers=auth, json={"prompt": "root question"}).json()
        conv_id = conv["conversation"]["id"]
        parent = conv["root_node_id"]
        ids = [parent]

        def send(parent_id: str, prompt: str, **extra) -> tuple[dict, list[dict]]:
            r = client.post(
                f"/conversations/{conv_id}/nodes",
                headers=auth,
                json={"parent_id": parent_id, "prompt": prompt, **extra},
            )
            assert r.status_code == 200, r.text
            evs = events(r)
            done = [e for e in evs if e["type"] == "done"]
            assert done, evs
            return done[0]["node"], evs

        # 1. Grow a branch until it must be summarized.
        summarized_at = None
        for i in range(6):
            node, evs = send(parent, f"question {i}")
            ctx = next(e for e in evs if e["type"] == "context")
            if any(e["type"] == "summarized" for e in evs):
                summarized_at = summarized_at or i
                assert node["context_summarized"] is True
                assert ctx["summarizing"] is True
            parent = node["id"]
            ids.append(parent)
        assert summarized_at is not None, "summarization never triggered"
        print(f"✓ summarization triggered at turn {summarized_at}")

        # The summary is sent as a system message and the last 2 turns verbatim.
        last_stream = [c for c in fake.calls if c["stream"]][-1]["messages"]
        assert last_stream[1]["role"] == "system" and "Summary of the earlier conversation" in last_stream[1]["content"]
        assert [m["content"] for m in last_stream if m["role"] == "user"][-3:-1] == ["question 3", "question 4"]
        print("✓ summary + last turns kept verbatim")

        # Summaries are cached on nodes and reused incrementally.
        with Session(db_module.engine) as s:
            cached = s.exec(select(Node).where(Node.context_summary.is_not(None))).all()
            assert cached, "no summary cached"
        before = fake.summary_calls()
        node, evs = send(ids[-1], "one more")  # older part grows by one turn -> one incremental call
        assert fake.summary_calls() == before + 1
        summary_prompt = [c for c in fake.calls if not c["stream"]][-1]["messages"][1]["content"]
        assert summary_prompt.startswith("Summary so far:"), summary_prompt[:80]
        print("✓ cached summary reused incrementally")

        # 2. None mode: nothing earlier is sent.
        node, evs = send(ids[1], "fresh", context_mode="none")
        assert node["context_mode"] == "none" and node["include_parent_context"] is False
        assert [m["role"] for m in fake.calls[-1]["messages"]] == ["system", "user"]
        print("✓ none mode")

        # 3. Selected mode: exactly the chosen nodes, oldest first.
        node, evs = send(ids[3], "picked", context_mode="selected", context_node_ids=[ids[2], ids[0]])
        assert node["context_mode"] == "selected" and set(node["context_node_ids"]) == {ids[0], ids[2]}
        users = [m["content"] for m in fake.calls[-1]["messages"] if m["role"] == "user"]
        assert users == ["root question", "question 1", "picked"], users
        selected_node = node["id"]
        print("✓ selected mode")

        # A full-context child of a selected node sees the selection + that node.
        node, evs = send(selected_node, "after picked")
        # (3 turns is over the tiny test threshold, so the oldest one is summarized.)
        msgs = fake.calls[-1]["messages"]
        users = [m["content"] for m in msgs if m["role"] == "user"]
        assert users == ["question 1", "picked", "after picked"], users
        assert "Summary of the earlier conversation" in msgs[1]["content"]
        with Session(db_module.engine) as s:
            n = s.get(Node, __import__("uuid").UUID(node["id"]))
            load = lambda xs: list(s.exec(select(Node).where(Node.id.in_(xs))).all())  # noqa: E731
            assert [x.prompt for x in effective_context(n, load)] == ["root question", "question 1", "picked", "after picked"]
        print("✓ full context after a selected node")

        # Validation: empty selection and nodes from another conversation are rejected.
        r = client.post(f"/conversations/{conv_id}/nodes", headers=auth, json={"parent_id": ids[1], "prompt": "x", "context_mode": "selected"})
        assert r.status_code == 400
        other = client.post("/conversations", headers=auth, json={"prompt": "other"}).json()
        r = client.post(
            f"/conversations/{conv_id}/nodes",
            headers=auth,
            json={"parent_id": ids[1], "prompt": "x", "context_mode": "selected", "context_node_ids": [other["root_node_id"]]},
        )
        assert r.status_code == 400
        print("✓ selected-mode validation")

        # Legacy include_parent_context=false still means none.
        node, _ = send(ids[1], "legacy", include_parent_context=False)
        assert node["context_mode"] == "none"
        print("✓ legacy include_parent_context")

    print("✅ summarize checks passed.")


if __name__ == "__main__":
    run()
