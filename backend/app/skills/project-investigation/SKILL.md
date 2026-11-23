---
name: project-investigation
title: Project Investigation
version: 0.1.0
description: Combines the current workspace, project RAG and conversation memory to answer questions about implementation and past decisions.
category: project-analysis
entrypoint: shipmind_search_evidence
tools:
  - workspace.list_files
  - workspace.search_code
  - workspace.read_file
  - rag.search_similar_documents
  - shipmind_search_evidence
  - shipmind_get_thread_context
  - shipmind_read_session_events
input_modes:
  - current_implementation
  - historical_decision
  - conversation_recall
triggers:
  - current implementation
  - source code
  - where is the code
  - historical reason
  - past decision
  - historical evidence
  - discussed before
  - project evidence
  - project memory
  - exact words
  - archived session
workflow_steps:
  - identify_current_or_historical_question
  - search_current_workspace_for_current_code
  - search_project_evidence_for_history
  - read_exact_file_or_session_when_needed
  - answer_with_citations_and_uncertainty
output_contract: evidence_answer
safety_level: read_only
---

# Project Investigation

Use this skill when the user asks about the current implementation, historical reasons or earlier discussions together.

## Workflow

1. First decide whether the question is about current source code, project history or the current conversation.
2. For current source code use `workspace.search_code`, then read the surrounding context with `workspace.read_file`.
3. For historical issues, PRs, CI, project knowledge and approved memory use `shipmind_search_evidence`.
4. When the user asks about the raw conversation use `shipmind_get_thread_context`; for archived summaries use `shipmind_read_session_events`.
5. In the answer, separate evidence, inference and unknowns, and keep verifiable citations.

## Boundaries

This skill is read-only. It cannot modify source code, write to GitHub, approve candidate memories or perform external actions on the user's behalf.
