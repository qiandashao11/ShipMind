---
name: pr-review
title: PR Review
version: 0.1.0
description: Reviews a synced pull request and outputs a summary, key changes, P1/P2/P3 graded findings, blockers, test gaps and files that need attention.
category: github-analysis
entrypoint: pr_review_agent.analyze_pr
tools:
  - pr_review_agent.analyze_pr
  - workspace.read_file
  - workspace.search_code
  - rag.search_similar_documents
input_modes:
  - latest_synced_pr
  - pr_context_from_chat
triggers:
  - pr
  - pull request
  - merge request
  - code review
  - review
  - ready to merge
workflow_steps:
  - collect_pr_diff_and_comments
  - summarize_key_changes
  - classify_findings_by_p1_p2_p3
  - identify_risky_files
  - propose_tests
  - produce_merge_readiness_notes
output_contract: PRReviewOutput
safety_level: read_only
---

# PR Review

Use this skill when the user asks whether a PR is ready to merge, what it changes, what its risks are or which tests it still needs.

Before reviewing, read `references/risk-checklist.md` as needed and pick the checks that match the actual change surface; do not manufacture risks mechanically when there is no supporting evidence.

## Workflow

1. Collect the PR title, body, changed files, patches and review comments.
2. Summarize the implementation changes in language maintainers can grasp quickly.
3. Output `review_findings` graded P1/P2/P3; each must have evidence, a required action and whether it blocks.
4. P1/P2 must go into `blocking_issues`, and the recommendation must not be "Approve merge".
5. Flag risk points and files that need close attention.
6. Give test suggestions that match the change surface.

## Severity levels

- P1: causes functional bugs, security issues, data risk or blocking CI failures; must be fixed before approval.
- P2: insufficient test coverage, important missed edge cases, unaddressed review comments, sensitive files without verification; verification must be completed before approval.
- P3: style, naming, maintainability suggestions or non-blocking improvements; may go to the backlog.

Never substitute "looks good" or "no big problems" for a review verdict. Even without P1/P2, state the basis, the remaining P3 suggestions and the final human-confirmation checklist.

## Boundaries

This skill only produces review suggestions. It cannot approve, request changes, merge or comment on GitHub.
