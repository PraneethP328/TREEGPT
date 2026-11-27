from __future__ import annotations

from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine


DB_PATH = Path(__file__).resolve().parent / "tree_chat.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)


from collections.abc import Generator


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    with engine.connect() as conn:
        cursor = conn.exec_driver_sql("PRAGMA table_info(conversation)")
        columns = [row[1] for row in cursor.fetchall()]
        if "user_id" not in columns:
            conn.exec_driver_sql("ALTER TABLE conversation ADD COLUMN user_id VARCHAR(36) REFERENCES user(id)")
            conn.commit()

        cursor = conn.exec_driver_sql("PRAGMA table_info(node)")
        node_columns = {row[1] for row in cursor.fetchall()}
        new_columns = {
            "context_mode": "VARCHAR NOT NULL DEFAULT 'full'",
            "context_node_ids": "VARCHAR",
            "context_summary": "VARCHAR",
            "context_tokens": "INTEGER",
            "context_summarized": "BOOLEAN NOT NULL DEFAULT 0",
        }
        for name, ddl in new_columns.items():
            if name not in node_columns:
                conn.exec_driver_sql(f"ALTER TABLE node ADD COLUMN {name} {ddl}")
        # Old rows created with include_parent_context = false mean "none".
        if "context_mode" not in node_columns:
            conn.exec_driver_sql(
                "UPDATE node SET context_mode = 'none' WHERE include_parent_context = 0"
            )
        conn.commit()


def get_session() -> Session:
    return Session(engine)


def get_db_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session

