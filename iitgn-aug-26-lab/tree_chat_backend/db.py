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


def get_session() -> Session:
    return Session(engine)


def get_db_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session

