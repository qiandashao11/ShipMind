from __future__ import annotations

from typing import Any

from app.schemas.workflow import WorkflowObservation, WorkflowSpec, WorkflowTaskResult
from app.services.agents.base import BaseAgent


class SynthesisAgent(BaseAgent):
    name = "synthesis_agent"
    description = "Synthesizes a multi-agent workflow into an engineering decision memo."
    available_tools = ["synthesize_workflow_report"]

    async def run(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        spec = WorkflowSpec.model_validate(input_data["spec"])
        results = [WorkflowTaskResult.model_validate(item) for item in input_data.get("task_results") or []]
        observation = WorkflowObservation.model_validate(input_data["observation"])
        answer = self._build_answer(spec, results, observation)
        return {"answer": answer}

    def _build_answer(self, spec: WorkflowSpec, results: list[WorkflowTaskResult], observation: WorkflowObservation) -> str:
        blockers = [item for item in observation.findings if item.severity == "blocker"]
        warnings = [item for item in observation.findings if item.severity == "warning"]
        decision = self._decision(blockers, warnings, results)

        lines = [
            "## Multi-agent collaboration conclusion",
            "",
            f"Goal: {spec.goal}",
            f"Overall judgment: {decision}",
            f"Observer confidence: {observation.overall_confidence:.2f}",
            "",
            "## Collaboration task graph",
        ]
        for task in spec.tasks:
            deps = f", depends on: {', '.join(task.dependencies)}" if task.dependencies else ""
            lines.append(f"- {task.id}: {task.agent_name} handles {task.objective}{deps}")

        lines.extend(["", "## Agent output summary"])
        for result in results:
            lines.append(f"- {result.agent_name} [{result.status}]: {result.summary or 'No summary.'}")

        lines.extend(["", "## Observer checks"])
        if observation.findings:
            for finding in observation.findings:
                lines.append(f"- {finding.severity.upper()}: {finding.message} Recommendation: {finding.recommendation}")
        else:
            lines.append("- No cross-agent conflicts found.")

        lines.extend(["", "## Decision basis and open items"])
        lines.extend(f"- {item}" for item in self._decision_basis(results, observation))

        next_steps = self._next_steps(blockers, warnings, results)
        lines.extend(["", "## Next steps"])
        lines.extend(f"- {item}" for item in next_steps)
        return "\n".join(lines).strip()

    def _decision(
        self,
        blockers: list[Any],
        warnings: list[Any],
        results: list[WorkflowTaskResult],
    ) -> str:
        if blockers:
            if any(item.finding_type in {"ci_merge_gate", "cross_agent_conflict"} for item in blockers):
                return "Hold merge or release; resolve CI/cross-agent conflicts first."
            if any(item.finding_type == "human_confirmation_required" for item in blockers):
                return "Produce drafts only; wait for human confirmation before executing external writes."
            return "There are blockers; pushing forward directly is not recommended."
        pr_result = self._by_type(results, "pr_review")
        if pr_result and pr_result.output.get("merge_recommendation"):
            return f"Proceed per the PR Agent's recommendation: {pr_result.output.get('merge_recommendation')}."
        if warnings:
            return "OK to proceed, but fill in the evidence or team information flagged by the Observer."
        return "OK to proceed; no obvious cross-domain blockers found."

    def _next_steps(
        self,
        blockers: list[Any],
        warnings: list[Any],
        results: list[WorkflowTaskResult],
    ) -> list[str]:
        steps: list[str] = []
        ci_result = self._by_type(results, "ci_debug")
        pr_result = self._by_type(results, "pr_review")
        issue_result = self._by_type(results, "issue_analysis")

        if ci_result and ci_result.output.get("is_merge_blocking"):
            debug_steps = [str(item) for item in ci_result.output.get("debug_steps") or [] if str(item).strip()]
            steps.extend(debug_steps[:3] or ["Locate and fix the latest failed CI first."])
        if pr_result:
            blocking = [str(item) for item in pr_result.output.get("blocking_issues") or [] if str(item).strip()]
            tests = [str(item) for item in pr_result.output.get("test_suggestions") or [] if str(item).strip()]
            steps.extend(blocking[:2])
            steps.extend(tests[:2])
        if issue_result:
            actions = [str(item) for item in issue_result.output.get("checklist") or issue_result.output.get("action_items") or [] if str(item).strip()]
            steps.extend(actions[:2])
        for finding in [*blockers, *warnings]:
            if finding.recommendation:
                steps.append(str(finding.recommendation))
        if not steps:
            steps.append("Post this workflow's conclusion back to the PR/issue description or the team sync.")
        return list(dict.fromkeys(steps))[:6]

    def _decision_basis(self, results: list[WorkflowTaskResult], observation: WorkflowObservation) -> list[str]:
        basis: list[str] = []
        for result in results:
            confidence = f", confidence {result.confidence:.2f}" if result.confidence is not None else ""
            evidence = f", {result.evidence_count} pieces of evidence" if result.evidence_count else ""
            basis.append(f"{result.agent_name}: {result.summary or 'no summary'}{evidence}{confidence}.")
        if observation.findings:
            for finding in observation.findings:
                basis.append(f"Open item: {finding.message} Suggested handling: {finding.recommendation}")
        else:
            basis.append("Open item: the final merge, comments or external sends still need human confirmation per the team process.")
        return basis[:8]

    def _by_type(self, results: list[WorkflowTaskResult], task_type: str) -> WorkflowTaskResult | None:
        return next((item for item in results if item.task_type == task_type and item.status == "success"), None)
