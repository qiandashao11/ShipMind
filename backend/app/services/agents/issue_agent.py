import re
from typing import Any

from app.schemas.analysis import IssueAnalysisOutput, IssueDrafts
from app.services.agents.base import BaseAgent
from app.services.llm.client import LLMClient
from app.services.llm.prompts import ISSUE_ANALYSIS_PROMPT


class IssueAgent(BaseAgent):
    name = "issue_analyst_agent"
    description = "Analyzes a GitHub issue's triage conclusion, priority, complexity, owner, evidence and next actions."
    available_tools = ["get_issue_detail", "search_similar_issues", "search_related_code", "search_project_docs", "read_thread_context"]

    def __init__(self, llm: LLMClient | None = None) -> None:
        self.llm = llm or LLMClient()

    async def run(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        fallback = self._fallback_analysis(input_data, context)
        llm_output = await self.llm.chat_json(ISSUE_ANALYSIS_PROMPT, {"issue": input_data, "context": context})
        if llm_output:
            try:
                normalized = self._merge_with_fallback(llm_output, fallback, input_data, context)
                return IssueAnalysisOutput.model_validate(normalized).model_dump()
            except Exception:
                pass
        return fallback

    def _fallback_analysis(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        text = f"{input_data.get('title', '')} {input_data.get('body', '')}".lower()
        body = str(input_data.get("body") or "")
        labels = [label.lower() for label in input_data.get("labels", [])]
        category = self._classify_category(text, labels)
        priority = self._classify_priority(text, labels)
        complexity = self._estimate_complexity(text, labels)
        owner, owner_reason = self._suggest_owner(input_data, text, context)
        duplicates = self._validated_duplicates(context.get("duplicate_candidates", []))
        conclusion, conclusion_reason = self._choose_conclusion(input_data, text, labels, category, complexity, duplicates)
        checklist = self._build_checklist(conclusion, category)
        drafts = self._build_drafts(input_data, conclusion, checklist)
        evidence = self._collect_evidence(input_data, context)
        confidence = self._estimate_confidence(body, evidence, duplicates, owner)
        return IssueAnalysisOutput(
            summary=self._build_summary(input_data, conclusion),
            conclusion=conclusion,
            conclusion_reason=conclusion_reason,
            category=category,
            priority=priority,
            complexity=complexity,
            suggested_owner=owner,
            owner_reason=owner_reason,
            duplicate_candidates=duplicates,
            evidence=evidence,
            checklist=checklist,
            action_items=checklist,
            drafts=drafts,
            confidence=confidence,
        ).model_dump()

    def _merge_with_fallback(self, output: dict[str, Any], fallback: dict[str, Any], input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        merged = {**fallback, **output}
        if not merged.get("checklist") and merged.get("action_items"):
            merged["checklist"] = merged["action_items"]
        if not merged.get("action_items") and merged.get("checklist"):
            merged["action_items"] = merged["checklist"]
        if not merged.get("evidence"):
            merged["evidence"] = fallback["evidence"]
        merged["evidence"] = self._dedupe_evidence(merged.get("evidence"))
        if not merged.get("duplicate_candidates"):
            merged["duplicate_candidates"] = fallback["duplicate_candidates"]
        if not isinstance(merged.get("drafts"), dict):
            merged["drafts"] = fallback["drafts"]
        if not self._is_allowed_owner(str(merged.get("suggested_owner") or ""), input_data, context):
            merged["suggested_owner"] = fallback["suggested_owner"]
            merged["owner_reason"] = fallback["owner_reason"]
        if self._should_prefer_fallback_owner(str(merged.get("suggested_owner") or ""), str(fallback.get("suggested_owner") or "")):
            merged["suggested_owner"] = fallback["suggested_owner"]
            merged["owner_reason"] = fallback["owner_reason"]
        if merged.get("category") == "Question" and fallback.get("category") in {"Bug", "Feature", "Documentation", "Ops", "Refactor", "Test"}:
            merged["category"] = fallback["category"]
        return merged

    def _should_prefer_fallback_owner(self, current_owner: str, fallback_owner: str) -> bool:
        generic_owners = {"", "Unassigned", "unassigned", "backend", "frontend", "ci", "docs"}
        return fallback_owner not in generic_owners and current_owner.lower() in generic_owners

    def _is_allowed_owner(self, owner: str, input_data: dict[str, Any], context: dict[str, Any]) -> bool:
        normalized_owner = owner.strip().lower()
        if normalized_owner in {"", "unassigned"}:
            return True
        allowed = {str(item).strip().lower() for item in input_data.get("assignees") or [] if str(item).strip()}
        members = context.get("team_members") or []
        if isinstance(members, list):
            for member in members:
                if isinstance(member, dict) and str(member.get("name") or "").strip():
                    allowed.add(str(member.get("name")).strip().lower())
        return normalized_owner in allowed

    def _build_summary(self, input_data: dict[str, Any], conclusion: str) -> str:
        number = input_data.get("number")
        title = str(input_data.get("title") or "Untitled Issue").strip()
        prefix = f"Issue #{number}" if number else "Issue"
        return f"Recommended conclusion for {prefix} {title}: {conclusion}."

    def _classify_category(self, text: str, labels: list[str]) -> str:
        joined = " ".join(labels) + " " + text
        rules = [
            ("Bug", ["bug", "error", "fail", "500", "crash", "exception", "broken", "regression"]),
            ("Documentation", ["doc", "documentation", "readme", "guide", "manual", "tutorial"]),
            ("Test", ["test", "pytest", "coverage", "unit test", "testing"]),
            ("Ops", ["ops", "ci", "workflow", "deploy", "docker", "infra", "environment", "permission"]),
            ("Refactor", ["refactor", "cleanup", "restructure", "technical debt"]),
            ("Feature", ["feature", "enhancement", "proposal", "requirement", "add support"]),
            ("Question", ["question", "how to", "why does", "inquiry", "confused"]),
        ]
        for category, tokens in rules:
            if any(token in joined for token in tokens):
                return category
        return "Feature"

    def _classify_priority(self, text: str, labels: list[str]) -> str:
        joined = " ".join(labels) + " " + text
        if any(token in joined for token in ["p0", "sev0", "critical", "security", "data loss", "full outage", "completely unavailable"]):
            return "P0"
        if any(token in joined for token in ["p1", "sev1", "crash", "cannot login", "500", "production", "blocking", "blocker"]):
            return "P1"
        if any(token in joined for token in ["p3", "minor", "polish", "typo", "wording", "low priority"]):
            return "P3"
        return "P2"

    def _estimate_complexity(self, text: str, labels: list[str]) -> str:
        joined = " ".join(labels) + " " + text
        if any(token in joined for token in ["xl", "architecture", "migration", "rewrite", "cross-module", "cross module"]):
            return "XL"
        if any(token in joined for token in ["large", "complex", "integration", "schema", "multi-module", "multiple modules"]):
            return "L"
        if len(text) < 280 and any(token in joined for token in ["typo", "copy", "wording", "doc"]):
            return "S"
        return "M" if len(text) < 1400 else "L"

    def _suggest_owner(self, input_data: dict[str, Any], issue_text: str, context: dict[str, Any]) -> tuple[str, str]:
        assignees = input_data.get("assignees") or []
        if assignees:
            owner = str(assignees[0])
            return owner, f"The issue is already assigned to {owner}; keep the existing owner."

        signal_text = self._owner_signal_text(issue_text, context)
        team_owner, team_reason = self._suggest_owner_from_team(issue_text, signal_text, context)
        if team_owner:
            return team_owner, team_reason or "Team profiles match the issue keywords."

        area = self._infer_area(signal_text)
        members = context.get("team_members") or []
        if not isinstance(members, list) or not members:
            if area != "Unassigned":
                return "Unassigned", f"No team members have been added to this project yet; this issue looks like {area} work, so add a matching developer in the Team panel before assigning it."
            return "Unassigned", "No team members have been added to this project yet; add developers in the Team panel before assigning."
        if area != "Unassigned":
            return "Unassigned", f"No team member matches the {area} area; add team member profiles before assigning."
        return "Unassigned", "The issue does not match team profiles or code/doc evidence well enough; the owner needs human confirmation."

    def _suggest_owner_from_team(self, issue_text: str, signal_text: str, context: dict[str, Any]) -> tuple[str | None, str | None]:
        members = context.get("team_members") or []
        if not isinstance(members, list):
            return None, None

        best_name = None
        best_score = 0
        best_reasons: list[str] = []
        for member in members:
            if not isinstance(member, dict):
                continue
            name = str(member.get("name") or "").strip()
            profile = " ".join(
                str(member.get(field) or "").lower()
                for field in ["role", "strengths", "techStack", "tech_stack"]
            )
            score = 0
            reasons: list[str] = []
            for term in self._profile_terms(profile):
                if len(term) >= 2 and term in signal_text:
                    score += 1
                    reasons.append(term)
            for domain, issue_terms, profile_terms in self._owner_domain_rules():
                if any(term in signal_text for term in issue_terms) and any(term in profile for term in profile_terms):
                    score += 8
                    reasons.append(domain)
            if name and score > best_score:
                best_name = name
                best_score = score
                best_reasons = reasons
        if best_name and best_score > 0:
            reason_text = ", ".join(dict.fromkeys(best_reasons[:4])) or "team profile"
            return best_name, f"Team member profile matches issue/code/doc signals: {reason_text}, match score {best_score}."
        return None, None

    def _infer_area(self, issue_text: str) -> str:
        area_keywords = {
            "backend": ["api", "database", "token", "server", "fastapi", "postgres", "auth", "jwt"],
            "frontend": ["ui", "page", "button", "react", "next", "css", "layout", "browser", "electron", "desktop", "desktop app"],
            "ci": ["ci", "workflow", "actions", "pytest", "lint", "build", "deploy"],
            "docs": ["readme", "doc", "documentation", "guide"],
        }
        for area, keywords in area_keywords.items():
            if any(keyword in issue_text for keyword in keywords):
                return area
        return "Unassigned"

    def _owner_signal_text(self, issue_text: str, context: dict[str, Any]) -> str:
        parts = [issue_text]
        for key in ["code_references", "project_documents", "conversation_evidence"]:
            items = context.get(key)
            if not isinstance(items, list):
                continue
            for item in items[:6]:
                if isinstance(item, dict):
                    parts.extend([str(item.get("title") or ""), str(item.get("snippet") or ""), str(item.get("content") or "")])
        text = " ".join(parts).lower()
        if any(term in text for term in ["desktop app", "desktop client", "desktop application", "electron"]):
            text += " electron desktop windows macos javascript node frontend"
        return text

    def _profile_terms(self, profile: str) -> list[str]:
        normalized = profile.replace("good at", " ").replace("familiar with", " ").replace("tech stack", " ")
        return re.findall(r"[a-zA-Z0-9_+#.\u4e00-\u9fff]+", normalized.lower())

    def _owner_domain_rules(self) -> list[tuple[str, list[str], list[str]]]:
        return [
            (
                "desktop/electron",
                ["desktop app", "desktop client", "desktop application", "electron", "desktop", "windows", "macos", "native app"],
                ["electron", "desktop", "windows", "macos", "tauri", "javascript", "js", "node", "frontend"],
            ),
            (
                "backend/API",
                ["api", "database", "token", "server", "fastapi", "postgres", "auth", "jwt"],
                ["api", "database", "server", "fastapi", "postgres", "auth", "jwt", "backend"],
            ),
            (
                "frontend/UI",
                ["ui", "page", "button", "react", "next", "css", "layout", "browser"],
                ["ui", "react", "next", "css", "browser", "frontend"],
            ),
            (
                "CI/engineering",
                ["ci", "workflow", "actions", "pytest", "lint", "build", "deploy"],
                ["ci", "workflow", "actions", "pytest", "lint", "build", "deploy", "devops"],
            ),
        ]

    def _validated_duplicates(self, candidates: Any) -> list[dict[str, Any]]:
        if not isinstance(candidates, list):
            return []
        rows = []
        for item in candidates[:5]:
            if not isinstance(item, dict):
                continue
            issue_id = str(item.get("issue_id") or item.get("source_id") or "").strip()
            title = str(item.get("title") or "").strip()
            try:
                score = max(0.0, min(1.0, float(item.get("score") or 0)))
            except (TypeError, ValueError):
                score = 0.0
            if issue_id and title:
                rows.append({"issue_id": issue_id, "title": title, "score": score})
        return rows

    def _choose_conclusion(
        self,
        input_data: dict[str, Any],
        text: str,
        labels: list[str],
        category: str,
        complexity: str,
        duplicates: list[dict[str, Any]],
    ) -> tuple[str, str]:
        state = str(input_data.get("state") or "").lower()
        joined = " ".join(labels) + " " + text
        if state == "closed" or any(token in joined for token in ["invalid", "wontfix", "won't fix", "not planned", "will not fix"]):
            return "Close", "The issue is closed or carries an invalid/won't-fix signal; archive it and keep a closing note."
        if any(float(item.get("score") or 0) >= 0.86 for item in duplicates):
            return "Merge into existing issue", "A similar historical issue matches closely; merge the context to avoid duplicate work."
        if complexity in {"XL"} or self._looks_like_multi_scope(text):
            return "Split", "The issue scope is large or contains several independent goals; splitting makes scheduling and acceptance easier."
        if self._needs_clarification(text, category):
            return "Needs clarification", "The description lacks impact scope, reproduction/acceptance conditions or expected results; starting development now is risky."
        return "Ready for development", "The issue is mostly actionable; confirm acceptance criteria first, then start development."

    def _looks_like_multi_scope(self, text: str) -> bool:
        separators = text.count("\n-") + text.count("\n*") + text.count(", ") + text.count(";")
        broad_terms = ["at the same time", "as well as", "and also", "multiple", "all of", "migration", "architecture", "cross-module"]
        return separators >= 5 or any(term in text for term in broad_terms)

    def _needs_clarification(self, text: str, category: str) -> bool:
        if len(text.strip()) < 80:
            return True
        if category == "Bug":
            has_repro = any(token in text for token in ["reproduce", "steps", "repro", "expected", "actual"])
            has_impact = any(token in text for token in ["impact", "affect", "scope", "range", "blocking", "blocker"])
            return not (has_repro or has_impact)
        if category == "Feature":
            has_acceptance = any(token in text for token in ["acceptance", "criteria", "why", "value", "scenario", "use case"])
            return not has_acceptance and len(text.strip()) < 220
        return False

    def _collect_evidence(self, input_data: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
        evidence = [
            {
                "source_type": "issue",
                "title": f"Issue #{input_data.get('number')}: {input_data.get('title')}",
                "snippet": self._clip("\n".join(filter(None, [str(input_data.get("title") or ""), str(input_data.get("body") or "")])), 320),
                "reference": str(input_data.get("id") or input_data.get("number") or ""),
                "confidence": 1.0,
            }
        ]
        for duplicate in self._validated_duplicates(context.get("duplicate_candidates", []))[:3]:
            evidence.append(
                {
                    "source_type": "similar_issue",
                    "title": duplicate["title"],
                    "snippet": f"Similarity {duplicate['score']:.2f}; useful as a duplicate/historical handling reference.",
                    "reference": duplicate["issue_id"],
                    "confidence": duplicate["score"],
                }
            )
        for key, source_type in [
            ("code_references", "code"),
            ("project_documents", "document"),
            ("conversation_evidence", "conversation"),
        ]:
            evidence.extend(self._evidence_from_context(context.get(key), source_type))
        evidence.extend(self._team_evidence(context.get("team_members")))
        return self._dedupe_evidence(evidence)[:10]

    def _dedupe_evidence(self, items: Any) -> list[dict[str, Any]]:
        if not isinstance(items, list):
            return []
        rows: list[dict[str, Any]] = []
        seen: set[tuple[str, str, str, str]] = set()
        for item in items:
            if not isinstance(item, dict) or not item.get("snippet"):
                continue
            key = (
                str(item.get("source_type") or ""),
                str(item.get("reference") or ""),
                str(item.get("title") or ""),
                str(item.get("snippet") or "")[:180],
            )
            if key in seen:
                continue
            seen.add(key)
            rows.append(item)
        return rows

    def _evidence_from_context(self, items: Any, default_source_type: str) -> list[dict[str, Any]]:
        if not isinstance(items, list):
            return []
        rows = []
        for item in items[:4]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or item.get("path") or item.get("source_id") or default_source_type).strip()
            snippet = self._clip(str(item.get("snippet") or item.get("content") or ""), 320)
            if not snippet:
                continue
            score = item.get("score")
            try:
                confidence = max(0.0, min(1.0, float(score))) if score is not None else None
            except (TypeError, ValueError):
                confidence = None
            rows.append(
                {
                    "source_type": str(item.get("source_type") or default_source_type),
                    "title": title,
                    "snippet": snippet,
                    "reference": str(item.get("reference") or item.get("source_id") or item.get("id") or ""),
                    "confidence": confidence,
                }
            )
        return rows

    def _team_evidence(self, members: Any) -> list[dict[str, Any]]:
        if not isinstance(members, list) or not members:
            return []
        rows = []
        for member in members[:3]:
            if not isinstance(member, dict):
                continue
            name = str(member.get("name") or "").strip()
            if not name:
                continue
            profile = "; ".join(
                str(member.get(field) or "").strip()
                for field in ["role", "strengths", "techStack", "tech_stack"]
                if str(member.get(field) or "").strip()
            )
            rows.append(
                {
                    "source_type": "team_member",
                    "title": f"Team member: {name}",
                    "snippet": profile or "Team member profile can be used as the basis for owner assignment.",
                    "reference": name,
                    "confidence": None,
                }
            )
        return rows

    def _build_checklist(self, conclusion: str, category: str) -> list[str]:
        if conclusion == "Needs clarification":
            return [
                "Add the problem background, impact scope and user scenario.",
                "For bugs, add reproduction steps, expected result, actual result and logs/screenshots.",
                "For features, add acceptance criteria and explicit non-goals.",
                "Re-run the Issue Agent after clarification.",
            ]
        if conclusion == "Merge into existing issue":
            return [
                "Confirm whether the similar issue covers the current request.",
                "Summarize the new information from this issue as a comment on the existing issue.",
                "Mark this issue as duplicate/related.",
                "Close this duplicate issue after human confirmation.",
            ]
        if conclusion == "Split":
            return [
                "Split into 2-5 sub-tasks by user value, module boundary or delivery order.",
                "Add acceptance criteria, dependencies and a suggested owner for each sub-task.",
                "Confirm the minimum deliverable scope and schedule the first independently verifiable sub-task.",
                "Post the split plan back to the original issue as a comment.",
            ]
        if conclusion == "Close":
            return [
                "Confirm whether it is closed as invalid, duplicate, completed or not planned.",
                "Add a short closing comment explaining the basis and any alternative path.",
                "Update labels or close the issue after human confirmation.",
            ]
        baseline = [
            "Confirm the issue's acceptance criteria and out-of-scope items.",
            "Locate the relevant code/docs and add design notes.",
            "Create a development branch and implement the minimal fix or feature increment.",
            "Add automated tests or manual verification steps.",
            "Open a PR and link this issue in the description.",
        ]
        if category == "Bug":
            baseline.insert(2, "First write a failing test or a minimal reproduction script for the problem.")
        return baseline

    def _build_drafts(self, input_data: dict[str, Any], conclusion: str, checklist: list[str]) -> IssueDrafts:
        number = input_data.get("number")
        title = str(input_data.get("title") or "this issue")
        clarification = None
        task_breakdown = None
        if conclusion == "Needs clarification":
            clarification = (
                f"For Issue #{number} {title}, there is not yet enough information to start development. "
                "Please add: impact scope, reproduction steps/use case, expected result, actual result, and any logs, screenshots or version information."
            )
        if conclusion in {"Split", "Ready for development"}:
            task_breakdown = "Suggested next-step breakdown:\n" + "\n".join(f"- {item}" for item in checklist[:5])
        if conclusion == "Merge into existing issue":
            task_breakdown = (
                f"Suggest merging the new information from Issue #{number} into the similar historical issue, leaving a duplicate note on this issue before closing it."
            )
        return IssueDrafts(clarification_comment=clarification, task_breakdown=task_breakdown)

    def _estimate_confidence(self, body: str, evidence: list[dict[str, Any]], duplicates: list[dict[str, Any]], owner: str) -> float:
        score = 0.45
        if len(body.strip()) >= 120:
            score += 0.12
        if len(evidence) >= 3:
            score += 0.14
        if duplicates:
            score += 0.08
        if owner != "Unassigned":
            score += 0.08
        return round(max(0.35, min(0.86, score)), 2)

    def _clip(self, text: str, limit: int) -> str:
        text = (text or "").strip()
        return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
