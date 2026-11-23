import logging
from typing import Any

import httpx

from app.core.config import settings
from app.db.models import AgentRun, ChatFeedback, ChatMessage, Repository, User

logger = logging.getLogger(__name__)

REASON_LABELS = {
    "inaccurate": "Inaccurate content",
    "not_relevant": "Did not solve the problem",
    "missing_context": "Missing key context",
    "unreliable_citation": "Unreliable citation or evidence",
    "tool_error": "Tool execution error",
    "other": "Other",
}


def _clip(value: str | None, limit: int) -> str:
    text = " ".join((value or "").split())
    return text if len(text) <= limit else f"{text[:limit]}..."


def _trace_url(run_id: Any) -> str:
    path = f"/api/chat/feedback/trace/{run_id}"
    base_url = (settings.feedback_trace_base_url or "").strip().rstrip("/")
    return f"{base_url}{path}" if base_url else path


async def send_negative_feedback_notification(
    *,
    feedback: ChatFeedback,
    repo: Repository,
    message: ChatMessage,
    run: AgentRun | None,
    reporter: User | None,
) -> tuple[str, str | None]:
    webhook_url = (settings.feishu_feedback_webhook_url or "").strip()
    if not webhook_url:
        return "not_configured", None

    run_id = feedback.run_id or "not linked"
    lines = [
        "ShipMind received negative feedback",
        f"Project: {repo.full_name}",
        f"Reporter: {reporter.name if reporter else 'internal user'}",
        f"trace_id: {run_id}",
        f"message_id: {feedback.assistant_message_id}",
        f"Route: {run.route if run else message.route or 'unknown'}",
        f"Reason: {REASON_LABELS.get(feedback.reason or '', 'not provided')}",
    ]
    if feedback.comment:
        lines.append(f"Details: {_clip(feedback.comment, 300)}")
    if run:
        lines.extend(
            [
                f"User question: {_clip(run.user_message, 300)}",
                f"Agent answer: {_clip(run.final_answer, 500)}",
            ]
        )
    lines.append(f"Execution trace: {_trace_url(run_id)}" if feedback.run_id else "Execution trace: this historical answer has no run_id")

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                webhook_url,
                json={"msg_type": "text", "content": {"text": "\n".join(lines)}},
            )
            response.raise_for_status()
            payload = response.json()
            status_code = payload.get("StatusCode", payload.get("code", 0)) if isinstance(payload, dict) else 0
            if status_code not in {0, "0", None}:
                raise RuntimeError(str(payload.get("StatusMessage") or payload.get("msg") or payload))
    except Exception as exc:  # Notification failure must not lose the persisted feedback.
        logger.warning("Failed to send Feishu negative-feedback notification: %s", exc)
        return "failed", _clip(str(exc), 1000)
    return "sent", None
