import asyncio
import json
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.db.models import AnalysisResult, CodeRelation, CodeSymbol, Conversation, Document, PullRequest, Repository, WorkflowRun
from app.db.session import get_db
from app.schemas.pull_requests import PRAnalysisResponse, PullRequestResponse
from app.services.agents.pr_review_agent import PRReviewAgent
from app.services.chat_memory import ContextAssembler
from app.services.code_search import search_repository_code
from app.services.rag.retrieval import search_similar_documents
from app.services.worktree_manager import cleanup_pr_snapshots, prepare_pr_worktree

router = APIRouter()

PROJECT_DOC_TYPES = {"knowledge_file", "memory_note", "project_doc"}
PUBLIC_REASONING_PROMPT = """
You are the PR Merge-Readiness Agent of ShipMind. Stream a short "public execution process" in English to help the user understand how you review the current PR according to plan.
Requirements:
- Output only an auditable, user-facing analysis summary; never output hidden chain-of-thought or private reasoning.
- Following the plan, explain how you checked the PR goal, diff risk, related code/docs, CI and review comments, and how you formed the merge recommendation.
- The final recommendation must be one of: Approve merge / Merge after changes / Hold / Reject.
- Do not invent files, CI runs, issues, people or comments that are not in the input.
- Do not output the final JSON.
"""


def _encode_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _trace_item(kind: str, title: str, content: str, status: str = "done") -> dict:
    return {"kind": kind, "title": title, "content": content, "status": status}


def _document_evidence(items: list[dict], default_source_type: str) -> list[dict]:
    evidence = []
    for item in items:
        snippet = str(item.get("snippet") or "").strip()
        title = str(item.get("title") or "").strip()
        if not snippet or not title:
            continue
        evidence.append(
            {
                "source_type": item.get("source_type") or default_source_type,
                "title": title,
                "snippet": snippet,
                "source_id": str(item.get("source_id") or item.get("id") or ""),
                "score": item.get("score"),
                "metadata": item.get("metadata") or {},
            }
        )
    return evidence


def _dedupe_evidence(items: list[dict], limit: int) -> list[dict]:
    output = []
    seen = set()
    for item in items:
        key = (item.get("source_type"), item.get("source_id"), item.get("title"))
        if key in seen:
            continue
        seen.add(key)
        output.append(item)
        if len(output) >= limit:
            break
    return output


def _fallback_project_documents(db: Session, repo_id: UUID) -> list[dict]:
    rows = (
        db.query(Document)
        .filter(Document.repo_id == repo_id, Document.source_type.in_(PROJECT_DOC_TYPES))
        .order_by(Document.created_at.desc())
        .limit(4)
        .all()
    )
    return [
        {
            "source_type": doc.source_type,
            "title": doc.title,
            "snippet": doc.content[:260],
            "source_id": str(doc.source_id),
            "score": None,
            "metadata": doc.meta or {},
        }
        for doc in rows
    ]


def _conversation_evidence(db: Session, pr: PullRequest, conversation_id: UUID | None, query: str) -> list[dict]:
    if not conversation_id:
        return []
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.repo_id != pr.repo_id:
        return []
    repo = db.get(Repository, pr.repo_id)
    assembled = ContextAssembler(db).assemble(repo, conversation, query, limit=8)
    evidence = _document_evidence(assembled.evidence, "conversation")
    if assembled.system_context.strip():
        evidence.append(
            {
                "source_type": "conversation",
                "title": f"Conversation context: {conversation.title}",
                "snippet": assembled.system_context[:320],
                "source_id": str(conversation.id),
                "score": None,
            }
        )
    return evidence[:5]


def _pr_payload(pr: PullRequest) -> dict:
    return {
        "id": str(pr.id),
        "number": pr.number,
        "title": pr.title,
        "body": pr.body,
        "state": pr.state,
        "author": pr.author,
        "base_branch": pr.base_branch,
        "head_branch": pr.head_branch,
        "merged_at": pr.merged_at.isoformat() if pr.merged_at else None,
        "files": [
            {
                "filename": file.filename,
                "status": file.status,
                "additions": file.additions,
                "deletions": file.deletions,
                "patch": file.patch,
            }
            for file in pr.files
        ],
        "comments": [
            {"body": comment.body, "path": comment.path, "line": comment.line, "author": comment.author}
            for comment in pr.review_comments
        ],
    }


def _pr_review_plan() -> list[str]:
    return [
        "Understand the PR title, description, changed files and related context.",
        "Split diff risk by module.",
        "Read related source code, test files and project docs.",
        "Check CI status and failure signals.",
        "Search team conventions, conversation history and review comments.",
        "Form the merge recommendation and review comments.",
    ]


def _build_pr_analysis_context(db: Session, pr: PullRequest, conversation_id: UUID | None = None) -> tuple[str, dict, dict]:
    repo = db.get(Repository, pr.repo_id)
    file_names = [file.filename for file in pr.files]
    diff_text = "\n".join(f"{file.filename}\n{file.patch or ''}" for file in pr.files[:12])
    code_query = "\n".join(filter(None, [pr.title, pr.body or "", " ".join(file_names), diff_text[:5000]]))
    review_text = "\n".join(comment.body or "" for comment in pr.review_comments)
    semantic_query = "\n".join(filter(None, [pr.title, pr.body or "", review_text[:3000]]))
    code_docs = _document_evidence(
        search_repository_code(repo, code_query, limit=6) if repo else [],
        "code",
    )
    project_docs = _document_evidence(
        search_similar_documents(
            db,
            str(pr.repo_id),
            semantic_query,
            limit=4,
            source_types=sorted(PROJECT_DOC_TYPES),
        ),
        "document",
    )
    if not project_docs:
        project_docs = _fallback_project_documents(db, pr.repo_id)
    related_issues = _document_evidence(
        search_similar_documents(db, str(pr.repo_id), semantic_query, "issue", 4),
        "issue",
    )
    chat_evidence = _conversation_evidence(db, pr, conversation_id, semantic_query)
    recent_runs = (
        db.query(WorkflowRun)
        .filter(WorkflowRun.repo_id == pr.repo_id)
        .order_by(WorkflowRun.created_at.desc())
        .limit(8)
        .all()
    )
    failed_runs = [run for run in recent_runs if run.conclusion == "failure"]
    team_members = [
        {
            "name": (doc.meta or {}).get("name") or doc.title.replace("Team member: ", ""),
            "role": (doc.meta or {}).get("role") or "",
            "strengths": (doc.meta or {}).get("strengths") or "",
            "techStack": (doc.meta or {}).get("tech_stack") or "",
        }
        for doc in db.query(Document).filter(Document.repo_id == pr.repo_id, Document.source_type == "team_member").all()
    ]
    total_additions = sum(file.additions or 0 for file in pr.files)
    total_deletions = sum(file.deletions or 0 for file in pr.files)
    sensitive_files = [
        name
        for name in file_names
        if any(token in name.lower() for token in ["auth", "security", "migration", "schema", "payment", "permission", "config", "ci", "workflow"])
    ]
    context = {
        "repo_id": str(pr.repo_id),
        "plan": _pr_review_plan(),
        "diff_stats": {
            "files": len(pr.files),
            "additions": total_additions,
            "deletions": total_deletions,
            "sensitive_files": sensitive_files,
        },
        "code_references": code_docs,
        "project_documents": project_docs,
        "related_issues": related_issues,
        "conversation_evidence": chat_evidence,
        "review_comments": _pr_payload(pr)["comments"],
        "ci_summary": {
            "recent_runs": len(recent_runs),
            "failed_runs": len(failed_runs),
            "failed": [
                {"name": run.name, "conclusion": run.conclusion, "logs_text": (run.logs_text or "")[:260]}
                for run in failed_runs[:4]
            ],
        },
        "team_members": team_members,
    }
    counts = {
        "files": len(pr.files),
        "comments": len(pr.review_comments),
        "code": len(code_docs),
        "documents": len(project_docs),
        "issues": len(related_issues),
        "conversation": len(chat_evidence),
        "failed_ci": len(failed_runs),
        "team_members": len(team_members),
    }
    return code_query, context, counts


def _snapshot_summary(snapshot: dict) -> dict:
    return {
        "status": snapshot.get("status"),
        "message": snapshot.get("message"),
        "name": snapshot.get("snapshot_name") or "PR branch snapshot",
        "branch": snapshot.get("branch"),
        "commit_sha": snapshot.get("commit_sha"),
        "pr_id": snapshot.get("pr_id"),
        "pr_number": snapshot.get("pr_number"),
        "indexed_symbols": snapshot.get("indexed_symbols"),
    }


def _prepare_pr_snapshot_context(db: Session, pr: PullRequest, enabled: bool) -> dict:
    if not enabled:
        return {"status": "skipped", "message": "No PR branch snapshot was requested."}
    repo = db.get(Repository, pr.repo_id)
    if repo is None:
        return {"status": "missing_repo", "message": "Repository not found."}
    return prepare_pr_worktree(db, repo, pr)


def _pr_code_graph_impact(db: Session, pr: PullRequest) -> dict:
    changed_paths = list(dict.fromkeys(file.filename for file in pr.files if file.filename))
    symbol_query = db.query(CodeSymbol).filter(CodeSymbol.repo_id == pr.repo_id, CodeSymbol.pr_id == pr.id)
    if changed_paths:
        symbol_query = symbol_query.filter(CodeSymbol.path.in_(changed_paths))
    symbols = symbol_query.order_by(CodeSymbol.path.asc(), CodeSymbol.start_line.asc()).limit(30).all()
    symbol_names = [symbol.name for symbol in symbols]
    relation_query = db.query(CodeRelation).filter(CodeRelation.repo_id == pr.repo_id, CodeRelation.pr_id == pr.id)
    relation_filters = []
    if changed_paths:
        relation_filters.append(CodeRelation.path.in_(changed_paths))
    if symbol_names:
        relation_filters.extend([CodeRelation.source_name.in_(symbol_names), CodeRelation.target_name.in_(symbol_names)])
    if relation_filters:
        relation_query = relation_query.filter(or_(*relation_filters))
    relations = relation_query.limit(60).all()
    return {
        "changed_paths": changed_paths[:30],
        "symbols": [
            {
                "name": symbol.name,
                "kind": symbol.kind,
                "path": symbol.path,
                "start_line": symbol.start_line,
                "branch": symbol.branch,
                "commit_sha": symbol.commit_sha,
            }
            for symbol in symbols
        ],
        "relations": [
            {
                "source": relation.source_name,
                "target": relation.target_name,
                "type": relation.relation_type,
                "path": relation.path,
                "line": (relation.meta or {}).get("line"),
            }
            for relation in relations
        ],
    }


def _augment_pr_context_with_snapshot(db: Session, pr: PullRequest, query: str, context: dict, counts: dict, snapshot: dict) -> None:
    context["pr_snapshot"] = _snapshot_summary(snapshot)
    counts["snapshot_code"] = 0
    counts["impacted_symbols"] = 0
    counts["impacted_relations"] = 0
    if snapshot.get("status") != "ready":
        context["code_graph_impact"] = {"changed_paths": [file.filename for file in pr.files], "symbols": [], "relations": []}
        return

    repo = db.get(Repository, pr.repo_id)
    snapshot_docs = _document_evidence(
        search_repository_code(
            repo,
            query,
            limit=8,
            checkout_path=snapshot.get("snapshot_path"),
            metadata={
                "checkout_kind": "pr_snapshot",
                "pr_id": str(pr.id),
                "pr_number": pr.number,
                "branch": snapshot.get("branch"),
                "commit_sha": snapshot.get("commit_sha"),
            },
        )
        if repo and snapshot.get("snapshot_path")
        else [],
        "code",
    )
    context["code_references"] = _dedupe_evidence([*snapshot_docs, *(context.get("code_references") or [])], 10)
    impact = _pr_code_graph_impact(db, pr)
    context["code_graph_impact"] = impact
    counts["snapshot_code"] = len(snapshot_docs)
    counts["impacted_symbols"] = len(impact["symbols"])
    counts["impacted_relations"] = len(impact["relations"])
    counts["code"] = len(context["code_references"])


def _persist_pr_analysis(
    db: Session,
    pr: PullRequest,
    result: dict,
    model_name: str,
    conversation_id: UUID | None,
    evidence_counts: dict,
) -> AnalysisResult:
    analysis = AnalysisResult(
        target_type="pull_request",
        target_id=pr.id,
        analysis_type="pr_review",
        input_snapshot={
            "pr_id": str(pr.id),
            "conversation_id": str(conversation_id) if conversation_id else None,
            "evidence_counts": evidence_counts,
        },
        result_json=result,
        model_name=model_name,
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)
    return analysis


def _public_reasoning_fallback(pr: PullRequest, context: dict, counts: dict) -> list[str]:
    stats = context.get("diff_stats") or {}
    return [
        f"- I first drew up a review plan, then read the title, description, branch and {counts['files']} changed files of PR #{pr.number}.\n",
        f"- The diff size is +{stats.get('additions', 0)} / -{stats.get('deletions', 0)}, including {len(stats.get('sensitive_files') or [])} sensitive files.\n",
        f"- I retrieved {counts['code']} related code hints ({counts.get('snapshot_code', 0)} from the PR snapshot), {counts['documents']} project docs/memories, {counts['issues']} historical issues and {counts['conversation']} pieces of conversation evidence.\n",
        f"- On the CI side I found {counts['failed_ci']} failure signals and combined them with {counts['comments']} review comments to judge whether the merge is blocked.\n",
        "- Finally I summarized risks, blockers and test suggestions into a merge recommendation: Approve merge, Merge after changes, Hold or Reject.\n",
    ]


async def _stream_public_reasoning(agent: PRReviewAgent, pr: PullRequest, payload: dict, context: dict, counts: dict) -> AsyncIterator[str]:
    streamed = False
    user_payload = {
        "pull_request": payload,
        "plan": context.get("plan") or [],
        "evidence_counts": counts,
        "context_preview": {
            "diff_stats": context.get("diff_stats"),
            "pr_snapshot": context.get("pr_snapshot"),
            "code_graph_impact": context.get("code_graph_impact"),
            "code_references": context.get("code_references", [])[:3],
            "project_documents": context.get("project_documents", [])[:3],
            "ci_summary": context.get("ci_summary"),
            "review_comments": context.get("review_comments", [])[:3],
        },
    }
    async for chunk in agent.llm.chat_text_stream(
        PUBLIC_REASONING_PROMPT,
        [{"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)}],
    ):
        streamed = True
        yield chunk
    if streamed:
        return
    for line in _public_reasoning_fallback(pr, context, counts):
        await asyncio.sleep(0.06)
        yield line


async def _pr_analysis_sse(pr_id: UUID, conversation_id: UUID | None, db: Session) -> AsyncIterator[str]:
    pr = db.query(PullRequest).options(selectinload(PullRequest.files), selectinload(PullRequest.review_comments)).filter(PullRequest.id == pr_id).one_or_none()
    if pr is None:
        yield _encode_sse("error", {"message": "PR not found"})
        return
    agent = PRReviewAgent()
    payload = _pr_payload(pr)
    plan = _pr_review_plan()
    try:
        yield _encode_sse("trace", _trace_item("step", "Draw up review plan", "\n".join(f"{index + 1}. {item}" for index, item in enumerate(plan)), "done"))
        yield _encode_sse("trace", _trace_item("step", "Step 1/6: understand the PR", f"Reading the title, description, branch, author and changed files of PR #{pr.number}.", "running"))
        snapshot = _prepare_pr_snapshot_context(db, pr, enabled=True)
        yield _encode_sse(
            "trace",
            _trace_item(
                "tool",
                "Prepare PR branch snapshot",
                str(snapshot.get("message") or f"Status: {snapshot.get('status')}; graph symbols: {snapshot.get('indexed_symbols') or 0}."),
            ),
        )
        _query, context, counts = _build_pr_analysis_context(db, pr, conversation_id)
        _augment_pr_context_with_snapshot(db, pr, _query, context, counts, snapshot)
        context["plan"] = plan
        yield _encode_sse("trace", _trace_item("tool", "Step 2/6: split diff risk", f"Scanned {counts['files']} files and identified {len((context.get('diff_stats') or {}).get('sensitive_files') or [])} sensitive files."))
        yield _encode_sse("trace", _trace_item("tool", "Step 3/6: read code and tests", f"Found {counts['code']} code hints ({counts.get('snapshot_code', 0)} from the PR snapshot) and {counts['documents']} project doc/memory hints."))
        yield _encode_sse("trace", _trace_item("tool", "Step 4/6: check CI", f"Read recent CI signals; failed runs: {counts['failed_ci']}."))
        yield _encode_sse("trace", _trace_item("tool", "Step 5/6: search context", f"Found {counts['issues']} historical issues, {counts['conversation']} pieces of conversation evidence and {counts['comments']} review comments."))
        yield _encode_sse("trace", _trace_item("thinking", "LLM public execution process", "Combining the PR diff, code, CI, docs and review comments.", "running"))
        async for chunk in _stream_public_reasoning(agent, pr, payload, context, counts):
            yield _encode_sse("thinking_delta", {"content": chunk})
        result = await agent.run(payload, context)
        analysis = _persist_pr_analysis(db, pr, result, agent.llm.model, conversation_id, counts)
        yield _encode_sse("trace", _trace_item("result", "Step 6/6: form merge recommendation", f"Conclusion: {result.get('merge_recommendation')}; risk points: {len(result.get('risk_points') or [])}; blockers: {len(result.get('blocking_issues') or [])}."))
        yield _encode_sse("final", {"analysis_id": str(analysis.id), "result": result})
    except Exception as exc:
        db.rollback()
        yield _encode_sse("error", {"message": f"Analysis failed: {exc}"})


@router.get("/repos/{repo_id}/pull-requests", response_model=list[PullRequestResponse])
async def list_pull_requests(repo_id: UUID, db: Session = Depends(get_db)) -> list[PullRequest]:
    return (
        db.query(PullRequest)
        .options(selectinload(PullRequest.files), selectinload(PullRequest.review_comments))
        .filter(PullRequest.repo_id == repo_id)
        .order_by(PullRequest.number.desc())
        .all()
    )


@router.get("/pull-requests/{pr_id}", response_model=PullRequestResponse)
async def get_pull_request(pr_id: UUID, db: Session = Depends(get_db)) -> PullRequest:
    pr = db.query(PullRequest).options(selectinload(PullRequest.files), selectinload(PullRequest.review_comments)).filter(PullRequest.id == pr_id).one_or_none()
    if pr is None:
        raise HTTPException(status_code=404, detail="PR not found")
    return pr


@router.post("/pull-requests/{pr_id}/analyze", response_model=PRAnalysisResponse)
async def analyze_pull_request(
    pr_id: UUID,
    conversation_id: UUID | None = Query(default=None),
    use_pr_snapshot: bool = Query(default=True),
    use_worktree: bool | None = Query(default=None),
    db: Session = Depends(get_db),
) -> PRAnalysisResponse:
    pr = db.query(PullRequest).options(selectinload(PullRequest.files), selectinload(PullRequest.review_comments)).filter(PullRequest.id == pr_id).one_or_none()
    if pr is None:
        raise HTTPException(status_code=404, detail="PR not found")
    agent = PRReviewAgent()
    snapshot_enabled = use_pr_snapshot if use_worktree is None else use_worktree
    snapshot = _prepare_pr_snapshot_context(db, pr, snapshot_enabled)
    _query, context, counts = _build_pr_analysis_context(db, pr, conversation_id)
    _augment_pr_context_with_snapshot(db, pr, _query, context, counts, snapshot)
    result = await agent.run(_pr_payload(pr), context)
    analysis = _persist_pr_analysis(db, pr, result, agent.llm.model, conversation_id, counts)
    return PRAnalysisResponse(analysis_id=analysis.id, result=result)


@router.post("/pull-requests/{pr_id}/analyze/stream")
async def analyze_pull_request_stream(
    pr_id: UUID,
    conversation_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return StreamingResponse(_pr_analysis_sse(pr_id, conversation_id, db), media_type="text/event-stream")


@router.post("/pull-requests/{pr_id}/snapshot")
async def prepare_pull_request_snapshot(pr_id: UUID, db: Session = Depends(get_db)) -> dict:
    pr = db.query(PullRequest).options(selectinload(PullRequest.files)).filter(PullRequest.id == pr_id).one_or_none()
    if pr is None:
        raise HTTPException(status_code=404, detail="PR not found")
    return _prepare_pr_snapshot_context(db, pr, enabled=True)


@router.post("/pull-requests/{pr_id}/worktree")
async def prepare_pull_request_worktree(pr_id: UUID, db: Session = Depends(get_db)) -> dict:
    pr = db.query(PullRequest).options(selectinload(PullRequest.files)).filter(PullRequest.id == pr_id).one_or_none()
    if pr is None:
        raise HTTPException(status_code=404, detail="PR not found")
    return _prepare_pr_snapshot_context(db, pr, enabled=True)


@router.post("/repos/{repo_id}/pr-snapshots/cleanup")
async def cleanup_pull_request_snapshots(
    repo_id: UUID,
    max_age_hours: int = Query(default=168, ge=1, le=24 * 90),
    db: Session = Depends(get_db),
) -> dict:
    repo = db.get(Repository, repo_id)
    if repo is None:
        raise HTTPException(status_code=404, detail="Repository not found")
    return cleanup_pr_snapshots(db, repo, max_age_hours=max_age_hours)


@router.post("/pull-requests/{pr_id}/review-checklist")
async def review_checklist(pr_id: UUID, db: Session = Depends(get_db)) -> dict:
    response = await analyze_pull_request(pr_id, db=db)
    return {"pr_id": str(pr_id), "checklist": response.result.review_checklist}
