import pytest

from app.services.agents.pr_review_agent import PRReviewAgent


class NoopLLM:
    async def chat_json(self, system_prompt, user_payload):
        return {}


class OverconfidentLLM:
    async def chat_json(self, system_prompt, user_payload):
        return {
            "merge_recommendation": "Approve merge",
            "review_findings": [
                {
                    "severity": "P2",
                    "title": "Permission boundary lacks validation",
                    "evidence": "The diff changes permission checks but has no matching test evidence.",
                    "required_action": "Add permission boundary tests or a manual verification record.",
                    "blocking": True,
                }
            ],
            "blocking_issues": [],
        }


@pytest.mark.asyncio
async def test_pr_review_fallback_emits_blocking_findings() -> None:
    result = await PRReviewAgent(llm=NoopLLM()).run(
        {
            "number": 12,
            "state": "open",
            "author": "alice",
            "title": "Update auth middleware",
            "body": "Refactor permission checks.",
            "files": [
                {
                    "filename": "backend/app/auth/middleware.py",
                    "additions": 320,
                    "deletions": 12,
                    "patch": "permission change",
                }
            ],
            "comments": [{"body": "Please verify token handling is not logged."}],
        },
        {"ci_summary": {"failed_runs": 1}},
    )

    severities = {item["severity"] for item in result["review_findings"]}
    assert {"P1", "P2"} <= severities
    assert result["merge_recommendation"] == "Hold"
    assert result["blocking_issues"]


@pytest.mark.asyncio
async def test_pr_review_downgrades_merge_when_llm_returns_blocking_finding() -> None:
    result = await PRReviewAgent(llm=OverconfidentLLM()).run(
        {
            "number": 13,
            "state": "open",
            "author": "alice",
            "title": "Update permission UI",
            "body": "Ready to merge.",
            "files": [
                {
                    "filename": "frontend/app/page.tsx",
                    "additions": 20,
                    "deletions": 3,
                    "patch": "permission UI change",
                }
            ],
            "comments": [],
        },
        {},
    )

    assert result["merge_recommendation"] == "Merge after changes"
    assert any("Permission boundary lacks validation" in item for item in result["blocking_issues"])
    assert result["review_findings"][0]["severity"] == "P2"
