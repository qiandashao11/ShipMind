# Agent Workflow

When a user message reaches `/api/chat`:

1. `ChatAgent` uses native tool calling to choose the next tool.
2. Workspace tools can list files, read files and search local code.
3. Memory tools retrieve conversation history within the current scope. RAG retrieves reusable unstructured evidence such as issue descriptions, PR discussions, failed CI logs, project docs, user-uploaded knowledge and approved memory notes. Workspace tools and structured tools handle current code and live facts.
4. Specialist agents run issue, PR, CI, report or safety analysis.
5. `SafetyAgent` handles external write intents. In the MVP stage it only produces action drafts and never writes back to GitHub directly.
6. The backend records tool calls, citations, the final answer and persisted chat memory.

For engineering decisions that span multiple domains, `ChatAgent` can call `workflow.run_engineering_review`:

1. `PlannerAgent` creates a bounded `WorkflowSpec` with task claims, dependencies and acceptance criteria.
2. `WorkflowOrchestrator` runs ready tasks in parallel as soon as their dependencies are satisfied.
3. The existing issue, PR, CI, RAG, repository-health and safety capabilities run as workflow tasks.
4. `ObserverAgent` checks task outputs for merge gates, cross-agent conflicts, low confidence, missing evidence and items that need human confirmation.
5. `SynthesisAgent` produces a single decision memo, and the backend persists `AgentWorkflowRun` and `AgentTaskRun` records for later tracing and review.
