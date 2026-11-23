from __future__ import annotations

from typing import Any

from app.schemas.workflow import WorkflowClaim, WorkflowObservation, WorkflowSpec, WorkflowTask, WorkflowTaskResult
from app.services.agents.base import BaseAgent


class PlannerAgent(BaseAgent):
    name = "planner_agent"
    description = "Builds a bounded engineering workflow spec from the user's goal and available repository signals."
    available_tools = ["create_workflow_spec"]

    async def run(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        message = str(input_data.get("message") or input_data.get("goal") or "").strip()
        lowered = message.lower()
        tasks: list[WorkflowTask] = []
        issue_label = f"Issue #{context['issue_number']}" if context.get("issue_number") is not None else "the current issue"
        pr_label = f"PR #{context['pr_number']}" if context.get("pr_number") is not None else "the current PR"
        ci_label = (
            f"CI/Workflow Run #{context['workflow_run_number']}"
            if context.get("workflow_run_number") is not None
            else "the latest failed CI run"
        )
        has_ci_run = context.get("has_ci_run", context.get("has_failed_ci"))

        if context.get("has_repo", True):
            tasks.append(
                WorkflowTask(
                    id="repo_health",
                    agent_name="repo_health_agent",
                    task_type="repo_health",
                    objective="Capture a repository baseline before specialist analysis.",
                    claim=WorkflowClaim(
                        target_type="repository",
                        target_id=context.get("repo_id"),
                        allowed_sources=["issues", "pull_requests", "workflow_runs"],
                        reason="A shared repository snapshot lets later agent conclusions rest on evidence.",
                    ),
                )
            )

        broad = self._is_broad_engineering_question(lowered)
        if context.get("has_issue") and (broad or self._mentions_issue(lowered)):
            tasks.append(
                WorkflowTask(
                    id="issue_analysis",
                    agent_name="issue_analyst_agent",
                    task_type="issue_analysis",
                    objective=f"Analyze the triage conclusion, priority, owner, evidence and next actions of {issue_label}.",
                    dependencies=["repo_health"] if self._has_task(tasks, "repo_health") else [],
                    claim=WorkflowClaim(
                        target_type="issue",
                        target_id=context.get("issue_id"),
                        allowed_sources=["issue", "similar_issues", "code", "documents", "team_members"],
                        reason="Deciding the owner and priority requires a clear issue scope.",
                    ),
                    input_hint={"issue_number": context.get("issue_number")},
                )
            )

        if context.get("has_pr") and (broad or self._mentions_pr(lowered)):
            tasks.append(
                WorkflowTask(
                    id="pr_review",
                    agent_name="pr_review_agent",
                    task_type="pr_review",
                    objective=f"Review the diff, risks, blockers and test suggestions of {pr_label}.",
                    dependencies=["repo_health"] if self._has_task(tasks, "repo_health") else [],
                    claim=WorkflowClaim(
                        target_type="pull_request",
                        target_id=context.get("pr_id"),
                        allowed_sources=["pull_request", "diff", "review_comments", "ci_summary", "documents"],
                        reason="Merge-readiness and risk judgments require a clear PR scope.",
                    ),
                    input_hint={"pr_number": context.get("pr_number")},
                    critical=self._mentions_merge(lowered),
                )
            )

        if has_ci_run and (broad or self._mentions_ci(lowered) or self._mentions_merge(lowered)):
            tasks.append(
                WorkflowTask(
                    id="ci_debug",
                    agent_name="ci_debug_agent",
                    task_type="ci_debug",
                    objective=f"Analyze {ci_label} and decide whether it blocks merging or release.",
                    dependencies=["repo_health"] if self._has_task(tasks, "repo_health") else [],
                    claim=WorkflowClaim(
                        target_type="workflow_run",
                        target_id=context.get("workflow_run_id"),
                        allowed_sources=["workflow_run", "jobs", "logs", "recent_prs", "code"],
                        reason="Any merge or readiness conclusion must first look at the CI failure context.",
                    ),
                    input_hint={"workflow_run_number": context.get("workflow_run_number")},
                    critical=True,
                )
            )

        if context.get("enable_rag_task") or self._mentions_history(lowered):
            tasks.append(
                WorkflowTask(
                    id="rag_search",
                    agent_name="rag_context_agent",
                    task_type="rag_search",
                    objective="Retrieve historical issues, PRs, failed CI logs, project docs and approved knowledge related to the goal.",
                    dependencies=["repo_health"] if self._has_task(tasks, "repo_health") else [],
                    claim=WorkflowClaim(
                        target_type="knowledge",
                        target_id=context.get("repo_id"),
                        allowed_sources=["rag_documents", "approved_memory", "uploaded_knowledge"],
                        reason="Historical evidence avoids duplicate analysis and missed regression risks.",
                    ),
                )
            )

        if context.get("requires_safety"):
            tasks.append(
                WorkflowTask(
                    id="safety_review",
                    agent_name="safety_agent",
                    task_type="safety_review",
                    objective="Assess write or external-send risk and produce safety drafts instead of executing side effects.",
                    claim=WorkflowClaim(
                        target_type="external_action",
                        target_id=context.get("repo_id"),
                        allowed_sources=["user_request", "repository_snapshot"],
                        write_intent=True,
                        reason="Write actions must go through human confirmation.",
                    ),
                    critical=True,
                )
            )

        if len(tasks) == 1 and tasks[0].task_type == "repo_health":
            if context.get("has_pr"):
                tasks.append(self._fallback_pr_task(context))
            elif has_ci_run:
                tasks.append(self._fallback_ci_task(context))
            elif context.get("has_issue"):
                tasks.append(self._fallback_issue_task(context))

        spec = WorkflowSpec(
            goal=message or "Run an engineering collaboration workflow.",
            trigger_message=message,
            acceptance_criteria=[
                "Every selected agent must stay within its declared claim scope.",
                "Every specialist result should include evidence and confidence, or a clear reason when evidence is insufficient.",
                "The Observer must flag cross-agent conflicts before the final synthesis.",
                "The final synthesis must preserve What, Why, Tradeoff, Open Questions, Next Action.",
                "PR reviews must be graded P1/P2/P3; a direct merge must not be recommended while P1/P2 remain unresolved.",
                "External write actions must return drafts and require human confirmation.",
            ],
            tasks=tasks,
            requires_human_confirmation=bool(context.get("requires_safety")),
        )
        return spec.model_dump(mode="json")

    async def replan(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        previous_spec = WorkflowSpec.model_validate(input_data["spec"])
        results = [WorkflowTaskResult.model_validate(item) for item in input_data.get("task_results") or []]
        observation = WorkflowObservation.model_validate(input_data["observation"])
        tasks = [task.model_copy(deep=True) for task in previous_spec.tasks]
        task_types = {task.task_type for task in tasks}
        successful_task_ids = {result.task_id for result in results if result.status == "success"}
        finding_types = {finding.finding_type for finding in observation.findings}

        if "missing_safety_review" in finding_types and "safety_review" not in task_types:
            tasks.append(
                WorkflowTask(
                    id=self._unique_task_id(tasks, "safety_review"),
                    agent_name="safety_agent",
                    task_type="safety_review",
                    objective="Review write or external-send risk before producing a final recommendation.",
                    dependencies=self._dependency_if_successful(successful_task_ids, "repo_health"),
                    claim=WorkflowClaim(
                        target_type="external_action",
                        target_id=context.get("repo_id"),
                        allowed_sources=["user_request", "repository_snapshot"],
                        write_intent=True,
                        reason="Replan added a missing safety gate after Observer flagged it.",
                    ),
                    critical=True,
                )
            )

        needs_context_recovery = bool(
            finding_types
            & {
                "task_error",
                "task_skipped",
                "evidence_gap",
                "low_confidence",
                "owner_needs_review",
                "team_profile_missing",
            }
        )
        if needs_context_recovery and "rag_search" not in task_types:
            tasks.append(
                WorkflowTask(
                    id=self._unique_task_id(tasks, "rag_search"),
                    agent_name="rag_context_agent",
                    task_type="rag_search",
                    objective="Recover missing evidence by searching historical issues, pull requests, failed CI logs, project documents, and approved knowledge.",
                    dependencies=self._dependency_if_successful(successful_task_ids, "repo_health"),
                    claim=WorkflowClaim(
                        target_type="knowledge",
                        target_id=context.get("repo_id"),
                        allowed_sources=["rag_documents", "approved_memory", "uploaded_knowledge"],
                        reason="Replan added historical context because Observer found weak evidence or confidence.",
                    ),
                )
            )

        if context.get("has_ci_run", context.get("has_failed_ci")) and "ci_debug" not in task_types and self._replan_needs_ci(previous_spec, results, observation):
            tasks.append(
                WorkflowTask(
                    id=self._unique_task_id(tasks, "ci_debug"),
                    agent_name="ci_debug_agent",
                    task_type="ci_debug",
                    objective="Check the latest failed CI run before final merge or release guidance.",
                    dependencies=self._dependency_if_successful(successful_task_ids, "repo_health"),
                    claim=WorkflowClaim(
                        target_type="workflow_run",
                        target_id=context.get("workflow_run_id"),
                        allowed_sources=["workflow_run", "jobs", "logs", "recent_prs", "code"],
                        reason="Replan added CI debugging because the current decision may depend on failed automation.",
                    ),
                    input_hint={"workflow_run_number": context.get("workflow_run_number")},
                    critical=True,
                )
            )

        replanned = previous_spec.model_copy(deep=True)
        replanned.tasks = tasks
        return replanned.model_dump(mode="json")

    def _fallback_issue_task(self, context: dict[str, Any]) -> WorkflowTask:
        label = f"Issue #{context['issue_number']}" if context.get("issue_number") is not None else "the latest issue"
        return WorkflowTask(
            id="issue_analysis",
            agent_name="issue_analyst_agent",
            task_type="issue_analysis",
            objective=f"Analyze {label} because it is the strongest engineering signal currently available.",
            dependencies=["repo_health"],
            claim=WorkflowClaim(target_type="issue", target_id=context.get("issue_id"), allowed_sources=["issue", "team_members"]),
            input_hint={"issue_number": context.get("issue_number")},
        )

    def _fallback_pr_task(self, context: dict[str, Any]) -> WorkflowTask:
        label = f"PR #{context['pr_number']}" if context.get("pr_number") is not None else "the latest PR"
        return WorkflowTask(
            id="pr_review",
            agent_name="pr_review_agent",
            task_type="pr_review",
            objective=f"Review {label} because it is the strongest engineering signal currently available.",
            dependencies=["repo_health"],
            claim=WorkflowClaim(target_type="pull_request", target_id=context.get("pr_id"), allowed_sources=["pull_request", "diff", "ci_summary"]),
            input_hint={"pr_number": context.get("pr_number")},
        )

    def _fallback_ci_task(self, context: dict[str, Any]) -> WorkflowTask:
        label = (
            f"CI/Workflow Run #{context['workflow_run_number']}"
            if context.get("workflow_run_number") is not None
            else "the latest failed CI run"
        )
        return WorkflowTask(
            id="ci_debug",
            agent_name="ci_debug_agent",
            task_type="ci_debug",
            objective=f"Analyze {label} because it is the strongest engineering signal currently available.",
            dependencies=["repo_health"],
            claim=WorkflowClaim(target_type="workflow_run", target_id=context.get("workflow_run_id"), allowed_sources=["workflow_run", "jobs", "logs"]),
            input_hint={"workflow_run_number": context.get("workflow_run_number")},
            critical=True,
        )

    def _has_task(self, tasks: list[WorkflowTask], task_id: str) -> bool:
        return any(task.id == task_id for task in tasks)

    def _unique_task_id(self, tasks: list[WorkflowTask], base: str) -> str:
        existing = {task.id for task in tasks}
        if base not in existing:
            return base
        index = 2
        while f"{base}_{index}" in existing:
            index += 1
        return f"{base}_{index}"

    def _dependency_if_successful(self, successful_task_ids: set[str], task_id: str) -> list[str]:
        return [task_id] if task_id in successful_task_ids else []

    def _replan_needs_ci(
        self,
        spec: WorkflowSpec,
        results: list[WorkflowTaskResult],
        observation: WorkflowObservation,
    ) -> bool:
        text = " ".join(
            [
                spec.goal,
                spec.trigger_message,
                *(result.summary for result in results),
                *(finding.message for finding in observation.findings),
            ]
        ).lower()
        return self._mentions_ci(text) or self._mentions_merge(text)

    def _mentions_issue(self, text: str) -> bool:
        return any(token in text for token in ["issue", "bug", "requirement", "problem", "owner", "assign", "priority"])

    def _mentions_pr(self, text: str) -> bool:
        return any(token in text for token in ["pr", "pull request", "diff", "review", "merge", "code review", "risk"])

    def _mentions_ci(self, text: str) -> bool:
        return any(token in text for token in ["ci", "workflow", "action", "build", "test", "fail", "pipeline"])

    def _mentions_merge(self, text: str) -> bool:
        return any(token in text for token in ["merge", "ship", "can we release", "ready to deploy", "readiness", "release"])

    def _mentions_history(self, text: str) -> bool:
        return any(token in text for token in ["history", "similar", "rag", "knowledge", "past", "knowledge base", "memory"])

    def _is_broad_engineering_question(self, text: str) -> bool:
        return any(
            token in text
            for token in [
                "multi-agent",
                "workflow",
                "collaborat",
                "engineering status",
                "blocker",
                "risk",
                "prioritize",
                "next step",
                "overall",
                "big picture",
                "current repo",
                "can we merge",
            ]
        )
