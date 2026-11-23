import pytest

from app.core.config import settings
from app.services.rag.embeddings import deterministic_embedding
from app.services.rag.qa import answer_question, build_sources
from app.services.rag.retrieval import cosine_similarity


def test_deterministic_embedding_ranks_related_text_higher() -> None:
    question = deterministic_embedding("How do employees apply for annual leave?", 128)
    relevant = deterministic_embedding("Employee annual leave approval process and leave policy", 128)
    unrelated = deterministic_embedding("Database connection pool monitoring alerts", 128)

    assert cosine_similarity(question, relevant) > cosine_similarity(question, unrelated)


def test_build_sources_hides_server_file_path() -> None:
    sources = build_sources(
        [
            {
                "id": "doc-1",
                "source_id": "source-1",
                "source_type": "knowledge_file",
                "title": "handbook.md#1",
                "snippet": "Annual leave must first be submitted for approval in the system.",
                "score": 0.91,
                "metadata": {"filename": "handbook.md", "stored_path": "C:/private/upload/handbook.md"},
            }
        ]
    )

    assert sources[0]["citation"] == 1
    assert sources[0]["metadata"]["filename"] == "handbook.md"
    assert "stored_path" not in sources[0]["metadata"]


@pytest.mark.asyncio
async def test_answer_question_uses_llm_and_returns_numbered_sources(monkeypatch) -> None:
    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    monkeypatch.setattr(
        "app.services.rag.qa.search_similar_documents",
        lambda *args, **kwargs: [
            {
                "id": "doc-1",
                "source_id": "source-1",
                "source_type": "knowledge_file",
                "title": "auth.md#1",
                "snippet": "After the access token expires, the client retries once with the refresh token.",
                "score": 0.95,
                "metadata": {"filename": "auth.md"},
            }
        ],
    )

    class FakeLLM:
        async def chat_text(self, system_prompt: str, user_message: str) -> str:
            assert "may only answer from" in system_prompt
            assert "[Source 1]" in user_message
            return "After the access token expires, retry once with the refresh token. [1]"

    result = await answer_question(object(), "00000000-0000-0000-0000-000000000001", "What should I do after my login expires?", llm=FakeLLM())

    assert result["generation_mode"] == "llm"
    assert result["retrieval_count"] == 1
    assert result["sources"][0]["citation"] == 1
    assert "[1]" in result["answer"]


@pytest.mark.asyncio
async def test_answer_question_has_offline_extractive_fallback(monkeypatch) -> None:
    monkeypatch.setattr(settings, "llm_api_key", None)
    monkeypatch.setattr(
        "app.services.rag.qa.search_similar_documents",
        lambda *args, **kwargs: [
            {
                "id": "doc-1",
                "source_id": "source-1",
                "source_type": "knowledge_file",
                "title": "leave.md#1",
                "snippet": "When an employee applies for annual leave, it must first be approved by their direct manager. Once approved, it is synced to the attendance system.",
                "score": 0.88,
                "metadata": {},
            }
        ],
    )

    result = await answer_question(object(), "00000000-0000-0000-0000-000000000001", "How is annual leave approved?")

    assert result["generation_mode"] == "extractive"
    assert "direct manager" in result["answer"]
    assert "[1]" in result["answer"]


@pytest.mark.asyncio
async def test_answer_question_does_not_call_llm_when_gate_rejects_evidence(monkeypatch) -> None:
    monkeypatch.setattr(settings, "llm_api_key", "test-key")

    async def fake_retrieve(*_args, **_kwargs):
        return (
            [
                {
                    "id": "doc-1",
                    "source_id": "source-1",
                    "source_type": "knowledge_file",
                    "title": "old.md",
                    "snippet": "The old version allows deployment.",
                    "score": 0.91,
                    "metadata": {"branch": "legacy"},
                    "retrieval": {"answer_gate": "conflict"},
                }
            ],
            {"answer_gate": {"decision": "conflict", "reason": "Top-ranked evidence gives contradictory conclusions"}},
            1,
        )

    monkeypatch.setattr("app.services.rag.qa.retrieve_knowledge", fake_retrieve)

    class FakeDB:
        def query(self):
            raise AssertionError("retrieve_knowledge is mocked")

    class FailingLLM:
        async def chat_text(self, _system_prompt: str, _user_message: str) -> str:
            raise AssertionError("LLM must not run when the answer gate rejects evidence")

    result = await answer_question(
        FakeDB(),
        "00000000-0000-0000-0000-000000000001",
        "Is deployment allowed now?",
        llm=FailingLLM(),
    )

    assert result["generation_mode"] == "no_evidence"
    assert result["answer_gate"]["decision"] == "conflict"
    assert result["retrieval_count"] == 1
    assert "is in conflict" in result["answer"]
