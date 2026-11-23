from __future__ import annotations

from typing import Any

from app.schemas.workflow import WorkflowFinding, WorkflowObservation, WorkflowSpec, WorkflowTaskResult
from app.services.agents.base import BaseAgent


class ObserverAgent(BaseAgent):
    name = "observer_agent"
    description = "Reviews workflow task outputs for conflicts, evidence gaps, low confidence and human-confirmation gates."
    available_tools = ["inspect_workflow_outputs"]

    async def run(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        spec = WorkflowSpec.model_validate(input_data["spec"])
        results = [WorkflowTaskResult.model_validate(item) for item in input_data.get("task_results") or []]
        findings: list[WorkflowFinding] = []

        findings.extend(self._status_findings(results))
        findings.extend(self._evidence_findings(results))
        findings.extend(self._confidence_findings(results))
        findings.extend(self._merge_gate_findings(results))
        findings.extend(self._ownership_findings(results, context))
        findings.extend(self._safety_findings(results, spec))

        confidence_values = [item.confidence for item in results if item.confidence is not None and item.status == "success"]
        base_confidence = sum(confidence_values) / len(confidence_values) if confidence_values else 0.55
        blocker_penalty = 0.2 * len([item for item in findings if item.severity == "blocker"])
        warning_penalty = 0.05 * len([item for item in findings if item.severity == "warning"])
        overall_confidence = round(max(0.1, min(0.95, base_confidence - blocker_penalty - warning_penalty)), 2)

        observation = WorkflowObservation(
            findings=findings,
            overall_confidence=overall_confidence,
            human_review_required=spec.requires_human_confirmation or any(item.severity == "blocker" for item in findings),
            summary=self._summary(findings, overall_confidence),
        )
        return observation.model_dump(mode="json")

    def _status_findings(self, results: list[WorkflowTaskResult]) -> list[WorkflowFinding]:
        findings = []
        for result in results:
            if result.status == "error":
                findings.append(
                    WorkflowFinding(
                        finding_type="task_error",
                        severity="blocker",
                        message=f"{result.agent_name} failed: {result.error or 'unknown error'}",
                        task_ids=[result.task_id],
                        recommendation="Fix the task failure or re-run with a narrower scope before trusting the synthesis.",
                    )
                )
            elif result.status == "skipped":
                findings.append(
                    WorkflowFinding(
                        finding_type="task_skipped",
                        severity="warning",
                        message=f"{result.agent_name} was skipped, so workflow coverage is incomplete.",
                        task_ids=[result.task_id],
                        recommendation="If this area affects the decision, connect or sync the missing repository signals first.",
                    )
                )
        return findings

    def _evidence_findings(self, results: list[WorkflowTaskResult]) -> list[WorkflowFinding]:
        findings = []
        for result in results:
            if result.status != "success" or result.task_type in {"repo_health", "safety_review"}:
                continue
            if result.evidence_count <= 0 and not result.citations:
                findings.append(
                    WorkflowFinding(
                        finding_type="evidence_gap",
                        severity="warning",
                        message=f"{result.agent_name} returned no clear evidence or citations.",
                        task_ids=[result.task_id],
                        recommendation="Before high-risk decisions, sync the related issues, PR files and CI logs, and search the current code live.",
                    )
                )
        return findings

    def _confidence_findings(self, results: list[WorkflowTaskResult]) -> list[WorkflowFinding]:
        findings = []
        for result in results:
            if result.status == "success" and result.confidence is not None and result.confidence < 0.5:
                findings.append(
                    WorkflowFinding(
                        finding_type="low_confidence",
                        severity="warning",
                        message=f"{result.agent_name} has low confidence ({result.confidence:.2f}).",
                        task_ids=[result.task_id],
                        recommendation="Add more context or inspect the underlying evidence before acting.",
                    )
                )
        return findings

    def _merge_gate_findings(self, results: list[WorkflowTaskResult]) -> list[WorkflowFinding]:
        findings = []
        pr_result = self._by_type(results, "pr_review")
        ci_result = self._by_type(results, "ci_debug")
        if ci_result and bool(ci_result.output.get("is_merge_blocking")):
            findings.append(
                WorkflowFinding(
                    finding_type="ci_merge_gate",
                    severity="blocker",
                    message="The CI Agent marked the latest failed workflow as blocking the merge.",
                    task_ids=[ci_result.task_id],
                    recommendation="Fix or explain the CI failure before approving a merge or release.",
                )
            )
        if pr_result and pr_result.output.get("blocking_issues"):
            findings.append(
                WorkflowFinding(
                    finding_type="pr_blocking_issues",
                    severity="blocker",
                    message="The PR review found blocking issues.",
                    task_ids=[pr_result.task_id],
                    recommendation="Resolve the PR blockers and re-run the workflow.",
                )
            )
        if pr_result and ci_result and bool(ci_result.output.get("is_merge_blocking")):
            if self._looks_like_merge_approval(str(pr_result.output.get("merge_recommendation") or "")):
                findings.append(
                    WorkflowFinding(
                        finding_type="cross_agent_conflict",
                        severity="blocker",
                        message="The PR Agent leans toward merging, but the CI Agent reported a merge-blocking failure.",
                        task_ids=[pr_result.task_id, ci_result.task_id],
                        recommendation="Let the CI gate take precedence over the PR merge recommendation until the failure is resolved.",
                    )
                )
        return findings

    def _ownership_findings(self, results: list[WorkflowTaskResult], context: dict[str, Any]) -> list[WorkflowFinding]:
        issue_result = self._by_type(results, "issue_analysis")
        if not issue_result:
            return []
        owner = str(issue_result.output.get("suggested_owner") or "").strip().lower()
        if not owner:
            return []
        team_members = context.get("team_members") or []
        known_names = {
            str(member.get("name") or "").strip().lower()
            for member in team_members
            if isinstance(member, dict) and str(member.get("name") or "").strip()
        }
        unassigned_markers = {"unassigned", "Unassigned"}
        if owner in unassigned_markers or (known_names and owner not in known_names):
            return [
                WorkflowFinding(
                    finding_type="owner_needs_review",
                    severity="warning",
                    message="The suggested issue owner is empty or not among the configured team members.",
                    task_ids=[issue_result.task_id],
                    recommendation="Update team member profiles before relying on automatic owner assignment.",
                )
            ]
        if not known_names:
            return [
                WorkflowFinding(
                    finding_type="team_profile_missing",
                    severity="warning",
                    message="No ShipMind team members are configured for owner routing yet.",
                    task_ids=[issue_result.task_id],
                    recommendation="Add team member profiles so owner recommendations are more explainable.",
                )
            ]
        return []

    def _safety_findings(self, results: list[WorkflowTaskResult], spec: WorkflowSpec) -> list[WorkflowFinding]:
        safety_result = self._by_type(results, "safety_review")
        if not safety_result and spec.requires_human_confirmation:
            return [
                WorkflowFinding(
                    finding_type="missing_safety_review",
                    severity="blocker",
                    message="The workflow requires human confirmation, but no SafetyAgent task was run.",
                    recommendation="Run the SafetyAgent before drafting comments, labels, creating/closing issues or sending anything externally.",
                )
            ]
        if safety_result and safety_result.output.get("requires_confirmation"):
            return [
                WorkflowFinding(
                    finding_type="human_confirmation_required",
                    severity="blocker",
                    message="The SafetyAgent requires the user to confirm this write action manually.",
                    task_ids=[safety_result.task_id],
                    recommendation="Return drafts only; do not execute external actions in MVP mode.",
                )
            ]
        return []

    def _by_type(self, results: list[WorkflowTaskResult], task_type: str) -> WorkflowTaskResult | None:
        return next((item for item in results if item.task_type == task_type and item.status == "success"), None)

    def _looks_like_merge_approval(self, value: str) -> bool:
        lowered = value.lower()
        return any(token in lowered for token in ["approve", "merge", "approve merge", "ready to merge"]) and not any(
            token in lowered for token in ["after", "blocked", "hold", "once fixed", "with changes"]
        )

    def _summary(self, findings: list[WorkflowFinding], confidence: float) -> str:
        blockers = len([item for item in findings if item.severity == "blocker"])
        warnings = len([item for item in findings if item.severity == "warning"])
        if blockers:
            return f"Observer found {blockers} blockers and {warnings} warnings; confidence {confidence:.2f}."
        if warnings:
            return f"Observer found {warnings} warnings; confidence {confidence:.2f}."
        return f"Observer found no cross-agent blockers; confidence {confidence:.2f}."
