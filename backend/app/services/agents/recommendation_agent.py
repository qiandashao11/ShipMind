from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from app.services.agents.base import BaseAgent


class RecommendationAgent(BaseAgent):
    name = "recommendation_agent"
    description = "Recommends context-aware chat prompts based on the repository's current issues, PRs and CI status."
    available_tools = ["repository_snapshot"]

    async def run(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        limit = min(max(int(input_data.get("limit") or 5), 4), 5)
        excluded = {self._normalize(item) for item in input_data.get("exclude") or []}
        candidates = self._build_candidates(input_data)

        selected: list[str] = []
        seen = set(excluded)
        for prompt in candidates:
            normalized = self._normalize(prompt)
            if not normalized or normalized in seen:
                continue
            selected.append(prompt)
            seen.add(normalized)
            if len(selected) >= limit:
                break

        if not selected and excluded:
            for prompt in candidates:
                normalized = self._normalize(prompt)
                if not normalized:
                    continue
                selected.append(prompt)
                if len(selected) >= limit:
                    break

        return {
            "agent": self.name,
            "suggestions": selected,
            "source_counts": {
                "issues": len(input_data.get("issues") or []),
                "pull_requests": len(input_data.get("pull_requests") or []),
                "workflow_runs": len(input_data.get("workflow_runs") or []),
            },
        }

    def _build_candidates(self, input_data: dict[str, Any]) -> list[str]:
        issues = sorted(input_data.get("issues") or [], key=self._sort_key, reverse=True)
        prs = sorted(input_data.get("pull_requests") or [], key=self._sort_key, reverse=True)
        runs = sorted(input_data.get("workflow_runs") or [], key=self._sort_key, reverse=True)
        if not issues and not prs and not runs:
            return [
                "Give me an overview of this new repository",
                "Show me this project's code structure",
                "How do I sync this repository's issues, PRs and CI",
                "Help me set up project memory and team roles",
                "Generate an onboarding checklist for this project",
                "What should this repository configure first",
                "Help me plan the first project sync and analysis",
            ]

        open_issues = [item for item in issues if str(item.get("state") or "").lower() == "open"]
        open_prs = [item for item in prs if str(item.get("state") or "").lower() == "open"]
        failed_runs = [item for item in runs if str(item.get("conclusion") or "").lower() == "failure"]

        candidates: list[str] = []

        for run in failed_runs[:5]:
            name = self._short(run.get("name") or "latest CI")
            candidates.extend(
                [
                    f"Find out why {name} failed",
                    f"Turn the {name} failure log into fix steps",
                    f"Check whether the {name} failure is related to recent PRs",
                    f"Generate a debugging checklist for {name}",
                ]
            )

        if not failed_runs and runs:
            latest = self._short(runs[0].get("name") or "latest CI")
            candidates.extend(
                [
                    f"Check the CI status of {latest}",
                    "Are there any hidden risks in recent CI runs",
                    "Summarize the health of recent workflows",
                    "If CI fails, where should I look first",
                ]
            )

        for pr in open_prs[:5]:
            number = pr.get("number")
            label = f"PR #{number}" if number else "the latest PR"
            title = self._short(pr.get("title") or "")
            suffix = f": {title}" if title else ""
            candidates.extend(
                [
                    f"Summarize the risks of {label}{suffix}",
                    f"Which tests does {label} still need",
                    f"Generate a pre-merge checklist for {label}",
                    f"Will {label} affect CI or the release",
                ]
            )

        for issue in open_issues[:5]:
            number = issue.get("number")
            label = f"Issue #{number}" if number else "the latest issue"
            title = self._short(issue.get("title") or "")
            suffix = f": {title}" if title else ""
            candidates.extend(
                [
                    f"Who should own {label}{suffix}",
                    f"Analyze the priority and complexity of {label}",
                    f"Draft a clarification comment for {label}",
                    f"Break {label} down into actionable tasks",
                ]
            )

        if failed_runs:
            candidates.extend(
                [
                    "Why did the recent CI fail",
                    "Analyze failed CI runs together with related PRs" if prs else "Turn failed CI runs into debugging steps",
                ]
            )
        if prs:
            candidates.extend(
                [
                    "Summarize the risks of this PR",
                    "Rank open PRs by risk",
                    "Which PRs are ready to merge today",
                    "Generate a pre-merge risk checklist",
                ]
            )
        if issues:
            candidates.extend(
                [
                    "Who should own this issue",
                    "Organize open issues by priority",
                    "Which issues need more reproduction details",
                    "Recommend issue owners based on team skills",
                    "Analyze the longest-open issues",
                ]
            )
        if issues and prs:
            candidates.extend(["Turn current issues and PRs into a stand-up summary", "Find the items most likely to slow down delivery"])

        candidates.extend(
            [
                "Generate this week's engineering report",
                "Give me an overview of the current repository",
                "Find the top 3 things to handle first",
                "Generate today's engineering status summary",
                "List the main blockers in this project",
                "Take a look at this project's code structure",
                "Search the current code for test configuration",
                "Check risks that recent changes might introduce",
                "Help me plan the next debugging steps",
                "Which tasks need an owner to confirm first",
                "Write a progress update for the team",
                "Check for write actions that need safety confirmation",
                "What knowledge base content is available for this repository",
                "What should this week's engineering report focus on",
                "Summarize the quality risks of this project",
                "List things we can move forward quickly today",
            ]
        )
        return self._dedupe(candidates)

    def _dedupe(self, values: list[str]) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()
        for value in values:
            normalized = self._normalize(value)
            if not normalized or normalized in seen:
                continue
            result.append(value)
            seen.add(normalized)
        return result

    def _normalize(self, value: Any) -> str:
        return re.sub(r"\s+", " ", str(value or "").strip().lower())

    def _short(self, value: Any, max_length: int = 40) -> str:
        text = re.sub(r"\s+", " ", str(value or "").strip())
        if len(text) <= max_length:
            return text
        return text[:max_length].rstrip() + "..."

    def _sort_key(self, item: dict[str, Any]) -> float:
        for key in ["updated_at", "created_at", "merged_at", "closed_at"]:
            value = item.get(key)
            if isinstance(value, datetime):
                return value.timestamp()
            if isinstance(value, str) and value:
                try:
                    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
                except ValueError:
                    continue
        return 0.0
