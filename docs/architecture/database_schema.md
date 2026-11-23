# Database Schema

Core tables: users, repositories, issues, pull_requests, pr_files, pr_review_comments, workflow_runs, analysis_results, documents, agent_runs, eval_runs.

The current models live in `backend/app/db/models.py`.

Notes:

- `workflow_runs.jobs` stores GitHub Actions jobs and steps, used to locate the failing job.
- `documents.metadata` stores tags, file paths, status and time ranges, used for RAG filtering.
- `eval_runs.result_json` stores basic evaluation metrics and the Markdown eval report.
