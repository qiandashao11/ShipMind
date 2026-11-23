import re
from typing import Any


AMBIGUOUS_MARKERS = ("this", "that", "it", "these", "those", "here", "what should i do", "how do i handle", "how to handle")
CONFLICT_POLARITIES = (
    ("permission", ("allowed", "allow", "permitted", "enabled", "enable"), ("forbid", "not allowed", "prohibit", "cannot", "disabled", "disable")),
    ("outcome", ("succeeded", "success", "passed"), ("did not pass", "failure", "failed")),
    ("requirement", ("must", "mandatory", "required"), ("optional", "not required", "no need")),
)


def _normalise(text: str) -> str:
    return " ".join(str(text or "").lower().split())


def _evidence_text(item: dict[str, Any]) -> str:
    metadata = item.get("metadata") or {}
    return _normalise(
        "\n".join(
            [
                str(item.get("title") or ""),
                str(item.get("snippet") or item.get("_raw_content") or ""),
                str(metadata.get("path") or ""),
                str(metadata.get("symbol") or ""),
                str(metadata.get("branch") or metadata.get("base_branch") or ""),
            ]
        )
    )


def _strong_query_signals(query: str) -> list[str]:
    candidates = re.findall(r"[A-Za-z][A-Za-z0-9_./\-]*|#\d+|\b\d{3,}\b", query)
    signals: list[str] = []
    for candidate in candidates:
        if (
            any(marker in candidate for marker in ("_", ".", "/", "-"))
            or any(char.isdigit() for char in candidate)
            or candidate.endswith(("Error", "Exception"))
        ):
            signals.append(candidate.lower())
    return list(dict.fromkeys(signals))


def _detect_conflict(items: list[dict[str, Any]]) -> dict[str, Any] | None:
    high_confidence = [item for item in items if float(item.get("score") or 0.0) >= 0.6]
    if len(high_confidence) < 2:
        return None
    texts = [(str(item.get("id") or item.get("source_id") or ""), _evidence_text(item)) for item in high_confidence]
    for conflict_type, positive_markers, negative_markers in CONFLICT_POLARITIES:
        negative_ids = [item_id for item_id, text in texts if any(marker in text for marker in negative_markers)]
        positive_ids = [
            item_id
            for item_id, text in texts
            if any(marker in text for marker in positive_markers)
            and not any(marker in text for marker in negative_markers)
        ]
        if positive_ids and negative_ids and set(positive_ids) != set(negative_ids):
            return {
                "type": conflict_type,
                "positive_evidence_ids": positive_ids,
                "negative_evidence_ids": negative_ids,
            }
    return None


def _is_ambiguous_query(query: str, items: list[dict[str, Any]]) -> bool:
    words = re.findall(r"[a-z0-9']+", str(query or "").lower())
    padded = f" {' '.join(words)} "
    if not any(f" {marker} " in padded for marker in AMBIGUOUS_MARKERS):
        return False
    source_ids = {str(item.get("source_id") or "") for item in items if item.get("source_id")}
    return len(source_ids) > 1 or len(words) <= 4


def evaluate_answer_gate(
    query: str,
    items: list[dict[str, Any]],
    *,
    score_threshold: float = 0.0,
    threshold_enabled: bool = True,
) -> dict[str, Any]:
    top_score = max((float(item.get("score") or 0.0) for item in items), default=0.0)
    base = {
        "evidence_count": len(items),
        "top_score": round(top_score, 4),
        "score_threshold": round(float(score_threshold), 4) if threshold_enabled else None,
    }
    if not items:
        return {**base, "decision": "insufficient_evidence", "reason": "No evidence matching the conditions was retrieved"}
    if threshold_enabled and top_score < score_threshold:
        return {**base, "decision": "insufficient_evidence", "reason": "The top evidence score did not reach the answer threshold"}

    signals = _strong_query_signals(query)
    evidence_text = "\n".join(_evidence_text(item) for item in items)
    missing_signals = [signal for signal in signals if signal not in evidence_text]
    if signals and len(missing_signals) == len(signals):
        return {
            **base,
            "decision": "insufficient_evidence",
            "reason": "Key names in the query do not appear in the candidate evidence",
            "required_signals": signals,
            "missing_signals": missing_signals,
        }

    conflict = _detect_conflict(items)
    if conflict:
        return {**base, "decision": "conflict", "reason": "Top-ranked evidence gives contradictory conclusions", "conflict": conflict}

    if _is_ambiguous_query(query, items):
        return {
            **base,
            "decision": "ask_clarification",
            "reason": "The question lacks a locatable object or scope",
            "suggested_fields": ["file or module", "error name", "branch or version"],
        }

    return {
        **base,
        "decision": "answer",
        "reason": "Evidence meets the score threshold and key names can be verified in the candidates",
        "matched_signals": [signal for signal in signals if signal in evidence_text],
    }


def gate_response_message(gate: dict[str, Any]) -> str:
    decision = str(gate.get("decision") or "insufficient_evidence")
    if decision == "ask_clarification":
        return "The object or scope of the question is not clear enough. Please add a file, module, error name, branch or version and try again."
    if decision == "conflict":
        return "Top-ranked evidence in the current knowledge base is in conflict, so no definite conclusion can be given yet. Please check the corresponding sources or versions first."
    return "The current knowledge base does not have enough information to confirm this. Please add relevant material, check the retrieval scope, or ask more specifically."
