import re
from typing import Any

from app.schemas.analysis import CIDebugOutput
from app.services.agents.base import BaseAgent
from app.services.llm.client import LLMClient
from app.services.llm.prompts import CI_DEBUG_PROMPT


class CIDebugAgent(BaseAgent):
    name = "ci_debug_agent"
    description = "Analyzes workflow failure logs and proposes debugging steps."
    available_tools = ["get_workflow_run", "get_workflow_logs", "extract_failed_log_sections"]

    def __init__(self, llm: LLMClient | None = None) -> None:
        self.llm = llm or LLMClient()

    async def run(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        fallback = self._fallback_debug(input_data, context)
        llm_output = await self.llm.chat_json(CI_DEBUG_PROMPT, {"workflow_run": input_data, "context": context})
        if llm_output:
            try:
                return CIDebugOutput.model_validate(self._merge_with_fallback(llm_output, fallback)).model_dump()
            except Exception:
                pass
        return fallback

    def _fallback_debug(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        logs = (input_data.get("logs_text") or "").lower()
        raw_logs = str(input_data.get("logs_text") or "")
        failed_jobs = [
            job
            for job in input_data.get("jobs", [])
            if isinstance(job, dict) and job.get("conclusion") == "failure"
        ]
        failed_steps = [
            step.get("name")
            for job in failed_jobs
            for step in job.get("steps", [])
            if isinstance(step, dict) and step.get("conclusion") == "failure" and step.get("name")
        ]
        failure_type = self._classify_failure(logs)
        first_error = self._extract_first_error(raw_logs)
        related_files = self._extract_related_files(raw_logs, context)
        failed_job_names = [str(job.get("name")) for job in failed_jobs if job.get("name")]
        job_hint = f"Failed jobs: {', '.join(failed_job_names[:3])}. " if failed_job_names else ""
        step_hint = f"Failed steps: {', '.join(failed_steps[:3])}. " if failed_steps else ""
        root_cause = self._infer_root_cause(failure_type, first_error, failed_job_names, failed_steps)
        fix_steps = self._fix_steps(failure_type, related_files)
        is_merge_blocking = self._is_merge_blocking(input_data, failure_type)
        blocking_reason = (
            "The current workflow run concluded with failure; it is a quality gate that must be restored before merging."
            if is_merge_blocking
            else "The current workflow run did not fail and does not block merging."
        )
        plan = [
            "Find the failed jobs and failed steps.",
            "Extract the first key error block.",
            "Classify the failure type: dependency, test, build, permission, environment variable or unknown.",
            "Search related code, test files and workflow configuration.",
            "Correlate with recent PRs or changed modules.",
            "Output the root cause, fix steps and whether the merge is blocked.",
        ]
        executed_steps = [
            f"Identified {len(failed_jobs)} failed jobs: {', '.join(failed_job_names[:3]) or 'no job details provided'}.",
            f"Identified {len(failed_steps)} failed steps: {', '.join(failed_steps[:3]) or 'no step details provided'}.",
            f"Extracted the first key error block: {first_error or 'no clear error block found in the logs'}.",
            f"Classified the failure type as {failure_type}, with {len(related_files)} related files.",
            f"Combined {len(context.get('recent_prs') or [])} recent PR signals and {len(context.get('code_references') or [])} code/config hints.",
            "Generated the root cause, fix steps and blocking assessment.",
        ]
        return CIDebugOutput(
            failure_summary=input_data.get("name", "CI run") + f" failed. {job_hint}{step_hint}Use the logs to locate the first error block.",
            failure_type=failure_type,
            plan=plan,
            executed_steps=executed_steps,
            first_error=first_error,
            root_cause=root_cause,
            possible_causes=self._possible_causes(failure_type),
            fix_steps=fix_steps,
            debug_steps=["Inspect the first error block of the failed job", "Reproduce the command locally", "Check files changed by recent PRs", "Re-run the failed job and the full workflow after fixing"],
            related_files=related_files,
            is_merge_blocking=is_merge_blocking,
            blocking_reason=blocking_reason,
            confidence=self._estimate_confidence(first_error, failed_jobs, related_files, context),
        ).model_dump()

    def _merge_with_fallback(self, output: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
        merged = {**fallback, **output}
        for key in ["plan", "executed_steps", "possible_causes", "fix_steps", "debug_steps", "related_files"]:
            if not merged.get(key):
                merged[key] = fallback[key]
        for key in ["failure_summary", "failure_type", "root_cause", "blocking_reason"]:
            if not str(merged.get(key) or "").strip():
                merged[key] = fallback[key]
        if merged.get("failure_type") == "unknown" and fallback.get("failure_type") != "unknown":
            merged["failure_type"] = fallback["failure_type"]
        if not merged.get("first_error"):
            merged["first_error"] = fallback["first_error"]
        return merged

    def _classify_failure(self, logs: str) -> str:
        ordered_rules = [
            ("permission", ["permission", "denied", "forbidden", "eacces", "access is denied"]),
            ("environment", ["missing env", "environment variable", "secret", "not set", "env var"]),
            ("dependency", ["npm err", "pip install", "dependency", "module not found", "no matching distribution", "cannot find module", "could not resolve"]),
            ("lint", ["eslint", "lint", "ruff", "flake8", "biome"]),
            ("build", ["build failed", "compilation", "webpack", "vite", "next build", "tsc", "type error", "build error"]),
            ("test", ["pytest", "assert", "test failed", "tests failed", "failed tests", "assertion", "jest"]),
        ]
        for failure_type, tokens in ordered_rules:
            if any(token in logs for token in tokens):
                return failure_type
        if "failed" in logs or "error" in logs:
            return "unknown"
        return "unknown"

    def _extract_first_error(self, logs: str) -> str | None:
        if not logs.strip():
            return None
        lines = [line.strip() for line in logs.splitlines() if line.strip()]
        for index, line in enumerate(lines):
            lowered = line.lower()
            if any(token in lowered for token in ["error", "failed", "failure", "exception", "traceback", "assertionerror", "npm err", "fatal"]):
                start = max(0, index - 2)
                end = min(len(lines), index + 5)
                return "\n".join(lines[start:end])[:900]
        return "\n".join(lines[:6])[:900]

    def _extract_related_files(self, logs: str, context: dict[str, Any]) -> list[str]:
        candidates = re.findall(r"[\w./\\-]+\.(?:py|ts|tsx|js|jsx|json|ya?ml|toml|ini|cfg|md)", logs)
        for item in context.get("code_references") or []:
            if isinstance(item, dict):
                title = str(item.get("title") or item.get("reference") or "").strip()
                if "." in title:
                    candidates.append(title)
        normalized = []
        for item in candidates:
            cleaned = item.strip("`'\"()[]{}:,;").replace("\\", "/")
            if cleaned and cleaned not in normalized:
                normalized.append(cleaned)
        return normalized[:8]

    def _infer_root_cause(self, failure_type: str, first_error: str | None, failed_job_names: list[str], failed_steps: list[str]) -> str:
        scope = ", ".join(filter(None, [", ".join(failed_job_names[:2]), ", ".join(failed_steps[:2])]))
        if failure_type == "test":
            return f"The failure is in the test execution stage{f' ({scope})' if scope else ''}; the first error points to an assertion, test case or mismatched behavior under test."
        if failure_type == "build":
            return f"The failure is in the build/type-check stage{f' ({scope})' if scope else ''}; the first error usually comes from compilation, typing or bundling configuration."
        if failure_type == "dependency":
            return "The logs show dependency installation or module resolution failed; check the lockfile, package versions and CI cache first."
        if failure_type == "permission":
            return "The logs show insufficient permissions or access denied; check the token, file permissions and workflow permissions first."
        if failure_type == "environment":
            return "The logs show a missing environment variable or secret; check the workflow env configuration and repository secrets first."
        if failure_type == "lint":
            return "The logs show lint/format checks failed; locate the rule violations in the affected files and run lint locally."
        return f"The logs lack a clear classification signal; the first error block is the most reliable starting point: {first_error[:160] if first_error else 'no logs provided'}"

    def _possible_causes(self, failure_type: str) -> list[str]:
        mapping = {
            "test": ["Test assertion mismatch", "A recent change altered API behavior", "Incomplete test data or environment setup"],
            "build": ["Type or compilation error", "Build configuration does not match the code change", "Missing generated artifact or path reference"],
            "lint": ["Formatting or static rule violation", "New code was not linted locally", "A config upgrade changed the rules"],
            "dependency": ["Dependency version changed", "Lockfile out of sync", "CI cache or registry misconfiguration"],
            "permission": ["Insufficient workflow permissions", "Insufficient token scope", "Script accessing a restricted directory"],
            "environment": ["Missing environment variable", "Secret not configured", "CI and local defaults differ"],
            "unknown": ["The first error block lacks detail", "An upstream command swallowed the real error", "The full job log needs to be inspected"],
        }
        return mapping[failure_type]

    def _fix_steps(self, failure_type: str, related_files: list[str]) -> list[str]:
        focus = f", focusing on {', '.join(related_files[:3])}" if related_files else ""
        mapping = {
            "test": [f"Run the failing test command locally and reproduce it{focus}", "Confirm the expected behavior against recent PR changes", "Fix the code or test data and add a regression test"],
            "build": [f"Run the build/type-check command locally{focus}", "Fix the first compilation or type error", "Confirm output paths, import paths and config files are updated together"],
            "lint": [f"Run the lint/format command locally{focus}", "Fix the first rule violation", "Adjust the rules if needed and document why"],
            "dependency": ["Reinstall dependencies and confirm the lockfile is updated", "Check that package/requirements versions match CI", "Clear the CI cache and re-run"],
            "permission": ["Check the workflow permissions configuration", "Confirm the scope of tokens/secrets", "Avoid writing to restricted directories or using restricted APIs in scripts"],
            "environment": ["Add the missing workflow env or repository secrets", "Provide consistent defaults for local and CI", "Avoid leaking secret values in logs"],
            "unknown": ["Expand the full job log", "Find the stderr of the earliest failing command", "Add diagnostic output to the workflow and re-run if needed"],
        }
        return mapping[failure_type]

    def _is_merge_blocking(self, input_data: dict[str, Any], failure_type: str) -> bool:
        conclusion = str(input_data.get("conclusion") or "").lower()
        status = str(input_data.get("status") or "").lower()
        return conclusion == "failure" or (status == "completed" and failure_type != "unknown")

    def _estimate_confidence(self, first_error: str | None, failed_jobs: list[dict[str, Any]], related_files: list[str], context: dict[str, Any]) -> float:
        score = 0.42
        if first_error:
            score += 0.16
        if failed_jobs:
            score += 0.12
        if related_files:
            score += 0.08
        if context.get("recent_prs"):
            score += 0.05
        if context.get("code_references"):
            score += 0.05
        return round(max(0.36, min(0.86, score)), 2)
