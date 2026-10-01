from __future__ import annotations

import uuid
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from tree_chat_backend.app import app
from tree_chat_backend.db import get_session, init_db
from tree_chat_backend.models import Conversation, Node, User


def run_checks() -> None:
    init_db()
    client = TestClient(app)

    # 1. Register Alice
    unique_suffix = uuid.uuid4().hex[:6]
    alice_username = f"alice_{unique_suffix}"
    bob_username = f"bob_{unique_suffix}"

    res_alice_reg = client.post(
        "/auth/register",
        json={"username": alice_username, "password": "password123", "email": f"{alice_username}@example.com"},
    )
    assert res_alice_reg.status_code == 200, f"Alice register failed: {res_alice_reg.text}"
    alice_token = res_alice_reg.json()["access_token"]
    alice_user = res_alice_reg.json()["user"]
    assert alice_user["username"] == alice_username

    # 2. Register duplicate username should fail
    res_dup = client.post(
        "/auth/register",
        json={"username": alice_username, "password": "password123"},
    )
    assert res_dup.status_code == 400

    # 3. Login Alice
    res_alice_login = client.post(
        "/auth/login",
        json={"username": alice_username, "password": "password123"},
    )
    assert res_alice_login.status_code == 200
    assert "access_token" in res_alice_login.json()

    # 4. Wrong password login fails
    res_bad_login = client.post(
        "/auth/login",
        json={"username": alice_username, "password": "wrongpassword"},
    )
    assert res_bad_login.status_code == 401

    # 5. /auth/me with Alice's token
    res_me = client.get("/auth/me", headers={"Authorization": f"Bearer {alice_token}"})
    assert res_me.status_code == 200
    assert res_me.json()["username"] == alice_username

    # 6. /auth/me without token fails
    res_no_token = client.get("/auth/me")
    assert res_no_token.status_code == 401

    # 7. Register Bob
    res_bob_reg = client.post(
        "/auth/register",
        json={"username": bob_username, "password": "password456"},
    )
    assert res_bob_reg.status_code == 200
    bob_token = res_bob_reg.json()["access_token"]
    bob_user = res_bob_reg.json()["user"]

    # 8. Create conversation in DB for Alice and Bob
    alice_conv_id: uuid.UUID
    bob_conv_id: uuid.UUID
    with get_session() as session:
        c_alice = Conversation(title="Alice Private Chat", user_id=uuid.UUID(alice_user["id"]))
        session.add(c_alice)
        session.commit()
        session.refresh(c_alice)
        alice_conv_id = c_alice.id

        n_alice = Node(
            conversation_id=c_alice.id,
            prompt="Alice secret prompt",
            response="Alice secret response",
            model_used="test-model",
        )
        session.add(n_alice)
        session.commit()

        c_bob = Conversation(title="Bob Private Chat", user_id=uuid.UUID(bob_user["id"]))
        session.add(c_bob)
        session.commit()
        session.refresh(c_bob)
        bob_conv_id = c_bob.id

        n_bob = Node(
            conversation_id=c_bob.id,
            prompt="Bob secret prompt",
            response="Bob secret response",
            model_used="test-model",
        )
        session.add(n_bob)
        session.commit()

    # 9. Test Alice /conversations
    res_alice_convs = client.get("/conversations", headers={"Authorization": f"Bearer {alice_token}"})
    assert res_alice_convs.status_code == 200
    alice_conv_titles = [c["title"] for c in res_alice_convs.json()]
    assert "Alice Private Chat" in alice_conv_titles
    assert "Bob Private Chat" not in alice_conv_titles

    # 10. Test Bob /conversations
    res_bob_convs = client.get("/conversations", headers={"Authorization": f"Bearer {bob_token}"})
    assert res_bob_convs.status_code == 200
    bob_conv_titles = [c["title"] for c in res_bob_convs.json()]
    assert "Bob Private Chat" in bob_conv_titles
    assert "Alice Private Chat" not in bob_conv_titles

    # 11. Bob trying to view Alice's conversation tree should be blocked (404)
    res_bob_spy = client.get(
        f"/conversations/{alice_conv_id}/tree",
        headers={"Authorization": f"Bearer {bob_token}"},
    )
    assert res_bob_spy.status_code == 404, f"Expected 404, got {res_bob_spy.status_code}"

    # 12. Alice viewing her own conversation tree should succeed
    res_alice_tree = client.get(
        f"/conversations/{alice_conv_id}/tree",
        headers={"Authorization": f"Bearer {alice_token}"},
    )
    assert res_alice_tree.status_code == 200
    assert len(res_alice_tree.json()) == 1
    assert res_alice_tree.json()[0]["prompt"] == "Alice secret prompt"

    print("✅ All JWT Auth and User Isolation tests PASSED successfully!")


if __name__ == "__main__":
    run_checks()
