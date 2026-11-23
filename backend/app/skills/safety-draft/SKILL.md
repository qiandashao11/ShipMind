---
name: safety-draft
title: Safety Draft
version: 0.1.0
description: Detects risky external sends or GitHub write actions and produces drafts for human confirmation instead of writing directly.
category: safety
entrypoint: safety_agent.classify_action_risk
tools:
  - safety_agent.classify_action_risk
  - shipmind_search_evidence
input_modes:
  - write_intent_from_chat
  - external_send_intent
triggers:
  - comment
  - reply
  - add label
  - label
  - close issue
  - create issue
  - send report
  - send externally
  - write back
workflow_steps:
  - detect_write_or_send_intent
  - classify_action_risk
  - draft_human_reviewable_output
  - require_confirmation
output_contract: SafetyDraft
safety_level: guarded_write_draft
---

# Safety Draft

Use this skill when the user asks to comment, reply, label, close an issue, create an issue, send a report or perform any write action outside the conversation.

## Workflow

1. Detect the external write or send intent.
2. Assess the action risk and identify sensitive context.
3. Produce a draft that a human can review.
4. Explain why human confirmation is required, and which tool or manual action should complete the next step after confirmation.
5. Stop before executing any external action.

## Boundaries

In MVP mode this skill never performs write actions; it only returns drafts and confirmation requirements.
