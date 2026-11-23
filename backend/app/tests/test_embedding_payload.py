from app.core.config import settings
from app.services.rag.embeddings import _embedding_payload


def test_embedding_payload_sends_dimensions_by_default(monkeypatch) -> None:
    monkeypatch.setattr(settings, "embedding_send_dimensions", True)

    payload = _embedding_payload(["hello"], 1024, "Qwen/Qwen3-Embedding-0.6B")

    assert payload == {"model": "Qwen/Qwen3-Embedding-0.6B", "input": ["hello"], "dimensions": 1024}


def test_embedding_payload_can_omit_dimensions_for_native_size_providers(monkeypatch) -> None:
    monkeypatch.setattr(settings, "embedding_send_dimensions", False)

    payload = _embedding_payload(["hello"], 2560, "Qwen/Qwen3-Embedding-4B")

    assert "dimensions" not in payload
    assert payload["model"] == "Qwen/Qwen3-Embedding-4B"
