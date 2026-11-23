from typing import Any

from app.services.agents.base import BaseAgent


class ReportAgent(BaseAgent):
    name = "report_agent"
    description = "Generates an engineering weekly report from repository activity."
    available_tools = ["list_issues_by_time_range", "list_prs_by_time_range", "list_failed_workflow_runs"]

    async def run(self, input_data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        issues = input_data.get("issues", [])
        prs = input_data.get("pull_requests", [])
        ci_runs = input_data.get("workflow_runs", [])
        metrics = input_data.get("metrics", {})
        failed_ci = [run for run in ci_runs if run.get("conclusion") == "failure"]
        merged_prs = [pr for pr in prs if pr.get("merged_at")]
        open_prs = [pr for pr in prs if pr.get("state") == "open"]
        closed_issues = [issue for issue in issues if issue.get("state") == "closed"]
        repo_name = context.get("repo_name") or f"Repo {context.get('repo_id', '')}".strip()
        date_range = f"{context.get('start_date', '')} to {context.get('end_date', '')}".strip()
        merged_pr_numbers = ", ".join(f"#{pr.get('number')}" for pr in merged_prs[:8]) or "none"
        closed_issue_numbers = ", ".join(f"#{issue.get('number')}" for issue in closed_issues[:8]) or "none"
        markdown = (
            f"# {repo_name} Engineering Weekly Report\n\n"
            f"> Date range: {date_range}\n\n"
            "## Overview\n"
            f"- Issues: {metrics.get('issues', len(issues))}\n"
            f"- PRs: {metrics.get('pull_requests', len(prs))}, of which {metrics.get('merged_prs', len(merged_prs))} merged and {metrics.get('open_prs', len(open_prs))} open\n"
            f"- Failed CI runs: {metrics.get('failed_ci', len(failed_ci))}\n\n"
            "## Completed this week\n"
            f"- Merged {len(merged_prs)} PRs: {merged_pr_numbers}.\n"
            f"- Closed {len(closed_issues)} issues: {closed_issue_numbers}.\n\n"
            "## In progress\n"
            f"- {len(open_prs)} open PRs still need follow-up.\n"
            + "\n".join(f"- #{pr.get('number')} {pr.get('title')}" for pr in open_prs[:5])
            + ("\n" if open_prs else "- No open PRs.\n")
            + "\n"
            "## Risks and blockers\n"
            f"- {len(failed_ci)} failed CI runs; prioritize workflows that fail repeatedly.\n"
            + ("- No failed CI runs were synced in this period.\n" if not failed_ci else "")
            + "\n"
            "## PRs that need attention\n"
            + "\n".join(f"- #{pr.get('number')} {pr.get('title')}" for pr in prs[:5])
            + "\n\n## Failed CI\n"
            + "\n".join(f"- {run.get('name')}: {run.get('conclusion')}" for run in failed_ci[:5])
            + "\n\n## Suggestions for next week\n"
            "- Add test coverage for key modules.\n- Split reviews of high-risk PRs early.\n"
        )
        return {"report_markdown": markdown}
