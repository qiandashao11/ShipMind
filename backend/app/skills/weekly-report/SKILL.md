---
name: weekly-report
title: Weekly Report
version: 0.1.0
description: Generates an engineering weekly report for a repository from issues, pull requests, CI runs and trend context in a given range.
category: reporting
entrypoint: report_agent.generate_weekly_report
tools:
  - report_agent.generate_weekly_report
input_modes:
  - repository_activity_window
  - report_request_from_chat
triggers:
  - weekly report
  - engineering summary
  - activity summary
  - project health
  - repository report
  - repo report
workflow_steps:
  - collect_activity_window
  - summarize_issue_and_pr_flow
  - summarize_ci_health
  - identify_risks_and_next_actions
  - persist_report_to_archive
output_contract: WeeklyReportResponse
safety_level: read_only
---

# Weekly Report

Use this skill when the user asks for a weekly report, engineering summary, activity summary or project health overview.

## Workflow

1. Limit issues, pull requests and workflow runs to the time window the user requested.
2. Summarize completed work, open risks and CI health.
3. Produce a Markdown report suitable for a team sync.
4. Persist the report to the project archive, but do not use derived reports as a source of truth for RAG.

## Boundaries

This skill only reads structured facts within the given time window and produces an internal report; sending a report externally must go through the safety skill first.
