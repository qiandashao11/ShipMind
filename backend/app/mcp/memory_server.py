#!/usr/bin/env python
import asyncio
import json
import sys
import traceback
import uuid
from pathlib import Path
from typing import Any


BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy.orm import Session  # noqa: E402

from app.db.models import Conversation, Repository  # noqa: E402
from app.db.session import Base, SessionLocal, engine  # noqa: E402
from app.services.chat_memory import MemoryTools  # noqa: E402
from app.services.conversations import ensure_conversation  # noqa: E402


SERVER_NAME = "shipmind-memory-mcp"
SERVER_VERSION = "0.1.0"

for stream in (sys.stdin, sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")


def _json_schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


TOOLS: list[dict[str, Any]] = [
    {
        "name": "shipmind_search_evidence",
        "description": (
            "Search ShipMind repository knowledge and persistent memory. "
            "Prefer this tool when you need to recall historical issues/PRs, failed CI, uploaded knowledge, project docs, session summaries, agent run records or approved decisions. "
            "Use workspace or structured tools for current code, team members and live status."
        ),
        "inputSchema": _json_schema(
            {
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20, "description": "Maximum number of results"},
                "repo_id": {"type": "string", "description": "Required repository UUID."},
                "conversation_id": {"type": "string", "description": "Optional ShipMind conversation UUID."},
            },
            ["query", "repo_id"],
        ),
    },
    {
        "name": "shipmind_get_thread_context",
        "description": (
            "Read the full raw chat transcript of a ShipMind repository conversation, across Compact Boundaries. "
            "Supports keyword, message UUID, before/after ranges and character-offset paging; use it when the user asks what was said earlier or needs word-for-word verification."
        ),
        "inputSchema": _json_schema(
            {
                "keyword": {"type": "string", "description": "Optional keyword filter"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "description": "Maximum number of messages"},
                "message_id": {"type": "string", "description": "Optional message UUID; used to page through one exact message."},
                "before_message_id": {"type": "string", "description": "Optional message UUID; only read records before it."},
                "after_message_id": {"type": "string", "description": "Optional message UUID; only read records after it."},
                "offset": {"type": "integer", "minimum": 0, "description": "Character offset when reading a single message."},
                "max_chars": {"type": "integer", "minimum": 200, "maximum": 16000, "description": "Maximum number of body characters to return this time."},
                "repo_id": {"type": "string", "description": "Required repository UUID."},
                "conversation_id": {"type": "string", "description": "Optional ShipMind conversation UUID."},
            },
            ["repo_id"],
        ),
    },
    {
        "name": "shipmind_read_session_events",
        "description": (
            "Read archived ShipMind chat sessions, summaries, raw messages and tool events. "
            "Use after search_evidence, or when session-level recall is needed."
        ),
        "inputSchema": _json_schema(
            {
                "session_id": {"type": "string", "description": "Optional session segment UUID; defaults to the most recent session."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20, "description": "Maximum number of sessions"},
                "include_transcript": {"type": "boolean", "description": "Whether to return archived raw messages and tool events; defaults to true."},
                "max_chars": {"type": "integer", "minimum": 400, "maximum": 20000, "description": "Maximum number of body characters to return this time."},
                "repo_id": {"type": "string", "description": "Required repository UUID."},
                "conversation_id": {"type": "string", "description": "Optional ShipMind conversation UUID."},
            },
            ["repo_id"],
        ),
    },
]


class McpError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _content(text: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}]}


def _resolve_repo(db: Session, args: dict[str, Any]) -> Repository:
    repo_id = args.get("repo_id")
    if not repo_id:
        raise McpError(-32602, "repo_id is required")
    try:
        repo = db.get(Repository, uuid.UUID(str(repo_id)))
    except ValueError as exc:
        raise McpError(-32602, f"Invalid repo_id: {repo_id}") from exc
    if repo is None:
        raise McpError(-32602, f"Repository not found: {repo_id}")
    return repo


def _resolve_conversation(db: Session, repo: Repository, args: dict[str, Any]) -> Conversation:
    conversation_id = args.get("conversation_id")
    if conversation_id:
        try:
            return ensure_conversation(db, repo.id, uuid.UUID(str(conversation_id)))
        except ValueError as exc:
            raise McpError(-32602, f"Invalid conversation_id: {conversation_id}") from exc
    return ensure_conversation(db, repo.id)


def _repo_label(repo: Repository) -> str:
    return repo.full_name


async def _call_memory_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        repo = _resolve_repo(db, args)
        conversation = _resolve_conversation(db, repo, args)
        tools = MemoryTools(db, repo, conversation)

        if name == "shipmind_search_evidence":
            query = str(args.get("query") or "").strip()
            if not query:
                raise McpError(-32602, "query is required")
            result = await tools.search_evidence({"query": query, "limit": int(args.get("limit") or 5)}, {})
            db.commit()
            return _content(f"Repository: {_repo_label(repo)}\nConversation: {conversation.title if conversation else 'global'}\n\n{result.get('answer') or ''}")

        if name == "shipmind_get_thread_context":
            result = await tools.get_thread_context(
                {
                    "keyword": str(args.get("keyword") or ""),
                    "limit": int(args.get("limit") or 30),
                    "message_id": args.get("message_id"),
                    "before_message_id": args.get("before_message_id"),
                    "after_message_id": args.get("after_message_id"),
                    "offset": int(args.get("offset") or 0),
                    "max_chars": int(args.get("max_chars") or 6000),
                },
                {},
            )
            db.commit()
            return _content(f"Repository: {_repo_label(repo)}\nConversation: {conversation.title if conversation else 'global'}\n\n{result.get('answer') or ''}")

        if name == "shipmind_read_session_events":
            result = await tools.read_session_events(
                {
                    "session_id": args.get("session_id"),
                    "limit": int(args.get("limit") or 5),
                    "include_transcript": bool(args.get("include_transcript", True)),
                    "max_chars": int(args.get("max_chars") or 8000),
                },
                {},
            )
            db.commit()
            return _content(f"Repository: {_repo_label(repo)}\nConversation: {conversation.title if conversation else 'global'}\n\n{result.get('answer') or ''}")

        raise McpError(-32601, f"Unknown tool: {name}")
    finally:
        db.close()


def _initialize() -> dict[str, Any]:
    return {
        "protocolVersion": "2024-11-05",
        "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        "capabilities": {"tools": {"listChanged": False}},
    }


async def handle_request(request: dict[str, Any]) -> dict[str, Any] | None:
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}

    if method == "notifications/initialized":
        return None

    try:
        if method == "initialize":
            result = _initialize()
        elif method == "tools/list":
            result = {"tools": TOOLS}
        elif method == "tools/call":
            name = str(params.get("name") or "")
            arguments = params.get("arguments") or {}
            if not isinstance(arguments, dict):
                raise McpError(-32602, "arguments must be an object")
            result = await _call_memory_tool(name, arguments)
        else:
            raise McpError(-32601, f"Method not found: {method}")
        return {"jsonrpc": "2.0", "id": request_id, "result": result}
    except McpError as exc:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": exc.code, "message": exc.message}}
    except Exception as exc:
        print(traceback.format_exc(), file=sys.stderr)
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32603, "message": str(exc)}}


async def main() -> None:
    print(f"[{SERVER_NAME}] running on stdio", file=sys.stderr)
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(exc)}}
        else:
            response = await handle_request(request)
        if response is not None:
            print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
