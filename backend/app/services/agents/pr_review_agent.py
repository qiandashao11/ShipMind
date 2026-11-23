from typing import Any

from app.schemas.analysis import PRReviewOutput
from app.services.agents.base import BaseAgent
from app.services.llm.client import LLMClient
from app.services.llm.prompts import PR_REVIEW_PROMPT
from app.services.rag.chunking import chunk_pr_files


class PRReviewAgent(BaseAgent):
    name = "pr_review_agent"
    description = "Summarizes a PR diff and produces risk points, a checklist and test suggestions."
    available_tools = ["get_pull_request_detail", "get_pull_request_files", "chunk_diff"]

    def __init__(self, llm: LLMClient | None = None) -> None:
        self.llm = llm or LLMClient()

    async def run(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        diff_chunks = chunk_pr_files(input_data.get("files", []))
        fallback = self._fallback_review(input_data, context, diff_chunks)
        llm_output = await self.llm.chat_json(PR_REVIEW_PROMPT, {"pull_request": input_data, "diff_chunks": diff_chunks, "context": context})
        if llm_output:
            try:
                return PRReviewOutput.model_validate(self._merge_with_fallback(llm_output, fallback)).model_dump()
            except Exception:
                pass
        return fallback

    def _fallback_review(self, input_data: dict[str, Any], context: dict[str, Any], diff_chunks: list[dict[str, Any]]) -> dict[str, Any]:
        files = input_data.get("files", [])
        comments = input_data.get("comments", [])
        filenames = [item.get("filename", "") for item in files]
        total_additions = sum(int(item.get("additions") or 0) for item in files)
        total_deletions = sum(int(item.get("deletions") or 0) for item in files)
        risky_files = [
            name
            for name in filenames
            if any(token in name.lower() for token in ["auth", "security", "migration", "schema", "payment", "permission", "config", "ci", "workflow"])
        ]
        test_files = [
            name
            for name in filenames
            if any(token in name.lower() for token in ["test", "spec", "__tests__", "pytest", "playwright"])
        ]
        total_patch_chars = sum(len(item.get("patch") or "") for item in files)
        risk_points = []
        blocking_issues = []
        review_findings = []
        ci_summary = context.get("ci_summary") or {}
        failed_ci = int(ci_summary.get("failed_runs") or 0)
        if failed_ci:
            message = f"The repository still has {failed_ci} failed CI runs; confirm whether they were introduced by this PR or block the merge."
            blocking_issues.append(message)
            review_findings.append(self._finding("P1", "Failed CI blocks merge", message, "Fix or explain the failed CI first, then re-evaluate the merge."))
        if risky_files:
            message = f"Highly sensitive files need close review: {', '.join(risky_files[:5])}"
            risk_points.append(message)
            review_findings.append(self._finding("P2", "Sensitive file changes need verification", message, "Add a code review record, regression tests or a manual verification note."))
        if comments:
            message = f"There are {len(comments)} review comments; confirm they have all been addressed."
            risk_points.append(message)
            blocking_issues.append(message)
            review_findings.append(self._finding("P2", "Review comments still need confirmation", message, "Reply to each comment and confirm it is resolved before approving."))
        if total_patch_chars > 12000 or len(diff_chunks) > 8:
            message = "The diff is large; review it module by module to avoid missing cross-file effects."
            risk_points.append(message)
            review_findings.append(self._finding("P3", "Large diff", message, "Split the review path by module and add staged verification if needed.", blocking=False))
        if files and not test_files and (risky_files or total_additions + total_deletions > 250):
            message = "The change has no obvious test files; add automated tests or a clear manual verification record before merging."
            blocking_issues.append(message)
            review_findings.append(self._finding("P2", "No evidence of test coverage", message, "Add automated tests, or leave a reviewable manual verification record."))
        if not risk_points:
            risk_points.append("Confirm that edge cases and error paths are covered by tests")
        if not review_findings:
            review_findings.append(
                self._finding(
                    "P3",
                    "No clear blockers found",
                    "Based on the current diff, comments and CI summary, no clear P1/P2 blockers were found.",
                    "Complete the final human confirmation using the checklist.",
                    blocking=False,
                )
            )

        merge_recommendation, recommendation_reason = self._choose_recommendation(input_data, files, risk_points, blocking_issues, failed_ci)
        plan = [
            "Understand the PR title, description, branch, changed files and related context.",
            "Split diff risk by module and identify sensitive paths and large changes.",
            "Read related source code, project docs and historical conversation evidence.",
            "Check CI status, failure records and existing review comments.",
            "Form the merge recommendation, blockers, test suggestions and review checklist.",
        ]
        executed_steps = [
            f"Read PR #{input_data.get('number')}, state {input_data.get('state') or 'unknown'}, author {input_data.get('author') or 'unknown'}.",
            f"Scanned {len(files)} changed files, +{total_additions} / -{total_deletions} in total.",
            f"Identified {len(risky_files)} sensitive files, {len(test_files)} test-related files and {len(comments)} review comments.",
            f"Included {len(context.get('code_references') or [])} code hints, {len(context.get('project_documents') or [])} project docs and {failed_ci} failed CI signals.",
            f"Conclusion: {merge_recommendation}.",
        ]
        return PRReviewOutput(
            summary=f"PR #{input_data.get('number')} changes {len(files)} files, mainly in {', '.join(filenames[:3]) or 'no files provided'}.",
            plan=plan,
            executed_steps=executed_steps,
            merge_recommendation=merge_recommendation,
            recommendation_reason=recommendation_reason,
            review_findings=review_findings,
            key_changes=[f"Update {name}" for name in filenames[:5]],
            risk_points=risk_points if files else ["No changed files provided; risk assessment is limited"],
            blocking_issues=blocking_issues,
            review_checklist=["Confirm API compatibility", "Confirm error-handling paths", "Confirm tests cover key branches", "Confirm review comments have been answered"],
            test_suggestions=self._test_suggestions(filenames, risky_files, failed_ci),
            files_need_attention=(risky_files or filenames)[:5],
            review_comments=[str(comment.get("body") or "").strip() for comment in comments[:5] if str(comment.get("body") or "").strip()],
            confidence=self._estimate_confidence(files, context, failed_ci, blocking_issues),
        ).model_dump()

    def _merge_with_fallback(self, output: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
        merged = {**fallback, **output}
        for key in [
            "plan",
            "executed_steps",
            "review_findings",
            "key_changes",
            "risk_points",
            "blocking_issues",
            "review_checklist",
            "test_suggestions",
            "files_need_attention",
            "review_comments",
        ]:
            if not merged.get(key):
                merged[key] = fallback[key]
        for key in ["merge_recommendation", "recommendation_reason", "summary"]:
            if not str(merged.get(key) or "").strip():
                merged[key] = fallback[key]
        merged["review_findings"] = self._normalize_review_findings(merged.get("review_findings"), fallback)
        merged["blocking_issues"] = self._blocking_issues_from_findings(merged.get("blocking_issues"), merged["review_findings"])
        if merged["blocking_issues"] and merged.get("merge_recommendation") == "Approve merge":
            merged["merge_recommendation"] = "Merge after changes"
            merged["recommendation_reason"] = "There are P1/P2 review findings; approve only after they are fixed or confirmed."
        return merged

    def _finding(
        self,
        severity: str,
        title: str,
        evidence: str,
        required_action: str,
        *,
        blocking: bool | None = None,
    ) -> dict[str, Any]:
        return {
            "severity": severity,
            "title": title,
            "evidence": evidence,
            "required_action": required_action,
            "blocking": severity in {"P1", "P2"} if blocking is None else blocking,
        }

    def _normalize_review_findings(self, items: Any, fallback: dict[str, Any]) -> list[dict[str, Any]]:
        source = items if isinstance(items, list) and items else fallback.get("review_findings") or []
        normalized: list[dict[str, Any]] = []
        for item in source:
            if not isinstance(item, dict):
                continue
            severity = str(item.get("severity") or "").strip().upper()
            if severity not in {"P1", "P2", "P3"}:
                severity = "P3"
            title = str(item.get("title") or item.get("summary") or item.get("message") or "").strip()
            evidence = str(item.get("evidence") or item.get("reason") or item.get("description") or "").strip()
            required_action = str(item.get("required_action") or item.get("action") or item.get("recommendation") or "").strip()
            if not title and not evidence:
                continue
            raw_blocking = item.get("blocking")
            blocking = severity in {"P1", "P2"} if raw_blocking is None else raw_blocking is True
            normalized.append(
                self._finding(
                    severity,
                    title or evidence[:80],
                    evidence or title,
                    required_action or "Please add a reviewable resolution note.",
                    blocking=blocking,
                )
            )
        return normalized or fallback.get("review_findings") or []

    def _blocking_issues_from_findings(self, blocking_issues: Any, review_findings: list[dict[str, Any]]) -> list[str]:
        rows = [str(item).strip() for item in blocking_issues or [] if str(item).strip()]
        for finding in review_findings:
            if finding.get("severity") in {"P1", "P2"} or finding.get("blocking"):
                action = str(finding.get("required_action") or "").strip()
                title = str(finding.get("title") or "").strip()
                message = f"{title}: {action}" if title and action else title or action
                if message:
                    rows.append(message)
        return list(dict.fromkeys(rows))

    def _choose_recommendation(
        self,
        input_data: dict[str, Any],
        files: list[dict[str, Any]],
        risk_points: list[str],
        blocking_issues: list[str],
        failed_ci: int,
    ) -> tuple[str, str]:
        state = str(input_data.get("state") or "").lower()
        text = f"{input_data.get('title', '')} {input_data.get('body', '')}".lower()
        if state == "closed" and not input_data.get("merged_at"):
            return "Reject", "The PR is closed without being merged; continuing the merge is not recommended."
        if any(token in text for token in ["do not merge", "wip", "draft", "blocked", "on hold", "don't merge"]):
            return "Hold", "The PR description contains a WIP/blocked/on-hold signal; wait for the author to update it."
        if failed_ci:
            return "Hold", "There are failed CI signals; confirm the root cause and restore the quality gate before merging."
        if not files:
            return "Hold", "No changed files provided; the real impact scope cannot be determined."
        if blocking_issues:
            return "Merge after changes", "There are fixable blockers; re-evaluate after tests or explanations are added."
        if risk_points and any(token in " ".join(risk_points) for token in ["Highly sensitive", "is large", "review comment"]):
            return "Merge after changes", "The PR has clear risk points; finish the focused review and verification before merging."
        return "Approve merge", "No obvious blockers found; merge after completing the final checklist confirmation."

    def _test_suggestions(self, filenames: list[str], risky_files: list[str], failed_ci: int) -> list[str]:
        suggestions = ["Run related unit and integration tests"]
        lowered = " ".join(filenames).lower()
        if any(token in lowered for token in ["frontend", ".tsx", ".ts", "next", "react"]):
            suggestions.append("Run frontend type checks/build and cover key page interactions")
        if any(token in lowered for token in ["backend", ".py", "api", "db"]):
            suggestions.append("Run backend pytest and cover API or database boundaries")
        if risky_files:
            suggestions.append("Add regression tests or a manual verification record for sensitive files")
        if failed_ci:
            suggestions.append("Fix the failed CI first, then re-run the full pipeline")
        return list(dict.fromkeys(suggestions))

    def _estimate_confidence(self, files: list[dict[str, Any]], context: dict[str, Any], failed_ci: int, blocking_issues: list[str]) -> float:
        score = 0.48
        if files:
            score += 0.12
        if context.get("code_references"):
            score += 0.08
        if context.get("project_documents"):
            score += 0.06
        if context.get("conversation_evidence"):
            score += 0.05
        if failed_ci:
            score += 0.04
        if blocking_issues:
            score += 0.04
        return round(max(0.38, min(0.88, score)), 2)
