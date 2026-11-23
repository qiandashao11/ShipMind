---
name: ci-debug
title: CI Debugging
version: 0.1.0
description: Diagnoses failed GitHub Actions workflow runs from job metadata and logs, and proposes likely causes and debugging steps.
category: github-analysis
entrypoint: ci_debug_agent.analyze_workflow_run
tools:
  - ci_debug_agent.analyze_workflow_run
  - workspace.search_code
  - workspace.read_file
  - rag.search_similar_documents
input_modes:
  - latest_failed_workflow_run
  - ci_context_from_chat
triggers:
  - ci
  - workflow
  - github actions
  - pipeline
  - build failed
  - test failed
  - tests failing
workflow_steps:
  - collect_failed_jobs_and_logs
  - classify_failure_type
  - identify_likely_root_causes
  - map_failure_to_code_or_config
  - produce_debug_steps
output_contract: CIDebugOutput
safety_level: read_only
---

# CI Debugging

Use this skill when the user asks why CI failed, which test or job broke, or how to debug a workflow failure.

## Workflow

1. Read the latest failed workflow run, its jobs, steps and available logs.
2. Classify the failure type first, then propose a fix direction.
3. Tie each likely cause to evidence in the logs or repository context; without log support, mark it as an inference and lower confidence.
4. Extract the first key error block first; do not let later cascading errors replace the root-cause entry point.
5. Return focused debugging steps and related files when available.

## Boundaries

This skill only diagnoses and drafts next steps. It cannot push commits, re-run workflows or edit repository files.
