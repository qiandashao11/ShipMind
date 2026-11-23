import asyncio
import json
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.models import AnalysisResult, Conversation, Document, Issue, Repository
from app.db.session import get_db
from app.schemas.issues import IssueAnalysisResponse, IssueResponse
from app.services.agents.issue_agent import IssueAgent
from app.services.chat_memory import ContextAssembler
from app.services.code_search import search_repository_code
from app.services.rag.retrieval import search_similar_documents

router = APIRouter()

PROJECT_DOC_TYPES = {"knowledge_file", "memory_note", "project_doc"}
PUBLIC_REASONING_PROMPT = """
You are the Issue Agent of ShipMind. Stream a short "public analysis process" in English to help the user understand how you analyze the current issue.
Requirements:
- Output only an auditable, user-facing analysis summary; never output hidden chain-of-thought or private reasoning.
- Briefly state which evidence you checked and how you decided the conclusion, priority, complexity and owner.
- Do not invent files, people, issues or PRs that are not in the input.
- Do not output the final JSON.
"""


def _encode_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


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


def _conversation_evidence(db: Session, issue: Issue, conversation_id: UUID | None, query: str) -> list[dict]:
    if not conversation_id:
        return []
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.repo_id != issue.repo_id:
        return []
    repo = db.get(Repository, issue.repo_id)
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


def _issue_payload(issue: Issue) -> dict:
    return {
        "id": str(issue.id),
        "title": issue.title,
        "body": issue.body,
        "labels": issue.labels,
        "number": issue.number,
        "state": issue.state,
        "assignees": issue.assignees,
        "author": issue.author,
    }


def _build_issue_analysis_context(db: Session, issue: Issue, conversation_id: UUID | None = None) -> tuple[str, dict, dict]:
    query = f"{issue.title}\n{issue.body or ''}"
    repo = db.get(Repository, issue.repo_id)
    similar_docs = search_similar_documents(db, str(issue.repo_id), query, "issue", 4)
    duplicates = [
        {
            "issue_id": item["source_id"],
            "title": item["title"],
            "score": max(0.0, min(1.0, float(item["score"]))),
        }
        for item in similar_docs
        if item["source_id"] != str(issue.id)
    ]
    code_docs = _document_evidence(
        search_repository_code(repo, query, limit=4) if repo else [],
        "code",
    )
    project_docs = _document_evidence(
        search_similar_documents(
            db,
            str(issue.repo_id),
            query,
            limit=4,
            source_types=sorted(PROJECT_DOC_TYPES),
        ),
        "document",
    )
    if not project_docs:
        project_docs = _fallback_project_documents(db, issue.repo_id)
    chat_evidence = _conversation_evidence(db, issue, conversation_id, query)
    team_members = [
        {
            "name": (doc.meta or {}).get("name") or doc.title.replace("Team member: ", ""),
            "role": (doc.meta or {}).get("role") or "",
            "strengths": (doc.meta or {}).get("strengths") or "",
            "techStack": (doc.meta or {}).get("tech_stack") or "",
        }
        for doc in db.query(Document).filter(Document.repo_id == issue.repo_id, Document.source_type == "team_member").all()
    ]
    context = {
        "repo_id": str(issue.repo_id),
        "duplicate_candidates": duplicates,
        "code_references": code_docs,
        "project_documents": project_docs,
        "conversation_evidence": chat_evidence,
        "team_members": team_members,
    }
    counts = {
        "duplicates": len(duplicates),
        "code": len(code_docs),
        "documents": len(project_docs),
        "conversation": len(chat_evidence),
        "team_members": len(team_members),
    }
    return query, context, counts


def _persist_issue_analysis(
    db: Session,
    issue: Issue,
    result: dict,
    model_name: str,
    conversation_id: UUID | None,
    evidence_counts: dict,
) -> AnalysisResult:
    analysis = AnalysisResult(
        target_type="issue",
        target_id=issue.id,
        analysis_type="issue_analysis",
        input_snapshot={
            "issue_id": str(issue.id),
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


def _trace_item(kind: str, title: str, content: str, status: str = "done") -> dict:
    return {"kind": kind, "title": title, "content": content, "status": status}


def _public_reasoning_fallback(issue: Issue, context: dict) -> list[str]:
    duplicates = context.get("duplicate_candidates") or []
    code_refs = context.get("code_references") or []
    docs = context.get("project_documents") or []
    members = context.get("team_members") or []
    return [
        f"- First I read the title, body, labels and state of Issue #{issue.number} to confirm it describes \"{issue.title}\".\n",
        f"- Then I searched similar historical issues and found {len(duplicates)} candidates; if similarity is high I recommend merging into the existing issue.\n",
        f"- Next I checked code and project-doc evidence: {len(code_refs)} code hints and {len(docs)} doc/memory hints, to judge impact scope and complexity.\n",
        f"- Finally I used team profiles: {len(members)} members available; the owner is only chosen from configured members or a clear area.\n",
        "- These public analysis steps are summarized into a structured result: conclusion, priority, complexity, owner, evidence, checklist and optional drafts.\n",
    ]


async def _stream_public_reasoning(agent: IssueAgent, issue: Issue, payload: dict, context: dict) -> AsyncIterator[str]:
    streamed = False
    user_payload = {
        "issue": payload,
        "evidence_counts": {
            "duplicates": len(context.get("duplicate_candidates") or []),
            "code_references": len(context.get("code_references") or []),
            "project_documents": len(context.get("project_documents") or []),
            "conversation_evidence": len(context.get("conversation_evidence") or []),
            "team_members": len(context.get("team_members") or []),
        },
        "context_preview": {
            "duplicates": context.get("duplicate_candidates", [])[:3],
            "code_references": context.get("code_references", [])[:3],
            "project_documents": context.get("project_documents", [])[:3],
            "team_members": context.get("team_members", [])[:3],
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
    for line in _public_reasoning_fallback(issue, context):
        await asyncio.sleep(0.06)
        yield line


async def _issue_analysis_sse(issue_id: UUID, conversation_id: UUID | None, db: Session) -> AsyncIterator[str]:
    issue = db.get(Issue, issue_id)
    if issue is None:
        yield _encode_sse("error", {"message": "Issue not found"})
        return
    agent = IssueAgent()
    payload = _issue_payload(issue)
    try:
        yield _encode_sse("trace", _trace_item("step", "Read issue", f"Reading the title, body, labels, state and assignees of Issue #{issue.number}.", "running"))
        query, context, counts = _build_issue_analysis_context(db, issue, conversation_id)
        yield _encode_sse("trace", _trace_item("tool", "Search similar history", f"Found {counts['duplicates']} similar issue candidates."))
        yield _encode_sse("trace", _trace_item("tool", "Search code and docs", f"Found {counts['code']} code hints and {counts['documents']} project doc/memory hints."))
        yield _encode_sse("trace", _trace_item("tool", "Read team profiles", f"Read {counts['team_members']} team members for owner suggestions."))
        if counts["conversation"]:
            yield _encode_sse("trace", _trace_item("tool", "Read conversation context", f"Found {counts['conversation']} pieces of evidence related to the current conversation."))
        yield _encode_sse("trace", _trace_item("thinking", "LLM public analysis", "Combining the issue, evidence and team profiles.", "running"))
        async for chunk in _stream_public_reasoning(agent, issue, payload, context):
            yield _encode_sse("thinking_delta", {"content": chunk})
        result = await agent.run(payload, context)
        analysis = _persist_issue_analysis(db, issue, result, agent.llm.model, conversation_id, counts)
        yield _encode_sse("trace", _trace_item("result", "Generate structured result", f"Conclusion: {result.get('conclusion')}; priority: {result.get('priority')}; complexity: {result.get('complexity')}; owner: {result.get('suggested_owner')}."))
        yield _encode_sse("final", {"analysis_id": str(analysis.id), "result": result})
    except Exception as exc:
        db.rollback()
        yield _encode_sse("error", {"message": f"Analysis failed: {exc}"})


@router.get("/repos/{repo_id}/issues", response_model=list[IssueResponse])
async def list_issues(repo_id: UUID, db: Session = Depends(get_db)) -> list[Issue]:
    return db.query(Issue).filter(Issue.repo_id == repo_id).order_by(Issue.number.desc()).all()


@router.get("/issues/{issue_id}", response_model=IssueResponse)
async def get_issue(issue_id: UUID, db: Session = Depends(get_db)) -> Issue:
    issue = db.get(Issue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


@router.post("/issues/{issue_id}/analyze", response_model=IssueAnalysisResponse)
async def analyze_issue(
    issue_id: UUID,
    conversation_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
) -> IssueAnalysisResponse:
    issue = db.get(Issue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")
    agent = IssueAgent()
    _query, context, counts = _build_issue_analysis_context(db, issue, conversation_id)
    result = await agent.run(_issue_payload(issue), context)
    analysis = _persist_issue_analysis(db, issue, result, agent.llm.model, conversation_id, counts)
    return IssueAnalysisResponse(analysis_id=analysis.id, result=result)


@router.post("/issues/{issue_id}/analyze/stream")
async def analyze_issue_stream(
    issue_id: UUID,
    conversation_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    return StreamingResponse(_issue_analysis_sse(issue_id, conversation_id, db), media_type="text/event-stream")


@router.get("/issues/{issue_id}/similar")
async def similar_issues(issue_id: UUID, db: Session = Depends(get_db)) -> list[dict]:
    issue = db.get(Issue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")
    return search_similar_documents(db, str(issue.repo_id), f"{issue.title}\n{issue.body or ''}", "issue", 5)
