import os
import uuid

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.db.models import (
    AgentRun,
    AgentTaskRun,
    AgentWorkflowRun,
    Base,
    ChatFeedback,
    ChatMessage,
    ChatSession,
    Conversation,
    ConversationMemory,
    EvidenceItem,
    MemoryCandidate,
    RecallEvent,
    Repository,
)
from app.services.conversations import delete_conversation


def _db_session():
    engine = create_engine("sqlite+pysqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _connection_record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_delete_conversation_removes_session_memory_and_workflow_dependencies() -> None:
    db = _db_session()
    repo = Repository(owner="shipmind", name="conversation-delete", full_name=f"shipmind/{uuid.uuid4().hex}")
    db.add(repo)
    db.flush()
    target = Conversation(repo_id=repo.id, title="hi, hello")
    replacement = Conversation(repo_id=repo.id, title="Kept conversation")
    db.add_all([target, replacement])
    db.flush()

    run = AgentRun(
        repo_id=repo.id,
        conversation_id=target.id,
        user_message="hi, hello",
        route="test",
        tool_calls=[],
        final_answer="Hello",
    )
    user_message = ChatMessage(repo_id=repo.id, conversation_id=target.id, role="user", content="hi, hello")
    assistant_message = ChatMessage(repo_id=repo.id, conversation_id=target.id, role="assistant", content="Hello")
    session = ChatSession(repo_id=repo.id, conversation_id=target.id, route="test", transcript_json={}, digest="Hello")
    workflow = AgentWorkflowRun(repo_id=repo.id, conversation_id=target.id, goal="test")
    db.add_all([run, user_message, assistant_message, session, workflow])
    db.flush()

    db.add_all(
        [
            ChatFeedback(
                repo_id=repo.id,
                conversation_id=target.id,
                assistant_message_id=assistant_message.id,
                run_id=run.id,
                rating="helpful",
            ),
            MemoryCandidate(
                repo_id=repo.id,
                conversation_id=target.id,
                session_id=session.id,
                kind="fact",
                title="candidate",
                content="must be deleted before the session",
            ),
            RecallEvent(repo_id=repo.id, conversation_id=target.id, tool_name="memory.search"),
            AgentTaskRun(
                workflow_id=workflow.id,
                task_id="task-1",
                agent_name="test-agent",
                task_type="test",
            ),
            ConversationMemory(repo_id=repo.id, conversation_id=target.id),
            EvidenceItem(
                repo_id=repo.id,
                conversation_id=target.id,
                source_type="test",
                source_id="conversation-delete",
                title="evidence",
                content="delete regression",
            ),
        ]
    )
    db.commit()

    active = delete_conversation(db, repo.id, target.id)
    db.commit()

    assert active.id == replacement.id
    assert db.get(Conversation, target.id).status == "deleted"
    for model in [
        ChatFeedback,
        MemoryCandidate,
        RecallEvent,
        AgentTaskRun,
        AgentWorkflowRun,
        ChatMessage,
        ChatSession,
        AgentRun,
        ConversationMemory,
        EvidenceItem,
    ]:
        assert db.query(model).count() == 0
