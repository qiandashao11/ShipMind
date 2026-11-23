import os
import uuid

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models import Base, Conversation, Repository
from app.services.chat_memory import MessageStore


def test_messages_appended_in_one_transaction_keep_their_order() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    repo = Repository(owner="shipmind", name="order", full_name=f"shipmind/{uuid.uuid4().hex}")
    db.add(repo)
    db.flush()
    conversation = Conversation(repo_id=repo.id, title="Order test")
    db.add(conversation)
    db.flush()

    store = MessageStore(db)
    # Several turns in the same transaction: with a database-side now() default
    # these would all share one timestamp and sort by random UUID.
    for index in range(10):
        store.append(repo_id=repo.id, conversation_id=conversation.id, role="user", content=f"question {index}")
        store.append(repo_id=repo.id, conversation_id=conversation.id, role="assistant", content=f"answer {index}")
    db.commit()

    timeline = store.timeline(repo.id, conversation.id, limit=50)
    assert [message.content for message in timeline] == [
        text for index in range(10) for text in (f"question {index}", f"answer {index}")
    ]
