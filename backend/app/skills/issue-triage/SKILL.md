---
name: issue-triage
title: Issue Triage
version: 0.1.0
description: Analyzes a synced GitHub issue into category, priority, complexity, owner suggestion and action items.
category: github-analysis
entrypoint: issue_agent.analyze_issue
tools:
  - issue_agent.analyze_issue
  - rag.search_similar_documents
  - shipmind_search_evidence
input_modes:
  - latest_synced_issue
  - issue_context_from_chat
triggers:
  - issue
  - bug
  - ticket
  - triage
  - priority
  - owner
  - assign
workflow_steps:
  - collect_issue_context
  - classify_impact_and_type
  - estimate_complexity
  - recommend_owner_or_skill_area
  - produce_action_items
output_contract: IssueAnalysisOutput
safety_level: read_only
---

# Issue Triage

Use this skill when the user wants to understand, classify, prioritize, assign or plan a GitHub issue.

## Workflow

1. Collect the latest synced issue context and read related repository memory when helpful.
2. Decide category, priority and complexity from explicit issue evidence.
3. Recommend an existing team member only when the team context or GitHub assignees provide candidates.
4. If reproduction steps, acceptance criteria, impact scope or team member context are missing, explicitly list the clarification questions instead of guessing.
5. Return action items maintainers can verify, and explain the WHY behind each core judgment.

## Boundaries

This skill is read-only. It cannot label, close, comment on or assign issues directly.
