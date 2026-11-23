"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  BookOpen,
  Cable,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  FileText,
  Folder,
  Gauge,
  GitPullRequest,
  ListTodo,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  X,
  XCircle,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { apiDelete, apiGet, apiPost, apiPostStream, apiUpload } from "@/lib/api";
import type { Repository } from "@/lib/types";
import { FeedbackControls, type ChatFeedbackRecord } from "@/components/feedback-controls";

type Issue = {
  id: string;
  number: number;
  title: string;
  state: string;
  labels?: string[];
  body?: string | null;
  author?: string | null;
  assignees?: string[];
  created_at?: string | null;
  updated_at?: string | null;
};

type PRFile = {
  id: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | null;
};

type PullRequest = {
  id: string;
  number: number;
  title: string;
  state: string;
  body?: string | null;
  author?: string | null;
  base_branch?: string | null;
  head_branch?: string | null;
  merged_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  files?: PRFile[];
};

type WorkflowRun = {
  id: string;
  name: string;
  status: string;
  conclusion?: string | null;
  html_url?: string | null;
  logs_text?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type WorkflowPlanClaim = {
  target_type: string;
  target_id?: string | null;
  allowed_sources?: string[];
  write_intent?: boolean;
  reason?: string;
};

type WorkflowPlanTask = {
  id: string;
  agent_name: string;
  task_type: string;
  objective: string;
  dependencies?: string[];
  claim: WorkflowPlanClaim;
  critical?: boolean;
};

type WorkflowPlan = {
  workflow_id: string;
  goal: string;
  trigger_message: string;
  acceptance_criteria?: string[];
  tasks: WorkflowPlanTask[];
  max_parallel_tasks?: number;
  requires_human_confirmation?: boolean;
  created_at?: string;
};

type ChatResponse = {
  route: string;
  tool_calls: ToolCallTrace[];
  agent_events?: Array<Record<string, unknown>>;
  answer: string;
  citations: Array<Record<string, string>>;
  compression_stats?: Record<string, unknown>;
  progressive_compaction?: Record<string, unknown>;
  model_usage?: Array<Record<string, unknown>>;
  context_diagnostics?: Record<string, unknown>;
};

type ChatPlanResponse = {
  route: string;
  conversation_id: string;
  answer: string;
  plan: WorkflowPlan;
  tool_calls: ToolCallTrace[];
  agent_events?: Array<Record<string, unknown>>;
};

type ChatStreamFinal = ChatResponse & {
  run_id: string;
  message_id: string;
};

type ChatStreamDelta = {
  content?: string;
};

type ChatStreamToolUse = {
  id?: string;
  tool_name?: string;
  arguments?: Record<string, unknown>;
  skill_name?: string;
  skill_title?: string;
  skill_version?: string;
  skill_steps?: string[];
  skill_activation_mode?: string;
  skill_activation_reason?: string;
  skill_instruction_digest?: string;
};

type ChatStreamToolResult = {
  tool_use_id?: string;
  tool_name?: string;
  status?: string;
  route?: string;
  content?: unknown;
  error?: string;
  skill_name?: string;
  skill_title?: string;
  skill_version?: string;
  skill_steps?: string[];
  skill_activation_mode?: string;
  skill_activation_reason?: string;
  skill_instruction_digest?: string;
};

type PromptRecommendationsResponse = {
  agent: string;
  suggestions: string[];
};

type DuplicateCandidate = {
  issue_id: string;
  title: string;
  score: number;
};

type IssueEvidence = {
  source_type: string;
  title: string;
  snippet: string;
  reference?: string | null;
  confidence?: number | null;
};

type IssueDrafts = {
  clarification_comment?: string | null;
  task_breakdown?: string | null;
};

type IssueAnalysisResult = {
  summary: string;
  conclusion: "Ready for development" | "Needs clarification" | "Close" | "Split" | "Merge into existing issue" | string;
  conclusion_reason: string;
  category: string;
  priority: "P0" | "P1" | "P2" | "P3" | string;
  complexity: "S" | "M" | "L" | "XL" | string;
  suggested_owner: string;
  owner_reason: string;
  duplicate_candidates?: DuplicateCandidate[];
  evidence?: IssueEvidence[];
  checklist?: string[];
  action_items?: string[];
  drafts?: IssueDrafts;
  confidence: number;
};

type IssueAnalysisResponse = {
  analysis_id: string;
  result: IssueAnalysisResult;
};

type PRAnalysisResult = {
  summary: string;
  plan?: string[];
  executed_steps?: string[];
  merge_recommendation: "Approve merge" | "Merge after changes" | "Hold" | "Reject" | string;
  recommendation_reason?: string;
  key_changes?: string[];
  risk_points?: string[];
  blocking_issues?: string[];
  review_checklist?: string[];
  test_suggestions?: string[];
  files_need_attention?: string[];
  review_comments?: string[];
  confidence: number;
};

type PRAnalysisResponse = {
  analysis_id: string;
  result: PRAnalysisResult;
};

type CIAnalysisResult = {
  failure_summary: string;
  failure_type: "test" | "build" | "lint" | "dependency" | "permission" | "environment" | "unknown" | string;
  plan?: string[];
  executed_steps?: string[];
  first_error?: string | null;
  root_cause?: string;
  possible_causes?: string[];
  fix_steps?: string[];
  debug_steps?: string[];
  related_files?: string[];
  is_merge_blocking: boolean;
  blocking_reason?: string;
  confidence: number;
};

type CIAnalysisResponse = {
  analysis_id: string;
  result: CIAnalysisResult;
};

type IssueAnalysisTraceItem = {
  id: string;
  kind: "step" | "tool" | "thinking" | "result" | "error" | string;
  title: string;
  content: string;
  status?: "running" | "done" | "error" | string;
};

type ChatHistoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  route?: string | null;
  tool_calls?: ToolCallTrace[];
  agent_events?: Array<Record<string, unknown>>;
  compression_stats?: Record<string, unknown>;
  progressive_compaction?: Record<string, unknown>;
  model_usage?: Array<Record<string, unknown>>;
  context_diagnostics?: Record<string, unknown>;
  created_at?: string | null;
};

type RepoConnectResult = {
  repo_id: string;
  full_name: string;
  provider: string;
  api_base_url?: string | null;
  clone_url?: string | null;
  local_path?: string | null;
  checkout_mode?: string;
  default_branch?: string | null;
  connected: boolean;
  demo_mode: boolean;
  message: string;
  sync_status?: string;
  synced?: Record<string, number>;
};

type ProjectConversation = {
  id: string;
  repo_id: string;
  title: string;
  status: string;
  message_count: number;
  created_at?: string | null;
  updated_at?: string | null;
};

type ConversationDeleteResult = {
  deleted: string;
  active_conversation_id: string;
  conversations: ProjectConversation[];
};

type ChatMessage = {
  id: string;
  messageId?: string;
  role: "user" | "assistant";
  content: string;
  route?: string;
  toolCalls?: ToolCallTrace[];
  traceItems?: ChatTraceItem[];
  traceCollapsed?: boolean;
  responsePending?: boolean;
  compressionStats?: Record<string, unknown>;
  progressiveCompaction?: Record<string, unknown>;
  modelUsage?: Array<Record<string, unknown>>;
  contextDiagnostics?: Record<string, unknown>;
  contextCollapsed?: boolean;
  workflowPlan?: WorkflowPlan;
  planSourceMessage?: string;
  planStatus?: "ready" | "executing" | "done" | "error";
  feedback?: ChatFeedbackRecord;
};

type ToolCallTrace = {
  tool_name: string;
  status: string;
  error?: string;
  tool_use_id?: string;
  skill_name?: string;
  skill_title?: string;
  skill_version?: string;
  skill_steps?: string[];
  skill_activation_mode?: string;
  skill_activation_reason?: string;
  skill_instruction_digest?: string;
};

type ChatTraceItem = {
  id: string;
  kind: "thinking" | "tool" | "error" | string;
  title: string;
  content: string;
  status?: "running" | "done" | "error" | string;
  toolUseId?: string;
  skillName?: string;
  skillTitle?: string;
  skillVersion?: string;
  skillSteps?: string[];
  skillActivationMode?: string;
  skillActivationReason?: string;
  skillInstructionDigest?: string;
  evidenceCount?: number;
};

type SkillManifest = {
  name: string;
  title: string;
  version: string;
  description: string;
  category: string;
  entrypoint: string;
  tools: string[];
  input_modes: string[];
  triggers: string[];
  workflow_steps: string[];
  output_contract: string;
  safety_level: string;
};

type SkillResponse = {
  manifest: SkillManifest;
  path: string;
  instructions?: string | null;
};

type McpRuntime = {
  status: string;
  server_name: string;
  server_version: string;
  protocol_version: string;
  transport: string;
  tools: Array<{
    name: string;
    description: string;
    input_schema: {
      required?: string[];
      properties?: Record<string, unknown>;
    };
  }>;
};

type WorkspaceSelection =
  | { type: "issue"; id: string }
  | { type: "pr"; id: string }
  | { type: "ci"; id: string };

type WorkspaceItem = {
  id: string;
  title: string;
  meta: string;
  detail?: string | null;
  badges?: string[];
  selected: boolean;
  onClick: () => void;
};

type TeamMember = {
  id: string;
  name: string;
  role: string;
  strengths: string;
  techStack: string;
};

type TeamMemberDraft = Omit<TeamMember, "id">;

type MemoryNote = {
  id: string;
  title: string;
  content: string;
};

type MemoryNoteDraft = Omit<MemoryNote, "id">;

type KnowledgeItem = {
  id: string;
  document_ids: string[];
  source_type: "memory_note" | "knowledge_file" | "team_member" | "weekly_report" | string;
  title: string;
  content_preview: string;
  metadata?: Record<string, unknown>;
  chunk_count: number;
  created_at?: string | null;
};

type ProjectIndexStatus = "missing" | "stale" | "building" | "ready" | "failed";

type ProjectIndexSummary = {
  projectName?: string;
  rootPath?: string;
  techStack?: string[];
  dirStructure?: string[];
  docsList?: Array<{ path: string; tier: string; source_type?: string }>;
  tierCoverage?: Record<string, number>;
  sourceTypeCoverage?: Record<string, number>;
  docsIndexed?: number;
  indexPolicy?: {
    mode?: "auto" | "allowlist";
    include?: string[];
    exclude?: string[];
    includeManifests?: boolean;
    configPath?: string | null;
  };
  excludedFiles?: number;
  excludedPaths?: string[];
  discoveryTruncated?: boolean;
};

type ProjectIndexState = {
  repo_id: string;
  status: ProjectIndexStatus;
  fingerprint: string;
  docs_indexed: number;
  docs_total: number;
  error_message?: string | null;
  summary_json?: ProjectIndexSummary | null;
  snoozed_until?: string | null;
  last_scan_at?: string | null;
};

type RecallEvent = {
  id: string;
  tool_name: string;
  query: string;
  scope: string;
  mode: string;
  status: string;
  result_count: number;
  results: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
};

type MemoryStatus = {
  repo_id: string;
  index: Record<string, unknown>;
  documents: Record<string, unknown>;
  evidence: Record<string, unknown>;
  recall: Record<string, unknown>;
  candidates: Record<string, unknown>;
  vector: Record<string, unknown>;
};

type MemoryCandidate = {
  id: string;
  kind: string;
  title: string;
  content: string;
  status: string;
  source: string;
  metadata?: Record<string, unknown>;
  created_at?: string | null;
  reviewed_at?: string | null;
};

type MemorySearchResult = {
  title: string;
  source_type: string;
  source_id: string;
  snippet: string;
  score?: number;
  metadata?: Record<string, unknown>;
  retrieval?: Record<string, unknown>;
};

type KnowledgeGraphNode = {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  metadata?: Record<string, unknown>;
  highlighted?: boolean;
};

type KnowledgeGraphEdge = {
  id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  confidence: number;
  source: string;
  metadata?: Record<string, unknown>;
};

type KnowledgeGraphResponse = {
  repo_id: string;
  center_type?: string | null;
  center_id?: string | null;
  depth: number;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  stats: Record<string, unknown>;
};

type AddProjectStatus = {
  type: "success" | "error";
  title: string;
  detail?: string;
};

type AddProjectSource = "remote" | "local";

type PromptSuggestionState = {
  suggestions: string[];
  exclude: string[];
};
const workspaceTabs = ["Issue", "PR", "CI", "Team", "Memory & Knowledge", "Skills & MCP", "Graph"] as const;
type WorkspaceTab = (typeof workspaceTabs)[number];

const DRAFT_CONVERSATION_PREFIX = "draft:";

function makeDraftConversationId(repoId: string) {
  return `${DRAFT_CONVERSATION_PREFIX}${repoId}:${crypto.randomUUID()}`;
}

function isDraftConversationId(value: string) {
  return value.startsWith(DRAFT_CONVERSATION_PREFIX);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function summarizeConversationTitle(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const firstSentence = normalized.split(/[\u3002\uff01\uff1f!?.]/)[0]?.trim() || normalized;
  const title = firstSentence || normalized || "New conversation";
  return title.length > 24 ? `${title.slice(0, 24)}...` : title;
}

function compactJson(value: unknown, maxLength = 900) {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function traceContentFromResult(content: unknown) {
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const record = content as Record<string, unknown>;
    if (typeof record.answer_preview === "string" && record.answer_preview.trim()) {
      return record.answer_preview;
    }
  }
  return compactJson(content);
}

function makeToolUseTrace(data: ChatStreamToolUse, fallbackId: string): ChatTraceItem {
  const toolName = data.tool_name || "tool";
  const args = compactJson(data.arguments, 700);
  return {
    id: data.id || fallbackId,
    kind: "tool",
    title: `Calling tool ${toolName}`,
    content: args ? `Arguments:\n${args}` : "Running...",
    status: "running",
    toolUseId: data.id,
    skillName: data.skill_name,
    skillTitle: data.skill_title,
    skillVersion: data.skill_version,
    skillSteps: data.skill_steps,
    skillActivationMode: data.skill_activation_mode,
    skillActivationReason: data.skill_activation_reason,
    skillInstructionDigest: data.skill_instruction_digest
  };
}

function makeToolResultTrace(data: ChatStreamToolResult, fallbackId: string): ChatTraceItem {
  const toolName = data.tool_name || "tool";
  const failed = data.status === "error";
  const content = data.error || traceContentFromResult(data.content) || data.route || "";
  return {
    id: data.tool_use_id || fallbackId,
    kind: failed ? "error" : "tool",
    title: `${failed ? "Tool failed" : "Tool finished"} ${toolName}`,
    content,
    status: failed ? "error" : "done",
    toolUseId: data.tool_use_id,
    skillName: data.skill_name,
    skillTitle: data.skill_title,
    skillVersion: data.skill_version,
    skillSteps: data.skill_steps,
    skillActivationMode: data.skill_activation_mode,
    skillActivationReason: data.skill_activation_reason,
    skillInstructionDigest: data.skill_instruction_digest
  };
}

function traceItemsFromAgentEvents(events: Array<Record<string, unknown>> = []): ChatTraceItem[] {
  const items: ChatTraceItem[] = [];
  events.forEach((event, index) => {
    const type = String(event.type || "");
    if (type === "skill_activated") {
      const resources = Array.isArray(event.resources) ? event.resources.map((value) => contextRecord(value)) : [];
      items.push({
        id: `history-skill-activated-${index}`,
        kind: "tool",
        title: "Skill activated on demand",
        content: [
          `Mode: ${contextString(event.activation_mode) || "unknown"}`,
          contextString(event.activation_reason) ? `Reason: ${contextString(event.activation_reason)}` : "",
          contextString(event.entrypoint) ? `Entrypoint: ${contextString(event.entrypoint)}` : "",
          contextString(event.instruction_digest) ? `Instruction digest: ${contextString(event.instruction_digest)}` : "",
          resources.length ? `On-demand resources: ${resources.map((resource) => contextString(resource.path)).filter(Boolean).join(", ")}` : ""
        ].filter(Boolean).join("\n"),
        status: "done",
        skillName: contextString(event.skill_name),
        skillTitle: contextString(event.skill_title),
        skillVersion: contextString(event.skill_version),
        skillSteps: Array.isArray(event.workflow_steps) ? event.workflow_steps.map(String) : [],
        skillActivationMode: contextString(event.activation_mode),
        skillActivationReason: contextString(event.activation_reason),
        skillInstructionDigest: contextString(event.instruction_digest)
      });
      return;
    }
    if (type === "skill_validation") {
      const status = contextString(event.status) || "not_executed";
      const failed = status === "violated" || status === "failed";
      const violations = Array.isArray(event.tool_contract_violations) ? event.tool_contract_violations.map(String) : [];
      items.push({
        id: `history-skill-validation-${index}`,
        kind: failed ? "error" : "tool",
        title: status === "violated" ? "Skill contract check failed" : status === "failed" ? "Skill execution failed" : "Skill runtime check",
        content: [
          `Status: ${status}`,
          `Full instructions: ${event.instructions_loaded === true ? "loaded" : "not loaded"}`,
          `Step verification: ${contextString(event.step_verification) || "unknown"}`,
          Array.isArray(event.observed_tools) && event.observed_tools.length ? `Observed tools: ${event.observed_tools.map(String).join(", ")}` : "",
          violations.length ? `Out-of-scope tools: ${violations.join(", ")}` : ""
        ].filter(Boolean).join("\n"),
        status: failed ? "error" : "done",
        skillName: contextString(event.skill_name),
        skillTitle: contextString(event.skill_title),
        skillVersion: contextString(event.skill_version),
        skillSteps: Array.isArray(event.declared_steps) ? event.declared_steps.map(String) : []
      });
      return;
    }
    if (type === "rag_strategy") {
      const preRetrieval = contextRecord(event.pre_retrieval);
      const reasoningRetrieval = contextRecord(event.reasoning_retrieval);
      const enabled = preRetrieval.enabled === true;
      const evidenceCount = contextNumber(preRetrieval.evidence_count);
      const query = contextString(preRetrieval.query);
      const sourceLines = Array.isArray(preRetrieval.sources)
        ? preRetrieval.sources
            .slice(0, 8)
            .map((value) => contextRecord(value))
            .map((source) => {
              const title = contextString(source.title) || "Untitled evidence";
              const sourceType = contextString(source.source_type) || "evidence";
              return `- [${sourceType}] ${title}`;
            })
        : [];
      items.push({
        id: `history-rag-strategy-${index}`,
        kind: "rag_prefetch",
        title: "RAG pre-retrieval",
        content: [
          `Mode: ${contextString(event.mode) === "hybrid_rag" ? "Hybrid RAG" : "Tool calling"}`,
          query ? `Query: ${query}` : "",
          `Pre-call retrieval: ${enabled ? `enabled · ${evidenceCount} pieces of evidence` : "disabled"}`,
          sourceLines.length ? `Evidence sources:\n${sourceLines.join("\n")}` : "",
          `Agent follow-up retrieval: ${reasoningRetrieval.enabled === true ? "available (supports query rewriting and repeated lookups)" : "disabled"}`
        ]
          .filter(Boolean)
          .join("\n"),
        status: "done",
        evidenceCount
      });
      return;
    }
    if (type === "thought" && typeof event.content === "string" && event.content.trim()) {
      items.push({
        id: `history-thought-${index}`,
        kind: "thinking",
        title: "Public reasoning",
        content: event.content,
        status: "done"
      });
      return;
    }
    if (type === "tool_use") {
      items.push(
        makeToolUseTrace(
          {
            id: typeof event.id === "string" ? event.id : `history-tool-${index}`,
            tool_name: typeof event.tool_name === "string" ? event.tool_name : undefined,
            arguments: event.arguments && typeof event.arguments === "object" ? (event.arguments as Record<string, unknown>) : undefined,
            skill_name: typeof event.skill_name === "string" ? event.skill_name : undefined,
            skill_title: typeof event.skill_title === "string" ? event.skill_title : undefined,
            skill_version: typeof event.skill_version === "string" ? event.skill_version : undefined,
            skill_steps: Array.isArray(event.skill_steps) ? event.skill_steps.map(String) : undefined,
            skill_activation_mode: typeof event.skill_activation_mode === "string" ? event.skill_activation_mode : undefined,
            skill_activation_reason: typeof event.skill_activation_reason === "string" ? event.skill_activation_reason : undefined,
            skill_instruction_digest: typeof event.skill_instruction_digest === "string" ? event.skill_instruction_digest : undefined
          },
          `history-tool-${index}`
        )
      );
      return;
    }
    if (type === "tool_result") {
      const result = makeToolResultTrace(
        {
          tool_use_id: typeof event.tool_use_id === "string" ? event.tool_use_id : undefined,
          tool_name: typeof event.tool_name === "string" ? event.tool_name : undefined,
          status: typeof event.status === "string" ? event.status : undefined,
          route: typeof event.route === "string" ? event.route : undefined,
          content: event.content,
          skill_name: typeof event.skill_name === "string" ? event.skill_name : undefined,
          skill_title: typeof event.skill_title === "string" ? event.skill_title : undefined,
          skill_version: typeof event.skill_version === "string" ? event.skill_version : undefined,
          skill_steps: Array.isArray(event.skill_steps) ? event.skill_steps.map(String) : undefined,
          skill_activation_mode: typeof event.skill_activation_mode === "string" ? event.skill_activation_mode : undefined,
          skill_activation_reason: typeof event.skill_activation_reason === "string" ? event.skill_activation_reason : undefined,
          skill_instruction_digest: typeof event.skill_instruction_digest === "string" ? event.skill_instruction_digest : undefined
        },
        `history-result-${index}`
      );
      const existingIndex = result.toolUseId ? items.findIndex((item) => item.toolUseId === result.toolUseId) : -1;
      if (existingIndex >= 0) {
        items[existingIndex] = { ...items[existingIndex], ...result, id: items[existingIndex].id };
      } else {
        items.push(result);
      }
      return;
    }
    if (type === "workflow_replan") {
      const addedTasks = Array.isArray(event.added_tasks) ? event.added_tasks.map(String).filter(Boolean) : [];
      items.push({
        id: `history-workflow-replan-${index}`,
        kind: "tool",
        title: "Planner replanning",
        content: [
          typeof event.reason === "string" ? event.reason : "",
          addedTasks.length ? `Added tasks: ${addedTasks.join(", ")}` : ""
        ]
          .filter(Boolean)
          .join("\n"),
        status: "done"
      });
      return;
    }
    if (type === "workflow_task_result") {
      const status = typeof event.status === "string" ? event.status : "done";
      const failed = status === "error";
      items.push({
        id: `history-workflow-task-${index}`,
        kind: failed ? "error" : "tool",
        title: `${failed ? "Task failed" : "Task finished"} ${typeof event.task_type === "string" ? event.task_type : "workflow"}`,
        content: typeof event.summary === "string" ? event.summary : "",
        status: failed ? "error" : "done",
        skillName: contextString(event.skill_name),
        skillTitle: contextString(event.skill_title),
        skillVersion: contextString(event.skill_version),
        skillSteps: Array.isArray(event.skill_steps) ? event.skill_steps.map(String) : [],
        skillActivationMode: contextString(event.skill_activation_mode),
        skillActivationReason: contextString(event.skill_activation_reason),
        skillInstructionDigest: contextString(event.skill_instruction_digest)
      });
      return;
    }
    if (type === "workflow_observer_result") {
      const findings = Array.isArray(event.findings) ? event.findings.length : 0;
      items.push({
        id: `history-workflow-observer-${index}`,
        kind: "thinking",
        title: "Observer check",
        content: `confidence=${event.overall_confidence ?? "-"}, findings=${findings}`,
        status: "done"
      });
    }
  });
  return items;
}

function finalizedTraceItems(
  events: Array<Record<string, unknown>> | undefined,
  fallback: ChatTraceItem[] | undefined
) {
  const finalized = traceItemsFromAgentEvents(events ?? []);
  return finalized.length > 0 ? finalized : fallback ?? [];
}

function formatRelativeTime(value?: string | null) {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";
  const diffMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} min`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} h`;
  return `${Math.floor(diffMs / day)} d`;
}

const issueCategoryMeta = [
  { key: "unanswered", label: "Unanswered", color: "text-[#f47b5b]" },
  { key: "discussing", label: "Discussing", color: "text-[#38a7f4]" },
  { key: "decision", label: "Needs decision", color: "text-[#f08a00]" },
  { key: "accepted", label: "Handled", color: "text-[#20a35b]" },
  { key: "rejected", label: "Rejected", color: "text-[#6b7280]" },
  { key: "closed", label: "Closed", color: "text-[#7c8794]" }
] as const;

const prCategoryMeta = [
  { key: "reviewing", label: "In review", color: "text-[#38a7f4]" },
  { key: "needsOwner", label: "Needs reviewer", color: "text-[#f08a00]" },
  { key: "conflict", label: "Conflicts", color: "text-[#f47b5b]" },
  { key: "done", label: "Done", color: "text-[#20a35b]" },
  { key: "rejected", label: "Rejected", color: "text-[#6b7280]" }
] as const;

export default function DashboardPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [conversationMap, setConversationMap] = useState<Record<string, ProjectConversation[]>>({});
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [expandedRepoIds, setExpandedRepoIds] = useState<Record<string, boolean>>({});
  const [issues, setIssues] = useState<Issue[]>([]);
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("Issue");
  const [workspaceWidth, setWorkspaceWidth] = useState(420);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("all");
  const [workspaceOwner, setWorkspaceOwner] = useState("all");
  const [workspaceTime, setWorkspaceTime] = useState("all");
  const [selectedWorkspaceItem, setSelectedWorkspaceItem] = useState<WorkspaceSelection | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [memberDraft, setMemberDraft] = useState<TeamMemberDraft>({ name: "", role: "", strengths: "", techStack: "" });
  const [memoryNotes, setMemoryNotes] = useState<MemoryNote[]>([]);
  const [memoryDraft, setMemoryDraft] = useState<MemoryNoteDraft>({ title: "", content: "" });
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [uploadingKnowledge, setUploadingKnowledge] = useState(false);
  const [mcpRuntime, setMcpRuntime] = useState<McpRuntime | null>(null);
  const [skills, setSkills] = useState<SkillResponse[]>([]);
  const [selectedSkillName, setSelectedSkillName] = useState("project-investigation");
  const [skillRuntimeLoading, setSkillRuntimeLoading] = useState(false);
  const [skillRuntimeError, setSkillRuntimeError] = useState<string | null>(null);
  const [projectIndexByRepo, setProjectIndexByRepo] = useState<Record<string, ProjectIndexState>>({});
  const [indexScanningRepoId, setIndexScanningRepoId] = useState<string | null>(null);
  const [indexActionError, setIndexActionError] = useState<string | null>(null);
  const [knowledgeGraphByRepo, setKnowledgeGraphByRepo] = useState<Record<string, KnowledgeGraphResponse | null>>({});
  const [graphLoadingRepoId, setGraphLoadingRepoId] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphQuery, setGraphQuery] = useState("");
  const [selectedGraphNodeKey, setSelectedGraphNodeKey] = useState<string | null>(null);
  const [hiddenGraphNodeTypes, setHiddenGraphNodeTypes] = useState<Record<string, boolean>>({});
  const [hiddenGraphRelations, setHiddenGraphRelations] = useState<Record<string, boolean>>({});
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [projectSource, setProjectSource] = useState<AddProjectSource>("remote");
  const [projectUrl, setProjectUrl] = useState("");
  const [projectLocalPath, setProjectLocalPath] = useState("");
  const [projectCloneParentDir, setProjectCloneParentDir] = useState("");
  const [projectProvider, setProjectProvider] = useState("github");
  const [projectApiBaseUrl, setProjectApiBaseUrl] = useState("https://api.github.com");
  const [projectToken, setProjectToken] = useState("");
  const [addProjectStatus, setAddProjectStatus] = useState<AddProjectStatus | null>(null);
  const [connectingProject, setConnectingProject] = useState(false);
  const [loading, setLoading] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [promptStateByRepo, setPromptStateByRepo] = useState<Record<string, PromptSuggestionState>>({});
  const [loadingPromptRepoId, setLoadingPromptRepoId] = useState<string | null>(null);
  const [promptLoadingDots, setPromptLoadingDots] = useState(".");
  const [issueAnalysisById, setIssueAnalysisById] = useState<Record<string, IssueAnalysisResponse>>({});
  const [issueAnalysisTraceById, setIssueAnalysisTraceById] = useState<Record<string, IssueAnalysisTraceItem[]>>({});
  const [analysisModalIssueId, setAnalysisModalIssueId] = useState<string | null>(null);
  const [analyzingIssueId, setAnalyzingIssueId] = useState<string | null>(null);
  const [issueAnalysisError, setIssueAnalysisError] = useState<string | null>(null);
  const [prAnalysisById, setPrAnalysisById] = useState<Record<string, PRAnalysisResponse>>({});
  const [prAnalysisTraceById, setPrAnalysisTraceById] = useState<Record<string, IssueAnalysisTraceItem[]>>({});
  const [analysisModalPrId, setAnalysisModalPrId] = useState<string | null>(null);
  const [analyzingPrId, setAnalyzingPrId] = useState<string | null>(null);
  const [prAnalysisError, setPrAnalysisError] = useState<string | null>(null);
  const [ciAnalysisById, setCiAnalysisById] = useState<Record<string, CIAnalysisResponse>>({});
  const [ciAnalysisTraceById, setCiAnalysisTraceById] = useState<Record<string, IssueAnalysisTraceItem[]>>({});
  const [analysisModalRunId, setAnalysisModalRunId] = useState<string | null>(null);
  const [analyzingRunId, setAnalyzingRunId] = useState<string | null>(null);
  const [ciAnalysisError, setCiAnalysisError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const skipHistoryLoadRef = useRef(false);
  const preserveWorkspaceSelectionRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const promptRowRef = useRef<HTMLDivElement>(null);
  const promptMeasureRef = useRef<HTMLDivElement>(null);
  const [visiblePromptCount, setVisiblePromptCount] = useState(5);

  const selectedRepo = useMemo(() => repos.find((repo) => repo.id === selectedRepoId) ?? repos[0], [repos, selectedRepoId]);
  const selectedRepoConversations = selectedRepo ? conversationMap[selectedRepo.id] ?? [] : [];
  const isDraftConversation = isDraftConversationId(selectedConversationId);
  const selectedConversation = isDraftConversation
    ? undefined
    : selectedRepoConversations.find((item) => item.id === selectedConversationId) ?? selectedRepoConversations[0];
  const selectedPromptState = selectedRepo ? promptStateByRepo[selectedRepo.id] : undefined;
  const selectedProjectIndexState = selectedRepo ? projectIndexByRepo[selectedRepo.id] : undefined;
  const selectedKnowledgeGraph = selectedRepo ? knowledgeGraphByRepo[selectedRepo.id] : null;
  const promptSuggestions = selectedPromptState?.suggestions ?? [];
  const promptExclude = selectedPromptState?.exclude ?? [];
  const loadingPrompts = Boolean(selectedRepo?.id && loadingPromptRepoId === selectedRepo.id);

  async function loadRepos() {
    const items = await apiGet<Repository[]>("/api/repos");
    setRepos(items);
    const pairs = await Promise.all(
      items.map(async (repo) => [repo.id, await apiGet<ProjectConversation[]>(`/api/repos/${repo.id}/conversations`).catch(() => [])] as const)
    );
    const nextMap = Object.fromEntries(pairs);
    setConversationMap(nextMap);
    setExpandedRepoIds((current) => {
      const firstRepoId = items[0]?.id;
      return firstRepoId && Object.keys(current).length === 0 ? { [firstRepoId]: true } : current;
    });
    setSelectedRepoId((current) => current || items[0]?.id || "");
    setSelectedConversationId((current) => current || (items[0] ? nextMap[items[0].id]?.[0]?.id ?? "" : ""));
  }

  async function loadRepoConversations(repoId: string) {
    const conversations = await apiGet<ProjectConversation[]>(`/api/repos/${repoId}/conversations`).catch(() => []);
    setConversationMap((items) => ({ ...items, [repoId]: conversations }));
    return conversations;
  }

  async function loadRepoData(repoId: string) {
    const [issueItems, prItems, runItems] = await Promise.all([
      apiGet<Issue[]>(`/api/repos/${repoId}/issues`).catch(() => []),
      apiGet<PullRequest[]>(`/api/repos/${repoId}/pull-requests`).catch(() => []),
      apiGet<WorkflowRun[]>(`/api/repos/${repoId}/workflow-runs`).catch(() => [])
    ]);
    setIssues(issueItems);
    setPrs(prItems);
    setRuns(runItems);
  }

  async function loadSkillRuntime() {
    setSkillRuntimeLoading(true);
    setSkillRuntimeError(null);
    try {
      const [skillList, runtime] = await Promise.all([
        apiGet<{ skills: SkillResponse[] }>("/api/skills"),
        apiGet<McpRuntime>("/api/skills/mcp-status")
      ]);
      setSkills(skillList.skills);
      setMcpRuntime(runtime);
      setSelectedSkillName((current) =>
        skillList.skills.some((item) => item.manifest.name === current)
          ? current
          : skillList.skills[0]?.manifest.name ?? ""
      );
    } catch (error) {
      setSkillRuntimeError(getFriendlyError(error));
    } finally {
      setSkillRuntimeLoading(false);
    }
  }

  async function loadPromptSuggestions(repoId: string, exclude: string[] = []) {
    setLoadingPromptRepoId(repoId);
    try {
      const result = await apiPost<PromptRecommendationsResponse>("/api/chat/recommendations", {
        repo_id: repoId,
        exclude,
        limit: 5
      });
      const nextSuggestions = result.suggestions;
      setPromptStateByRepo((items) => {
        const current = items[repoId] ?? { suggestions: [], exclude: [] };
        return {
          ...items,
          [repoId]: {
            ...current,
            suggestions: nextSuggestions.length ? nextSuggestions : current.suggestions,
            exclude: nextSuggestions.length ? [...exclude, ...nextSuggestions] : []
          }
        };
      });
    } catch {
      setPromptStateByRepo((items) => {
        const current = items[repoId] ?? { suggestions: [], exclude: [] };
        return {
          ...items,
          [repoId]: {
            ...current,
            exclude
          }
        };
      });
    } finally {
      setLoadingPromptRepoId((current) => (current === repoId ? null : current));
    }
  }

  async function analyzeIssue(issue: Issue) {
    setAnalysisModalIssueId(issue.id);
    setIssueAnalysisError(null);
    setIssueAnalysisById((items) => {
      const next = { ...items };
      delete next[issue.id];
      return next;
    });
    setIssueAnalysisTraceById((items) => ({
      ...items,
      [issue.id]: [
        {
          id: `${Date.now()}-start`,
          kind: "step",
          title: "Preparing analysis",
          content: `Preparing to analyze Issue #${issue.number}; the visible analysis process will be streamed.`,
          status: "running"
        }
      ]
    }));
    setAnalyzingIssueId(issue.id);
    try {
      const conversationQuery = selectedConversation?.id && !isDraftConversation ? `?conversation_id=${selectedConversation.id}` : "";
      await apiPostStream(
        `/api/issues/${issue.id}/analyze/stream${conversationQuery}`,
        {},
        (event, data) => {
          if (event === "trace") {
            const payload = data as Omit<IssueAnalysisTraceItem, "id">;
            const item: IssueAnalysisTraceItem = { id: `${Date.now()}-${Math.random()}`, ...payload };
            setIssueAnalysisTraceById((items) => ({
              ...items,
              [issue.id]: [...(items[issue.id] ?? []), item]
            }));
            return;
          }
          if (event === "thinking_delta") {
            const payload = data as { content?: string };
            const content = payload.content ?? "";
            if (!content) return;
            setIssueAnalysisTraceById((items) => {
              const current = items[issue.id] ?? [];
              const last = current[current.length - 1];
              if (last?.kind === "thinking" && last.status === "running") {
                return {
                  ...items,
                  [issue.id]: [...current.slice(0, -1), { ...last, content: `${last.content}${content}` }]
                };
              }
              return {
                ...items,
                [issue.id]: [
                  ...current,
                  {
                    id: `${Date.now()}-${Math.random()}`,
                    kind: "thinking",
                    title: "LLM public analysis",
                    content,
                    status: "running"
                  }
                ]
              };
            });
            return;
          }
          if (event === "final") {
            const result = data as IssueAnalysisResponse;
            setIssueAnalysisById((items) => ({ ...items, [issue.id]: result }));
            setIssueAnalysisTraceById((items) => {
              const current = (items[issue.id] ?? []).map((item) => (item.kind === "thinking" ? { ...item, status: "done" } : item));
              return {
                ...items,
                [issue.id]: [
                  ...current,
                  {
                    id: `${Date.now()}-final`,
                    kind: "result",
                    title: "Analysis complete",
                    content: `Structured result generated: ${result.result.conclusion}, priority ${result.result.priority}, complexity ${result.result.complexity}.`,
                    status: "done"
                  }
                ]
              };
            });
            return;
          }
          if (event === "error") {
            const payload = data as { message?: string };
            const message = payload.message || "Analysis failed";
            setIssueAnalysisError(message);
            setIssueAnalysisTraceById((items) => ({
              ...items,
              [issue.id]: [
                ...(items[issue.id] ?? []),
                { id: `${Date.now()}-error`, kind: "error", title: "Analysis failed", content: message, status: "error" }
              ]
            }));
          }
        }
      );
    } catch (error) {
      setIssueAnalysisError(getFriendlyError(error));
      setIssueAnalysisTraceById((items) => ({
        ...items,
        [issue.id]: [
          ...(items[issue.id] ?? []),
          { id: `${Date.now()}-error`, kind: "error", title: "Request failed", content: getFriendlyError(error), status: "error" }
        ]
      }));
    } finally {
      setAnalyzingIssueId((current) => (current === issue.id ? null : current));
    }
  }

  async function analyzePr(pr: PullRequest) {
    setAnalysisModalPrId(pr.id);
    setPrAnalysisError(null);
    setPrAnalysisById((items) => {
      const next = { ...items };
      delete next[pr.id];
      return next;
    });
    setPrAnalysisTraceById((items) => ({
      ...items,
      [pr.id]: [
        {
          id: `${Date.now()}-start`,
          kind: "step",
          title: "Preparing analysis",
          content: `Preparing to analyze PR #${pr.number}; the review plan, execution process and merge recommendation will be shown plan-and-execute style.`,
          status: "running"
        }
      ]
    }));
    setAnalyzingPrId(pr.id);
    try {
      const conversationQuery = selectedConversation?.id && !isDraftConversation ? `?conversation_id=${selectedConversation.id}` : "";
      await apiPostStream(
        `/api/pull-requests/${pr.id}/analyze/stream${conversationQuery}`,
        {},
        (event, data) => {
          if (event === "trace") {
            const payload = data as Omit<IssueAnalysisTraceItem, "id">;
            const item: IssueAnalysisTraceItem = { id: `${Date.now()}-${Math.random()}`, ...payload };
            setPrAnalysisTraceById((items) => ({
              ...items,
              [pr.id]: [...(items[pr.id] ?? []), item]
            }));
            return;
          }
          if (event === "thinking_delta") {
            const payload = data as { content?: string };
            const content = payload.content ?? "";
            if (!content) return;
            setPrAnalysisTraceById((items) => {
              const current = items[pr.id] ?? [];
              const last = current[current.length - 1];
              if (last?.kind === "thinking" && last.status === "running") {
                return {
                  ...items,
                  [pr.id]: [...current.slice(0, -1), { ...last, content: `${last.content}${content}` }]
                };
              }
              return {
                ...items,
                [pr.id]: [
                  ...current,
                  {
                    id: `${Date.now()}-${Math.random()}`,
                    kind: "thinking",
                    title: "LLM public execution process",
                    content,
                    status: "running"
                  }
                ]
              };
            });
            return;
          }
          if (event === "final") {
            const result = data as PRAnalysisResponse;
            setPrAnalysisById((items) => ({ ...items, [pr.id]: result }));
            setPrAnalysisTraceById((items) => {
              const current = (items[pr.id] ?? []).map((item) => (item.kind === "thinking" ? { ...item, status: "done" } : item));
              return {
                ...items,
                [pr.id]: [
                  ...current,
                  {
                    id: `${Date.now()}-final`,
                    kind: "result",
                    title: "Analysis complete",
                    content: `PR merge recommendation generated: ${result.result.merge_recommendation}, ${(result.result.risk_points ?? []).length} risk points, ${(result.result.blocking_issues ?? []).length} blockers.`,
                    status: "done"
                  }
                ]
              };
            });
            return;
          }
          if (event === "error") {
            const payload = data as { message?: string };
            const message = payload.message || "Analysis failed";
            setPrAnalysisError(message);
            setPrAnalysisTraceById((items) => ({
              ...items,
              [pr.id]: [
                ...(items[pr.id] ?? []),
                { id: `${Date.now()}-error`, kind: "error", title: "Analysis failed", content: message, status: "error" }
              ]
            }));
          }
        }
      );
    } catch (error) {
      setPrAnalysisError(getFriendlyError(error));
      setPrAnalysisTraceById((items) => ({
        ...items,
        [pr.id]: [
          ...(items[pr.id] ?? []),
          { id: `${Date.now()}-error`, kind: "error", title: "Request failed", content: getFriendlyError(error), status: "error" }
        ]
      }));
    } finally {
      setAnalyzingPrId((current) => (current === pr.id ? null : current));
    }
  }

  async function analyzeCi(run: WorkflowRun) {
    setAnalysisModalRunId(run.id);
    setCiAnalysisError(null);
    setCiAnalysisById((items) => {
      const next = { ...items };
      delete next[run.id];
      return next;
    });
    setCiAnalysisTraceById((items) => ({
      ...items,
      [run.id]: [
        {
          id: `${Date.now()}-start`,
          kind: "step",
          title: "Preparing investigation",
          content: `Preparing to investigate CI "${run.name}"; the debugging plan, execution process, root cause and blocking assessment will be shown plan-and-execute style.`,
          status: "running"
        }
      ]
    }));
    setAnalyzingRunId(run.id);
    try {
      const conversationQuery = selectedConversation?.id && !isDraftConversation ? `?conversation_id=${selectedConversation.id}` : "";
      await apiPostStream(
        `/api/workflow-runs/${run.id}/analyze/stream${conversationQuery}`,
        {},
        (event, data) => {
          if (event === "trace") {
            const payload = data as Omit<IssueAnalysisTraceItem, "id">;
            const item: IssueAnalysisTraceItem = { id: `${Date.now()}-${Math.random()}`, ...payload };
            setCiAnalysisTraceById((items) => ({
              ...items,
              [run.id]: [...(items[run.id] ?? []), item]
            }));
            return;
          }
          if (event === "thinking_delta") {
            const payload = data as { content?: string };
            const content = payload.content ?? "";
            if (!content) return;
            setCiAnalysisTraceById((items) => {
              const current = items[run.id] ?? [];
              const last = current[current.length - 1];
              if (last?.kind === "thinking" && last.status === "running") {
                return {
                  ...items,
                  [run.id]: [...current.slice(0, -1), { ...last, content: `${last.content}${content}` }]
                };
              }
              return {
                ...items,
                [run.id]: [
                  ...current,
                  {
                    id: `${Date.now()}-${Math.random()}`,
                    kind: "thinking",
                    title: "LLM public debugging process",
                    content,
                    status: "running"
                  }
                ]
              };
            });
            return;
          }
          if (event === "final") {
            const result = data as CIAnalysisResponse;
            setCiAnalysisById((items) => ({ ...items, [run.id]: result }));
            setCiAnalysisTraceById((items) => {
              const current = (items[run.id] ?? []).map((item) => (item.kind === "thinking" ? { ...item, status: "done" } : item));
              return {
                ...items,
                [run.id]: [
                  ...current,
                  {
                    id: `${Date.now()}-final`,
                    kind: "result",
                    title: "Investigation complete",
                    content: `CI root-cause assessment generated: ${result.result.failure_type}; ${result.result.is_merge_blocking ? "blocks merge" : "does not block merge"}.`,
                    status: "done"
                  }
                ]
              };
            });
            return;
          }
          if (event === "error") {
            const payload = data as { message?: string };
            const message = payload.message || "Analysis failed";
            setCiAnalysisError(message);
            setCiAnalysisTraceById((items) => ({
              ...items,
              [run.id]: [
                ...(items[run.id] ?? []),
                { id: `${Date.now()}-error`, kind: "error", title: "Investigation failed", content: message, status: "error" }
              ]
            }));
          }
        }
      );
    } catch (error) {
      setCiAnalysisError(getFriendlyError(error));
      setCiAnalysisTraceById((items) => ({
        ...items,
        [run.id]: [
          ...(items[run.id] ?? []),
          { id: `${Date.now()}-error`, kind: "error", title: "Request failed", content: getFriendlyError(error), status: "error" }
        ]
      }));
    } finally {
      setAnalyzingRunId((current) => (current === run.id ? null : current));
    }
  }

  async function loadProjectKnowledge(repoId: string) {
    const [members, knowledge] = await Promise.all([
      apiGet<TeamMember[]>(`/api/repos/${repoId}/team-members`).catch(() => []),
      apiGet<KnowledgeItem[]>(`/api/repos/${repoId}/knowledge`).catch(() => [])
    ]);
    setTeamMembers(members);
    setKnowledgeItems(knowledge);
    setMemoryNotes(
      knowledge
        .filter((item) => item.source_type === "memory_note")
        .map((item) => ({
          id: item.id,
          title: item.title,
          content: item.content_preview
      }))
    );
  }

  async function loadProjectIndexState(repoId: string) {
    const state = await apiGet<ProjectIndexState>(`/api/repos/${repoId}/memory-index/state`).catch(() => null);
    if (state) {
      setProjectIndexByRepo((items) => ({ ...items, [repoId]: state }));
    }
    return state;
  }

  async function loadKnowledgeGraph(repoId: string, center?: { type: string; id: string }) {
    setGraphLoadingRepoId(repoId);
    setGraphError(null);
    try {
      const params = new URLSearchParams({ depth: "1" });
      if (center?.type && center.id) {
        params.set("center_type", center.type);
        params.set("center_id", center.id);
      }
      const graph = await apiGet<KnowledgeGraphResponse>(`/api/repos/${repoId}/knowledge/graph?${params.toString()}`);
      setKnowledgeGraphByRepo((items) => ({ ...items, [repoId]: graph }));
      const preferred = center ? graph.nodes.find((node) => node.type === center.type && node.id === center.id) : graph.nodes[0];
      setSelectedGraphNodeKey(preferred ? knowledgeGraphNodeKey(preferred) : null);
      return graph;
    } catch (error) {
      setGraphError(getFriendlyError(error));
      setKnowledgeGraphByRepo((items) => ({ ...items, [repoId]: null }));
      return null;
    } finally {
      setGraphLoadingRepoId((current) => (current === repoId ? null : current));
    }
  }

  async function rebuildSelectedKnowledgeGraph() {
    if (!selectedRepo) return;
    setGraphLoadingRepoId(selectedRepo.id);
    setGraphError(null);
    try {
      await apiPost(`/api/repos/${selectedRepo.id}/knowledge/graph/rebuild`, {});
      await loadKnowledgeGraph(selectedRepo.id);
    } catch (error) {
      setGraphError(getFriendlyError(error));
    } finally {
      setGraphLoadingRepoId((current) => (current === selectedRepo.id ? null : current));
    }
  }

  async function startProjectIndexScan() {
    if (!selectedRepo) return;
    const repoId = selectedRepo.id;
    setIndexActionError(null);
    setIndexScanningRepoId(repoId);
    setProjectIndexByRepo((items) => ({
      ...items,
      [repoId]: {
        repo_id: repoId,
        status: "building",
        fingerprint: items[repoId]?.fingerprint ?? "",
        docs_indexed: items[repoId]?.docs_indexed ?? 0,
        docs_total: items[repoId]?.docs_total ?? 0,
        error_message: null,
        summary_json: items[repoId]?.summary_json ?? null,
        snoozed_until: null,
        last_scan_at: items[repoId]?.last_scan_at ?? null
      }
    }));
    try {
      await apiPost(`/api/repos/${repoId}/memory-index/scan`, {});
      let latest: ProjectIndexState | null = null;
      for (let attempt = 0; attempt < 45; attempt += 1) {
        await wait(1200);
        latest = await loadProjectIndexState(repoId);
        if (!latest || latest.status !== "building") break;
      }
      if (latest?.status === "ready") {
        await loadProjectKnowledge(repoId);
        await loadKnowledgeGraph(repoId);
      }
      if (latest?.status === "failed") {
        setIndexActionError(latest.error_message || "Memory index scan failed");
      }
    } catch (error) {
      setIndexActionError(getFriendlyError(error));
      await loadProjectIndexState(repoId);
    } finally {
      setIndexScanningRepoId((current) => (current === repoId ? null : current));
    }
  }

  async function snoozeProjectIndexPrompt() {
    if (!selectedRepo) return;
    const repoId = selectedRepo.id;
    try {
      await apiPost(`/api/repos/${repoId}/memory-index/snooze`, { days: 7 });
      await loadProjectIndexState(repoId);
    } catch (error) {
      setIndexActionError(getFriendlyError(error));
    }
  }

  function welcomeMessage(repo: Repository, conversation?: ProjectConversation): ChatMessage {
    return {
      id: `welcome-${repo.id}-${conversation?.id ?? "default"}`,
      role: "assistant",
      content: `Switched to repository ${repo.full_name}${conversation ? ` / ${conversation.title}` : ""}. Ask me anything about issues, PRs, CI or weekly reports.`
    };
  }

  async function loadChatHistory(repo: Repository, conversation: ProjectConversation) {
    async function loadCompleteHistory() {
      const pageSize = 500;
      const history: ChatHistoryMessage[] = [];
      let beforeMessageId: string | undefined;
      while (true) {
        const cursor = beforeMessageId ? `&before_message_id=${beforeMessageId}` : "";
        const page = await apiGet<ChatHistoryMessage[]>(
          `/api/chat/history?repo_id=${repo.id}&conversation_id=${conversation.id}&limit=${pageSize}${cursor}`
        );
        history.unshift(...page);
        if (page.length < pageSize) break;
        const nextCursor = page[0]?.id;
        if (!nextCursor || nextCursor === beforeMessageId) break;
        beforeMessageId = nextCursor;
      }
      return history;
    }

    const [history, feedbackRows] = await Promise.all([
      loadCompleteHistory(),
      apiGet<ChatFeedbackRecord[]>(`/api/chat/feedback?repo_id=${repo.id}&conversation_id=${conversation.id}&limit=200`)
    ]);
    if (!history.length) {
      setMessages([welcomeMessage(repo, conversation)]);
      return;
    }
    const feedbackByMessage = new Map(feedbackRows.map((item) => [item.assistant_message_id, item]));
    setMessages(
      history
        .filter((item) => item.role === "user" || item.role === "assistant")
        .map((item) => ({
          id: item.id,
          messageId: item.id,
          role: item.role,
          content: item.content,
          route: item.route ?? undefined,
          toolCalls: item.tool_calls ?? [],
          traceItems: traceItemsFromAgentEvents(item.agent_events ?? []),
          traceCollapsed: true,
          compressionStats: item.compression_stats,
          progressiveCompaction: item.progressive_compaction,
          modelUsage: item.model_usage,
          contextDiagnostics: item.context_diagnostics,
          contextCollapsed: true,
          responsePending: false,
          feedback: feedbackByMessage.get(item.id)
        }))
    );
  }

  useEffect(() => {
    loadRepos().catch(() => setRepos([]));
  }, []);

  useEffect(() => {
    if (workspaceTab === "Skills & MCP" && !mcpRuntime && !skillRuntimeLoading) {
      void loadSkillRuntime();
    }
  }, [workspaceTab]);

  useEffect(() => {
    if (selectedRepo?.id) {
      loadRepoData(selectedRepo.id);
      loadProjectKnowledge(selectedRepo.id);
      loadProjectIndexState(selectedRepo.id);
      loadKnowledgeGraph(selectedRepo.id);
      if (!promptStateByRepo[selectedRepo.id]) {
        loadPromptSuggestions(selectedRepo.id).catch(() => undefined);
      }
    } else {
      setTeamMembers([]);
      setMemoryNotes([]);
      setKnowledgeItems([]);
      setKnowledgeGraphByRepo({});
      setSelectedGraphNodeKey(null);
      setMessages([]);
    }
  }, [selectedRepo?.id]);

  useEffect(() => {
    if (!loadingPrompts) {
      setPromptLoadingDots(".");
      return;
    }
    const timer = window.setInterval(() => {
      setPromptLoadingDots((current) => (current.length >= 3 ? "." : `${current}.`));
    }, 360);
    return () => window.clearInterval(timer);
  }, [loadingPrompts]);

  useEffect(() => {
    if (!selectedRepo?.id) return;
    if (isDraftConversation) return;
    const conversations = conversationMap[selectedRepo.id] ?? [];
    if (conversations.length === 0) {
      loadRepoConversations(selectedRepo.id).then((items) => {
        setSelectedConversationId((current) => (items.some((item) => item.id === current) ? current : items[0]?.id || ""));
      });
      return;
    }
    if (!conversations.some((item) => item.id === selectedConversationId)) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [selectedRepo?.id, conversationMap, selectedConversationId, isDraftConversation]);

  useEffect(() => {
    if (isDraftConversation) return;
    if (skipHistoryLoadRef.current) {
      skipHistoryLoadRef.current = false;
      return;
    }
    if (selectedRepo?.id && selectedConversation?.id) {
      loadChatHistory(selectedRepo, selectedConversation).catch(() => setMessages([welcomeMessage(selectedRepo, selectedConversation)]));
    }
  }, [selectedRepo?.id, selectedConversation?.id, isDraftConversation]);

  useEffect(() => {
    setWorkspaceQuery("");
    setWorkspaceStatus("all");
    setWorkspaceOwner("all");
    setWorkspaceTime("all");
    if (preserveWorkspaceSelectionRef.current) {
      preserveWorkspaceSelectionRef.current = false;
    } else {
      setSelectedWorkspaceItem(null);
    }
    setGraphQuery("");
    setHiddenGraphNodeTypes({});
    setHiddenGraphRelations({});
    setAnalysisModalIssueId(null);
    setIssueAnalysisError(null);
    setAnalysisModalPrId(null);
    setPrAnalysisError(null);
    setAnalysisModalRunId(null);
    setCiAnalysisError(null);
    setCollapsedGroups({});
  }, [selectedRepo?.id, workspaceTab]);

  useEffect(() => {
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: loading ? "smooth" : "auto" });
  }, [messages, loading]);

  useEffect(() => {
    if (promptSuggestions.length === 0) {
      setVisiblePromptCount(5);
      return;
    }

    function updateVisiblePromptCount() {
      const row = promptRowRef.current;
      const measure = promptMeasureRef.current;
      if (!row || !measure) return;
      const rowWidth = row.clientWidth;
      const chips = Array.from(measure.querySelectorAll<HTMLButtonElement>("[data-prompt-chip-measure]"));
      if (!rowWidth || chips.length === 0) return;

      const gap = 8;
      let usedWidth = 0;
      let nextCount = 0;
      for (const chip of chips) {
        const chipWidth = Math.ceil(chip.getBoundingClientRect().width);
        const widthWithGap = chipWidth + (nextCount > 0 ? gap : 0);
        if (nextCount === 0 || usedWidth + widthWithGap <= rowWidth) {
          usedWidth += widthWithGap;
          nextCount += 1;
          continue;
        }
        break;
      }
      setVisiblePromptCount(Math.min(promptSuggestions.length, Math.max(1, nextCount)));
    }

    const frame = window.requestAnimationFrame(updateVisiblePromptCount);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && promptRowRef.current) {
      observer = new ResizeObserver(updateVisiblePromptCount);
      observer.observe(promptRowRef.current);
    }
    window.addEventListener("resize", updateVisiblePromptCount);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", updateVisiblePromptCount);
    };
  }, [promptSuggestions, loadingPrompts]);

  function startResize(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = workspaceWidth;

    function onMove(moveEvent: globalThis.MouseEvent) {
      const delta = startX - moveEvent.clientX;
      setWorkspaceWidth(Math.min(640, Math.max(360, startWidth + delta)));
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function toggleCategory(key: string) {
    setCollapsedGroups((items) => ({ ...items, [key]: !items[key] }));
  }

  async function selectProject(repo: Repository) {
    setSelectedRepoId(repo.id);
    setExpandedRepoIds((items) => ({ ...items, [repo.id]: !items[repo.id] }));
    const conversations = conversationMap[repo.id]?.length ? conversationMap[repo.id] : await loadRepoConversations(repo.id);
    setSelectedConversationId((current) => (conversations.some((item) => item.id === current) ? current : conversations[0]?.id || ""));
  }

  async function selectConversation(repo: Repository, conversation: ProjectConversation) {
    setSelectedRepoId(repo.id);
    setExpandedRepoIds((items) => ({ ...items, [repo.id]: true }));
    setSelectedConversationId(conversation.id);
    await apiPost(`/api/repos/${repo.id}/select`, {});
  }

  async function addConversation(repo: Repository) {
    setExpandedRepoIds((items) => ({ ...items, [repo.id]: true }));
    setSelectedRepoId(repo.id);
    setSelectedConversationId(makeDraftConversationId(repo.id));
    setMessages([]);
    setMessage("");
  }

  async function removeConversation(repo: Repository, conversation: ProjectConversation) {
    const confirmed = window.confirm(`Delete conversation "${conversation.title}"?\n\nOnly this conversation's chat context will be deleted; the project knowledge base is kept.`);
    if (!confirmed) return;
    const result = await apiDelete<ConversationDeleteResult>(`/api/repos/${repo.id}/conversations/${conversation.id}`);
    setConversationMap((items) => ({ ...items, [repo.id]: result.conversations }));
    if (selectedConversationId === conversation.id) {
      setSelectedRepoId(repo.id);
      setSelectedConversationId(result.active_conversation_id);
    }
  }

  async function addTeamMember() {
    if (!selectedRepo || !memberDraft.name.trim()) return;
    const created = await apiPost<TeamMember>(`/api/repos/${selectedRepo.id}/team-members`, {
      name: memberDraft.name.trim(),
      role: memberDraft.role.trim(),
      strengths: memberDraft.strengths.trim(),
      techStack: memberDraft.techStack.trim()
    });
    setTeamMembers((items) => [...items.filter((item) => item.id !== created.id), created]);
    setMemberDraft({ name: "", role: "", strengths: "", techStack: "" });
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function removeTeamMember(memberId: string) {
    if (!selectedRepo) return;
    await apiDelete(`/api/repos/${selectedRepo.id}/team-members/${memberId}`);
    setTeamMembers((items) => items.filter((item) => item.id !== memberId));
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function addMemoryNote() {
    if (!selectedRepo || (!memoryDraft.title.trim() && !memoryDraft.content.trim())) return;
    await apiPost<KnowledgeItem>(`/api/repos/${selectedRepo.id}/knowledge/notes`, {
      title: memoryDraft.title.trim(),
      content: memoryDraft.content.trim()
    });
    setMemoryDraft({ title: "", content: "" });
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function removeMemoryNote(noteId: string) {
    if (!selectedRepo) return;
    await apiDelete(`/api/repos/${selectedRepo.id}/knowledge/${noteId}?source_type=memory_note`);
    setMemoryNotes((items) => items.filter((item) => item.id !== noteId));
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function uploadKnowledgeFile(file: File) {
    if (!selectedRepo) return;
    setUploadingKnowledge(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await apiUpload(`/api/repos/${selectedRepo.id}/knowledge/upload`, formData);
      await loadProjectKnowledge(selectedRepo.id);
      await loadKnowledgeGraph(selectedRepo.id);
    } finally {
      setUploadingKnowledge(false);
    }
  }

  async function removeKnowledgeItem(item: KnowledgeItem) {
    if (!selectedRepo) return;
    await apiDelete(`/api/repos/${selectedRepo.id}/knowledge/${item.id}?source_type=${encodeURIComponent(item.source_type)}`);
    await loadProjectKnowledge(selectedRepo.id);
    await loadKnowledgeGraph(selectedRepo.id);
  }

  async function refreshSelectedRepo() {
    if (!selectedRepo) return;
    setSyncing(true);
    try {
      await apiPost(`/api/repos/${selectedRepo.id}/sync`, {
        sync_issues: true,
        sync_pull_requests: true,
        sync_workflow_runs: true,
        limit: 50
      });
      await Promise.all([
        loadRepos(),
        loadRepoData(selectedRepo.id),
        loadProjectKnowledge(selectedRepo.id),
        loadProjectIndexState(selectedRepo.id),
        loadKnowledgeGraph(selectedRepo.id),
        loadRepoConversations(selectedRepo.id)
      ]);
      setPromptStateByRepo((items) => {
        const next = { ...items };
        delete next[selectedRepo.id];
        return next;
      });
      await loadPromptSuggestions(selectedRepo.id);
    } finally {
      setSyncing(false);
    }
  }

  function openAddProject() {
    setIsAddProjectOpen(true);
    setAddProjectStatus(null);
  }

  function closeAddProject() {
    if (connectingProject) return;
    setIsAddProjectOpen(false);
  }

  async function connectProject() {
    const isLocalSource = projectSource === "local";
    const parsed = isLocalSource ? null : parseRepositoryInput(projectUrl);
    if (!isLocalSource && !parsed) {
      setAddProjectStatus({
        type: "error",
        title: "Connection failed",
        detail: "Enter a GitHub repository URL or owner/repo, e.g. https://github.com/openai/codex."
      });
      return;
    }
    if (isLocalSource && !projectLocalPath.trim()) {
      setAddProjectStatus({
        type: "error",
        title: "Connection failed",
        detail: "Enter the local Git repository path."
      });
      return;
    }

    setConnectingProject(true);
    setAddProjectStatus(null);
    try {
      const connected = await apiPost<RepoConnectResult>("/api/repos/connect", {
        owner: parsed?.owner,
        repo: parsed?.repo,
        local_path: isLocalSource ? projectLocalPath.trim() : undefined,
        clone_parent_dir: !isLocalSource && projectCloneParentDir.trim() ? projectCloneParentDir.trim() : undefined,
        provider: projectProvider,
        api_base_url: projectProvider === "github" ? undefined : projectApiBaseUrl.trim(),
        token: projectToken.trim() || undefined,
        demo_mode: false
      });
      await Promise.all([
        loadRepos(),
        loadRepoData(connected.repo_id),
        loadProjectKnowledge(connected.repo_id),
        loadProjectIndexState(connected.repo_id)
      ]);
      const conversations = await loadRepoConversations(connected.repo_id);
      setSelectedRepoId(connected.repo_id);
      setSelectedConversationId(conversations[0]?.id || "");
      setExpandedRepoIds((items) => ({ ...items, [connected.repo_id]: true }));
      setProjectUrl("");
      setProjectLocalPath("");
      setProjectCloneParentDir("");
      setProjectToken("");
      const synced = connected.synced ?? {};
      const syncDetail =
        connected.sync_status === "completed"
          ? `Synced ${synced.issues ?? 0} issues, ${synced.pull_requests ?? 0} PRs and ${synced.workflow_runs ?? 0} CI records`
          : connected.sync_status === "fallback"
            ? `Connected in local cache mode. ${connected.message}`
            : "Repository connected";
      const codePathDetail = connected.local_path ? `Code path: ${connected.local_path}` : "Code sync and code graph analysis have started in the background";
      setAddProjectStatus({
        type: "success",
        title: "Connected",
        detail: `${connected.full_name} was added as the current project; ${syncDetail}. ${codePathDetail}.`
      });
    } catch (error) {
      setAddProjectStatus({
        type: "error",
        title: "Connection failed",
        detail: getFriendlyError(error)
      });
    } finally {
      setConnectingProject(false);
    }
  }

  async function removeRepo(repo: Repository) {
    const confirmed = window.confirm(`Remove project "${repo.full_name}"?\n\nThis deletes the locally stored project, issues, PRs, CI, analysis results and conversations.`);
    if (!confirmed) return;

    try {
      await apiDelete(`/api/repos/${repo.id}`);
    } catch (error) {
      window.alert(`Failed to delete project: ${getFriendlyError(error)}`);
      return;
    }

    const remainingRepos = repos.filter((item) => item.id !== repo.id);
    setRepos(remainingRepos);
    setConversationMap((items) => {
      const next = { ...items };
      delete next[repo.id];
      return next;
    });
    setExpandedRepoIds((items) => {
      const next = { ...items };
      delete next[repo.id];
      return next;
    });
    setPromptStateByRepo((items) => {
      const next = { ...items };
      delete next[repo.id];
      return next;
    });
    if (selectedRepoId === repo.id) {
      setSelectedRepoId(remainingRepos[0]?.id || "");
      setSelectedConversationId(remainingRepos[0] ? conversationMap[remainingRepos[0].id]?.[0]?.id || "" : "");
      setIssues([]);
      setPrs([]);
      setRuns([]);
      setMessages([]);
    }
  }

  async function refreshPromptSuggestions() {
    if (!selectedRepo || loadingPrompts) return;
    const exclude = promptExclude;
    await loadPromptSuggestions(selectedRepo.id, exclude);
  }

  function stopAgentResponse() {
    streamAbortRef.current?.abort();
  }

  function markAssistantStopped(assistantId: string) {
    setMessages((items) =>
      items.map((item) => {
        if (item.id !== assistantId) return item;
        const content = item.content.trim() ? `${item.content.trim()}\n\nResponse stopped.` : "Response stopped.";
        return { ...item, content, responsePending: false, traceCollapsed: true };
      })
    );
  }

  function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError";
  }

  function appendAssistantTrace(assistantId: string, traceItem: ChatTraceItem) {
    setMessages((items) =>
      items.map((item) =>
        item.id === assistantId
          ? { ...item, traceItems: [...(item.traceItems ?? []), traceItem], traceCollapsed: false, responsePending: true }
          : item
      )
    );
  }

  function updateAssistantToolTrace(assistantId: string, result: ChatTraceItem) {
    setMessages((items) =>
      items.map((item) => {
        if (item.id !== assistantId) return item;
        const traceItems = item.traceItems ?? [];
        const existingIndex = result.toolUseId ? traceItems.findIndex((trace) => trace.toolUseId === result.toolUseId) : -1;
        if (existingIndex < 0) {
          return { ...item, traceItems: [...traceItems, result], traceCollapsed: false, responsePending: true };
        }
        return {
          ...item,
          traceCollapsed: false,
          responsePending: true,
          traceItems: traceItems.map((trace, index) =>
            index === existingIndex ? { ...trace, ...result, id: trace.id } : trace
          )
        };
      })
    );
  }

  function toggleAssistantTrace(messageId: string) {
    setMessages((items) =>
      items.map((item) =>
        item.id === messageId ? { ...item, traceCollapsed: !item.traceCollapsed } : item
      )
    );
  }

  function toggleContextDiagnostics(messageId: string) {
    setMessages((items) =>
      items.map((item) =>
        item.id === messageId ? { ...item, contextCollapsed: !item.contextCollapsed } : item
      )
    );
  }

  function recentChatHistory() {
    return messages
      .filter((item) => !item.id.startsWith("welcome-") && item.content.trim())
      .slice(-8)
      .map((item) => ({ role: item.role, content: item.content }));
  }

  function chatRequestContext(chatHistory: Array<{ role: string; content: string }>) {
    return {
      time_range: "7d",
      messages: chatHistory,
      team_members: teamMembers.map(({ name, role, strengths, techStack }) => ({ name, role, strengths, techStack })),
      project_memory: memoryNotes.map(({ title, content }) => ({ title, content }))
    };
  }

  async function ensureActiveConversation(initialMessage: string) {
    if (!selectedRepo) return null;
    let activeConversation = selectedConversation;
    if (!activeConversation) {
      activeConversation = await apiPost<ProjectConversation>(`/api/repos/${selectedRepo.id}/conversations`, {
        title: summarizeConversationTitle(initialMessage)
      });
      skipHistoryLoadRef.current = true;
      setConversationMap((items) => {
        const existing = items[selectedRepo.id] ?? [];
        return {
          ...items,
          [selectedRepo.id]: [activeConversation!, ...existing.filter((item) => item.id !== activeConversation!.id)]
        };
      });
      setExpandedRepoIds((items) => ({ ...items, [selectedRepo.id]: true }));
      setSelectedConversationId(activeConversation.id);
    }
    return activeConversation;
  }

  async function askAgent(text = message) {
    const trimmedText = text.trim();
    if (!selectedRepo || !trimmedText) return;
    const activeConversation = await ensureActiveConversation(trimmedText);
    if (!activeConversation) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmedText };
    const assistantId = crypto.randomUUID();
    const chatHistory = recentChatHistory();
    setMessages((items) => [...items, userMessage]);
    setMessage("");
    setLoading(true);
    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    try {
      setMessages((items) => [
        ...items,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          traceCollapsed: false,
          responsePending: true
        }
      ]);
      await apiPostStream("/api/chat/stream", {
        repo_id: selectedRepo.id,
        conversation_id: activeConversation.id,
        message: trimmedText,
        context: chatRequestContext(chatHistory)
      }, (event, rawData) => {
        if (event === "thought") {
          const data = rawData as { content?: string };
          if (data.content?.trim()) {
            appendAssistantTrace(assistantId, {
              id: crypto.randomUUID(),
              kind: "thinking",
              title: "Public reasoning",
              content: data.content,
              status: "done"
            });
          }
          return;
        }
        if (event === "tool_use") {
          appendAssistantTrace(assistantId, makeToolUseTrace(rawData as ChatStreamToolUse, crypto.randomUUID()));
          return;
        }
        if (event === "tool_result") {
          updateAssistantToolTrace(assistantId, makeToolResultTrace(rawData as ChatStreamToolResult, crypto.randomUUID()));
          return;
        }
        if (event === "delta") {
          const data = rawData as ChatStreamDelta;
          if (!data.content) return;
          setMessages((items) =>
            items.map((item) =>
              item.id === assistantId ? { ...item, content: item.content + data.content, responsePending: true } : item
              )
          );
          return;
        }
        if (event === "final") {
          const data = rawData as ChatStreamFinal;
          setMessages((items) =>
            items.map((item) =>
              item.id === assistantId
                ? {
                    ...item,
                    content: data.answer,
                    route: data.route,
                    toolCalls: data.tool_calls,
                    traceItems: finalizedTraceItems(data.agent_events, item.traceItems),
                    compressionStats: data.compression_stats,
                    progressiveCompaction: data.progressive_compaction,
                    modelUsage: data.model_usage,
                    contextDiagnostics: data.context_diagnostics,
                    messageId: data.message_id,
                    contextCollapsed: true,
                    traceCollapsed: true,
                    responsePending: false
                  }
                : item
            )
          );
          if (data.route === "weekly_report") {
            void loadProjectKnowledge(selectedRepo.id);
          }
          void loadRepoConversations(selectedRepo.id);
        }
      }, { signal: abortController.signal });
    } catch (error) {
      if (isAbortError(error)) {
        markAssistantStopped(assistantId);
        return;
      }
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId ? { ...item, content: `Request failed: ${getFriendlyError(error)}`, responsePending: false, traceCollapsed: true } : item
        )
      );
    } finally {
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId ? { ...item, traceCollapsed: true, responsePending: false } : item
        )
      );
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
      setLoading(false);
    }
  }

  async function createWorkflowPlan(text = message) {
    const trimmedText = text.trim();
    if (!selectedRepo || !trimmedText) return;
    const activeConversation = await ensureActiveConversation(trimmedText);
    if (!activeConversation) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmedText };
    const assistantId = crypto.randomUUID();
    const chatHistory = recentChatHistory();
    setMessages((items) => [
      ...items,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "Creating execution plan...",
        route: "engineering_plan",
        traceCollapsed: false,
        responsePending: true
      }
    ]);
    setMessage("");
    setLoading(true);
    try {
      const data = await apiPost<ChatPlanResponse>("/api/chat/plan", {
        repo_id: selectedRepo.id,
        conversation_id: activeConversation.id,
        message: trimmedText,
        context: chatRequestContext(chatHistory)
      });
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: data.answer,
                route: data.route,
                toolCalls: data.tool_calls,
                traceItems: traceItemsFromAgentEvents(data.agent_events ?? []),
                workflowPlan: data.plan,
                planSourceMessage: trimmedText,
                planStatus: "ready",
                traceCollapsed: true,
                responsePending: false
              }
            : item
        )
      );
      void loadRepoConversations(selectedRepo.id);
    } catch (error) {
      setMessages((items) =>
        items.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: `Failed to create plan: ${getFriendlyError(error)}`,
                planStatus: "error",
                responsePending: false,
                traceCollapsed: true
              }
            : item
        )
      );
    } finally {
      setLoading(false);
    }
  }

  async function executeWorkflowPlan(messageId: string) {
    if (!selectedRepo || loading) return;
    const planMessage = messages.find((item) => item.id === messageId);
    const workflowPlan = planMessage?.workflowPlan;
    const sourceMessage = planMessage?.planSourceMessage;
    if (!workflowPlan || !sourceMessage) return;
    const activeConversation = await ensureActiveConversation(sourceMessage);
    if (!activeConversation) return;

    const chatHistory = recentChatHistory();
    setLoading(true);
    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    setMessages((items) =>
      items.map((item) =>
        item.id === messageId
          ? {
              ...item,
              content: "",
              route: "engineering_workflow",
              traceItems: [],
              traceCollapsed: false,
              responsePending: true,
              planStatus: "executing"
            }
          : item
      )
    );
    try {
      await apiPostStream("/api/chat/plan/execute/stream", {
        repo_id: selectedRepo.id,
        conversation_id: activeConversation.id,
        message: sourceMessage,
        workflow_spec: workflowPlan,
        context: chatRequestContext(chatHistory)
      }, (event, rawData) => {
        if (event === "tool_use") {
          appendAssistantTrace(messageId, makeToolUseTrace(rawData as ChatStreamToolUse, crypto.randomUUID()));
          return;
        }
        if (event === "tool_result") {
          updateAssistantToolTrace(messageId, makeToolResultTrace(rawData as ChatStreamToolResult, crypto.randomUUID()));
          return;
        }
        if (event === "delta") {
          const data = rawData as ChatStreamDelta;
          if (!data.content) return;
          setMessages((items) =>
            items.map((item) =>
              item.id === messageId ? { ...item, content: item.content + data.content, responsePending: true } : item
            )
          );
          return;
        }
        if (event === "final") {
          const data = rawData as ChatStreamFinal;
          setMessages((items) =>
            items.map((item) =>
              item.id === messageId
                ? {
                    ...item,
                    content: data.answer,
                    route: data.route,
                    toolCalls: data.tool_calls,
                    traceItems: finalizedTraceItems(data.agent_events, item.traceItems),
                    messageId: data.message_id,
                    traceCollapsed: true,
                    responsePending: false,
                    planStatus: data.route === "error" ? "error" : "done"
                  }
                : item
            )
          );
          void loadRepoConversations(selectedRepo.id);
        }
      }, { signal: abortController.signal });
    } catch (error) {
      if (isAbortError(error)) {
        markAssistantStopped(messageId);
        return;
      }
      setMessages((items) =>
        items.map((item) =>
          item.id === messageId
            ? {
                ...item,
                content: `Failed to execute plan: ${getFriendlyError(error)}`,
                planStatus: "error",
                responsePending: false,
                traceCollapsed: true
              }
            : item
        )
      );
    } finally {
      setMessages((items) =>
        items.map((item) =>
          item.id === messageId ? { ...item, traceCollapsed: true, responsePending: false } : item
        )
      );
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
      setLoading(false);
    }
  }

  const ownerOptions = useMemo(() => {
    const people = new Set<string>();
    issues.forEach((issue) => {
      issue.assignees?.forEach((assignee) => people.add(assignee));
      if (issue.author) people.add(issue.author);
    });
    prs.forEach((pr) => {
      if (pr.author) people.add(pr.author);
    });
    return Array.from(people).sort((a, b) => a.localeCompare(b));
  }, [issues, prs]);

  const filteredIssues = useMemo(
    () =>
      issues.filter((issue) => {
        const people = [...(issue.assignees ?? []), issue.author ?? ""];
        return (
          matchesQuery(workspaceQuery, [issue.title, issue.body, issue.state, ...(issue.labels ?? [])]) &&
          matchesStatus(workspaceStatus, issue.state) &&
          matchesOwner(workspaceOwner, people) &&
          matchesTime(workspaceTime, issue.updated_at ?? issue.created_at)
        );
      }),
    [issues, workspaceOwner, workspaceQuery, workspaceStatus, workspaceTime]
  );

  const filteredPrs = useMemo(
    () =>
      prs.filter((pr) => {
        const derivedStatus = pr.merged_at ? "merged" : pr.state;
        const fileNames = pr.files?.map((file) => file.filename) ?? [];
        return (
          matchesQuery(workspaceQuery, [pr.title, pr.body, derivedStatus, pr.author, pr.base_branch, pr.head_branch, ...fileNames]) &&
          matchesStatus(workspaceStatus, derivedStatus) &&
          matchesOwner(workspaceOwner, [pr.author ?? ""]) &&
          matchesTime(workspaceTime, pr.updated_at ?? pr.created_at ?? pr.merged_at)
        );
      }),
    [prs, workspaceOwner, workspaceQuery, workspaceStatus, workspaceTime]
  );

  const filteredRuns = useMemo(
    () =>
      runs.filter((run) => {
        const derivedStatus = run.conclusion ?? run.status;
        return (
          matchesQuery(workspaceQuery, [run.name, run.status, run.conclusion, run.logs_text]) &&
          matchesStatus(workspaceStatus, derivedStatus) &&
          matchesTime(workspaceTime, run.updated_at ?? run.created_at)
        );
      }),
    [runs, workspaceQuery, workspaceStatus, workspaceTime]
  );

  const openIssues = issues.filter((item) => item.state === "open");
  const openPrs = prs.filter((item) => item.state === "open");
  const failedRuns = runs.filter((item) => item.conclusion === "failure");
  const mergedPrs = prs.filter((item) => item.merged_at);
  const rejectedIssues = issues.filter((item) => classifyIssue(item) === "rejected");
  const handledIssues = issues.filter((item) => ["accepted", "closed"].includes(classifyIssue(item)));
  const selectedIssue = selectedWorkspaceItem?.type === "issue" ? issues.find((item) => item.id === selectedWorkspaceItem.id) : undefined;
  const selectedPr = selectedWorkspaceItem?.type === "pr" ? prs.find((item) => item.id === selectedWorkspaceItem.id) : undefined;
  const selectedRun = selectedWorkspaceItem?.type === "ci" ? runs.find((item) => item.id === selectedWorkspaceItem.id) : undefined;
  const hasWorkspaceDetail = Boolean(selectedIssue || selectedPr || selectedRun);
  const analysisModalIssue = analysisModalIssueId ? issues.find((item) => item.id === analysisModalIssueId) : undefined;
  const analysisModalPr = analysisModalPrId ? prs.find((item) => item.id === analysisModalPrId) : undefined;
  const analysisModalRun = analysisModalRunId ? runs.find((item) => item.id === analysisModalRunId) : undefined;
  const isEmptyConversation = messages.length === 0 || (messages.length === 1 && messages[0]?.id.startsWith("welcome-"));
  const indexSnoozed = Boolean(
    selectedProjectIndexState?.snoozed_until && new Date(selectedProjectIndexState.snoozed_until).getTime() > Date.now()
  );

  return (
    <div
      className="relative grid h-[calc(100vh-24px)] min-h-0 overflow-hidden rounded-lg border border-line bg-white/80 shadow-sm"
      style={{ gridTemplateColumns: `${isSidebarCollapsed ? "56px" : "300px"} minmax(0,1fr)`, transition: "grid-template-columns 260ms ease" }}
    >
      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-line bg-[#fbf7f2] transition-all duration-300">
        <div className={`border-b border-line ${isSidebarCollapsed ? "p-2" : "p-4"}`}>
          <div className={`flex items-center ${isSidebarCollapsed ? "flex-col gap-3" : "gap-3"}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-bold text-white">SM</div>
            {!isSidebarCollapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink">ShipMind</div>
                <div className="truncate text-xs text-slate-500">AI agent for team PR / issue collaboration</div>
              </div>
            )}
            <button
              onClick={() => setIsSidebarCollapsed((value) => !value)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 transition hover:bg-teal-50"
              title={isSidebarCollapsed ? "Expand project sidebar" : "Hide project sidebar"}
            >
              {isSidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>

          {isSidebarCollapsed ? (
            <div className="mt-4 flex flex-col items-center gap-3">
              <button onClick={openAddProject} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-700 transition hover:bg-white" title="Add project">
                <Plus className="h-4 w-4" />
              </button>
              <button
                onClick={refreshSelectedRepo}
                disabled={!selectedRepo || syncing}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-700 transition hover:bg-white disabled:opacity-50"
                title="Refresh current project"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              </button>
            </div>
          ) : (
            <div className="mt-5 flex items-center justify-between">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Projects</div>
                <h2 className="mt-1 text-lg font-semibold text-ink">Projects</h2>
              </div>
              <button onClick={openAddProject} className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white">
                <Plus className="h-3.5 w-3.5" />
                Add Project
              </button>
            </div>
          )}
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto ${isSidebarCollapsed ? "p-2" : "px-3 py-2"}`}>
          {repos.length === 0 && !isSidebarCollapsed && <div className="rounded-md bg-white p-3 text-sm leading-6 text-slate-600">No projects yet. Add a project first.</div>}
          {!isSidebarCollapsed && repos.length > 0 && <div className="mb-2 px-1 text-xs text-slate-400">Projects</div>}
          {repos.map((repo) => {
            const conversations = conversationMap[repo.id] ?? [];
            const isExpanded = expandedRepoIds[repo.id] ?? selectedRepo?.id === repo.id;
            const isSelectedRepo = selectedRepo?.id === repo.id;
            return isSidebarCollapsed ? (
              <button
                key={repo.id}
                onClick={() => selectProject(repo).catch(() => undefined)}
                className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-md transition ${
                  isSelectedRepo ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:bg-white"
                }`}
                title={repo.full_name}
              >
                <Folder className="h-4 w-4" />
              </button>
            ) : (
              <div key={repo.id} className="mb-1">
                <div className={`group flex h-9 items-center gap-1 rounded-md px-1 transition ${isSelectedRepo ? "bg-[#ecebea]" : "hover:bg-[#eeeeec]"}`}>
                  <button onClick={() => selectProject(repo).catch(() => undefined)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-white">
                    <ChevronDown className={`h-3.5 w-3.5 transition ${isExpanded ? "" : "-rotate-90"}`} />
                  </button>
                  <button onClick={() => selectProject(repo).catch(() => undefined)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <Folder className="h-4 w-4 shrink-0 text-slate-500" />
                    <span className="truncate text-sm text-slate-700" title={repo.full_name}>
                      {repo.name || repo.full_name}
                    </span>
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      addConversation(repo).catch(() => undefined);
                    }}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-0 transition hover:bg-white hover:text-ink group-hover:opacity-100"
                    title="Add conversation"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      removeRepo(repo).catch(() => undefined);
                    }}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                    title="Remove project"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {isExpanded && (
                  <div className="ml-7 mt-1 space-y-0.5">
                    {conversations.length === 0 && <div className="px-2 py-1.5 text-xs text-slate-400">No conversations</div>}
                    {conversations.map((conversation) => (
                      <div key={conversation.id} className="group/conversation flex items-center gap-1">
                        <button
                          onClick={() => selectConversation(repo, conversation).catch(() => undefined)}
                          className={`flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-left text-sm transition ${
                            selectedConversationId === conversation.id ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:bg-white"
                          }`}
                          title={conversation.title}
                        >
                          <span className="truncate">{conversation.title}</span>
                          <span className="shrink-0 text-xs text-slate-400">{formatRelativeTime(conversation.updated_at)}</span>
                        </button>
                        <button
                          onClick={() => removeConversation(repo, conversation).catch(() => undefined)}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover/conversation:opacity-100"
                          title="Delete conversation"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!isSidebarCollapsed && (
          <div className="border-t border-line p-3">
            <button
              onClick={refreshSelectedRepo}
              disabled={!selectedRepo || syncing}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-teal-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Refreshing..." : "Refresh Current Project"}
            </button>
          </div>
        )}
      </aside>

      <section
        className="grid min-h-0 min-w-0 bg-[#fffaf6]"
        style={{ gridTemplateColumns: `minmax(460px,1fr) 8px ${workspaceWidth}px`, gridTemplateRows: "auto minmax(0,1fr)" }}
      >
        <section className="col-start-1 row-start-1 shrink-0 border-b border-line bg-white/90 px-4 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-semibold text-ink">Overview</h2>
                <span className="text-xs text-slate-500">Current repository</span>
                <span className="truncate text-sm font-semibold text-ink">{selectedRepo?.full_name || "No repository selected"}</span>
                {selectedConversation && <span className="rounded-full bg-panel px-2 py-0.5 text-xs text-slate-600">Conversation: {selectedConversation.title}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">Production Workspace</div>
              <button onClick={openAddProject} className="text-xs text-accent hover:underline">
                Manage Projects
              </button>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard icon={ListTodo} label="Open issues" value={openIssues.length} />
            <MetricCard icon={GitPullRequest} label="PRs to review" value={openPrs.length} />
            <MetricCard icon={CheckCircle2} label="Handled issues" value={handledIssues.length} />
            <MetricCard icon={XCircle} label="Rejected issues" value={rejectedIssues.length} />
            <MetricCard icon={AlertTriangle} label="Failed CI" value={failedRuns.length} />
            <MetricCard icon={CheckCircle2} label="Merged PRs" value={mergedPrs.length} />
          </div>
        </section>

        <div className="col-start-2 row-span-2 row-start-1 cursor-col-resize border-x border-line bg-slate-100 transition hover:bg-teal-100" onMouseDown={startResize} title="Drag to resize the workspace" />

        <aside className="col-start-3 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col bg-[#fffaf6]">
          <div className="border-b border-line bg-white/80 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-ink">Workspace</h2>
              <div className="flex shrink-0 items-center gap-2">
                <div className="text-[11px] text-slate-500">
                  Issues: {filteredIssues.length} · PRs: {filteredPrs.length}
                </div>
                <button
                  onClick={refreshSelectedRepo}
                  disabled={!selectedRepo || syncing}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-2 text-xs font-medium text-slate-700 transition hover:bg-teal-50 disabled:opacity-60"
                  title="Refresh issues/PRs/CI"
                  aria-label="Refresh issues/PRs/CI"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Refreshing" : "Refresh"}
                </button>
              </div>
            </div>
            <div className="mt-3 flex gap-1 overflow-x-auto">
              {workspaceTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    if (tab === "Graph" && selectedRepo && selectedWorkspaceItem) {
                      const center = workspaceSelectionToGraphCenter(selectedWorkspaceItem);
                      if (center) void loadKnowledgeGraph(selectedRepo.id, center);
                    }
                    setWorkspaceTab(tab);
                  }}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    workspaceTab === tab ? "bg-accent text-white" : "bg-panel text-slate-600 hover:bg-teal-50"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!hasWorkspaceDetail && (workspaceTab === "Issue" || workspaceTab === "PR" || workspaceTab === "CI") && (
            <WorkspaceControls
              query={workspaceQuery}
              status={workspaceStatus}
              owner={workspaceOwner}
              time={workspaceTime}
              owners={ownerOptions}
              activeTab={workspaceTab}
              onQueryChange={(value) => {
                setWorkspaceQuery(value);
                setSelectedWorkspaceItem(null);
              }}
              onStatusChange={(value) => {
                setWorkspaceStatus(value);
                setSelectedWorkspaceItem(null);
              }}
              onOwnerChange={(value) => {
                setWorkspaceOwner(value);
                setSelectedWorkspaceItem(null);
              }}
              onTimeChange={(value) => {
                setWorkspaceTime(value);
                setSelectedWorkspaceItem(null);
              }}
            />
          )}

          {hasWorkspaceDetail && (
            <WorkspaceDetail
              issue={selectedIssue}
              pr={selectedPr}
              run={selectedRun}
              analyzingIssue={Boolean(selectedIssue && analyzingIssueId === selectedIssue.id)}
              analyzingPr={Boolean(selectedPr && analyzingPrId === selectedPr.id)}
              analyzingRun={Boolean(selectedRun && analyzingRunId === selectedRun.id)}
              onAnalyzeIssue={selectedIssue ? () => analyzeIssue(selectedIssue) : undefined}
              onAnalyzePr={selectedPr ? () => analyzePr(selectedPr) : undefined}
              onAnalyzeRun={selectedRun ? () => analyzeCi(selectedRun) : undefined}
              onClose={() => setSelectedWorkspaceItem(null)}
            />
          )}

          {!hasWorkspaceDetail && workspaceTab === "Issue" && (
            <div className="mt-4 space-y-3">
              {issueCategoryMeta.map((category) => {
                const items = filteredIssues.filter((item) => classifyIssue(item) === category.key);
                const groupKey = `issue-${category.key}`;
                return (
                  <CategoryGroup
                    key={category.key}
                    label={category.label}
                    color={category.color}
                    count={items.length}
                    isCollapsed={collapsedGroups[groupKey] ?? false}
                    onToggle={() => toggleCategory(groupKey)}
                    items={items.map((item) => ({
                      id: item.id,
                      title: `#${item.number} ${item.title}`,
                      meta: item.state,
                      detail: item.body,
                      badges: item.labels,
                      selected: selectedWorkspaceItem?.type === "issue" && selectedWorkspaceItem.id === item.id,
                      onClick: () => setSelectedWorkspaceItem({ type: "issue", id: item.id })
                    }))}
                  />
                );
              })}
            </div>
          )}

          {!hasWorkspaceDetail && workspaceTab === "PR" && (
            <div className="mt-4 space-y-3">
              {prCategoryMeta.map((category) => {
                const items = filteredPrs.filter((item) => classifyPr(item) === category.key);
                const groupKey = `pr-${category.key}`;
                return (
                  <CategoryGroup
                    key={category.key}
                    label={category.label}
                    color={category.color}
                    count={items.length}
                    isCollapsed={collapsedGroups[groupKey] ?? false}
                    onToggle={() => toggleCategory(groupKey)}
                    items={items.map((item) => ({
                      id: item.id,
                      title: `#${item.number} ${item.title}`,
                      meta: item.merged_at ? "merged" : item.state,
                      detail: item.body,
                      badges: [item.author, item.head_branch].filter(Boolean) as string[],
                      selected: selectedWorkspaceItem?.type === "pr" && selectedWorkspaceItem.id === item.id,
                      onClick: () => setSelectedWorkspaceItem({ type: "pr", id: item.id })
                    }))}
                  />
                );
              })}
            </div>
          )}

          {!hasWorkspaceDetail && workspaceTab === "CI" && (
            <div className="mt-4 space-y-2">
              {filteredRuns.length === 0 && <EmptyWorkspaceState label="No workflow runs" />}
              {filteredRuns.map((item) => (
                <WorkspaceItemButton
                  key={item.id}
                  item={{
                    id: item.id,
                    title: item.name,
                    meta: item.conclusion || item.status,
                    detail: item.logs_text,
                    selected: selectedWorkspaceItem?.type === "ci" && selectedWorkspaceItem.id === item.id,
                    onClick: () => setSelectedWorkspaceItem({ type: "ci", id: item.id })
                  }}
                />
              ))}
            </div>
          )}

          {!hasWorkspaceDetail && workspaceTab === "Team" && (
            <TeamWorkspace
              members={teamMembers}
              draft={memberDraft}
              onDraftChange={setMemberDraft}
              onAddMember={addTeamMember}
              onRemoveMember={removeTeamMember}
            />
          )}

          {!hasWorkspaceDetail && workspaceTab === "Memory & Knowledge" && (
            <MemoryHubWorkspace
              repoId={selectedRepo?.id}
              notes={memoryNotes}
              draft={memoryDraft}
              knowledgeItems={knowledgeItems}
              uploading={uploadingKnowledge}
              onDraftChange={setMemoryDraft}
              onAddNote={addMemoryNote}
              onRemoveNote={removeMemoryNote}
              onUploadFile={uploadKnowledgeFile}
              onRemoveKnowledgeItem={removeKnowledgeItem}
              onRefreshKnowledge={() => selectedRepo && loadProjectKnowledge(selectedRepo.id)}
            />
          )}

          {!hasWorkspaceDetail && workspaceTab === "Skills & MCP" && (
            <SkillMcpWorkspace
              runtime={mcpRuntime}
              skills={skills}
              selectedSkillName={selectedSkillName}
              loading={skillRuntimeLoading}
              error={skillRuntimeError}
              onSelectSkill={setSelectedSkillName}
              onRefresh={loadSkillRuntime}
            />
          )}

          {!hasWorkspaceDetail && workspaceTab === "Graph" && (
            <KnowledgeGraphWorkspace
              graph={selectedKnowledgeGraph ?? null}
              loading={graphLoadingRepoId === selectedRepo?.id}
              error={graphError}
              query={graphQuery}
              selectedNodeKey={selectedGraphNodeKey}
              hiddenNodeTypes={hiddenGraphNodeTypes}
              hiddenRelations={hiddenGraphRelations}
              onQueryChange={setGraphQuery}
              onSelectNode={setSelectedGraphNodeKey}
              onToggleNodeType={(type) => setHiddenGraphNodeTypes((items) => ({ ...items, [type]: !items[type] }))}
              onToggleRelation={(relation) => setHiddenGraphRelations((items) => ({ ...items, [relation]: !items[relation] }))}
              onRefresh={() => selectedRepo && loadKnowledgeGraph(selectedRepo.id)}
              onRebuild={rebuildSelectedKnowledgeGraph}
              onFocusNode={(node) => selectedRepo && loadKnowledgeGraph(selectedRepo.id, { type: node.type, id: node.id })}
              onOpenNode={(node) => openGraphNodeInWorkspace(node, setWorkspaceTab, setSelectedWorkspaceItem, preserveWorkspaceSelectionRef)}
            />
          )}
          </div>
        </aside>

          <section className="flex min-h-0 min-w-0 flex-col bg-[#fffaf6]">
            <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <div className="flex w-full flex-col gap-4">
                {messages.map((item) => {
                  const isWelcome = item.id.startsWith("welcome-");
                  const traceItems = item.traceItems ?? [];
                  const failedTools = (item.toolCalls ?? []).filter((call) => call.status === "error");
                  const failedToolTitle = failedTools.map((call) => `${call.tool_name}: ${call.error ?? "failed"}`).join("\n");
                  return (
                    <div key={item.id} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`${isWelcome ? "w-full max-w-none rounded-md" : "max-w-[80%] rounded-2xl"} px-4 py-3 text-sm leading-7 shadow-sm ${
                          item.role === "user" ? "bg-[#ffd9ca] text-slate-800" : "border border-line bg-white text-slate-700"
                        }`}
                      >
                        {item.role === "assistant" ? (
                          <>
                            {item.workflowPlan && (
                              <WorkflowPlanCard
                                plan={item.workflowPlan}
                                status={item.planStatus ?? "ready"}
                                disabled={loading || Boolean(item.responsePending) || item.planStatus === "done"}
                                onExecute={() => executeWorkflowPlan(item.id)}
                              />
                            )}
                            {item.content.trim() ? (
                              <div className={item.workflowPlan ? "mt-3" : ""}>
                                <MarkdownMessage content={item.content} />
                              </div>
                            ) : traceItems.length === 0 ? (
                              <div className="text-slate-500">Agent is analyzing...</div>
                            ) : null}
                          </>
                        ) : (
                          <div className="whitespace-pre-wrap">{item.content}</div>
                        )}
                        {item.route && (
                          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-2 text-xs text-slate-500">
                            <span>route: {item.route}</span>
                            <span>tools: {item.toolCalls?.length ?? 0}</span>
                            {failedTools.length > 0 && (
                              <span className="text-rose-600" title={failedToolTitle}>
                                failed: {failedTools.length}
                              </span>
                            )}
                          </div>
                        )}
                        {item.role === "assistant" && item.compressionStats && Object.keys(item.compressionStats).length > 0 && (
                          <ContextDiagnostics
                            compressionStats={item.compressionStats}
                            progressiveCompaction={item.progressiveCompaction ?? {}}
                            modelUsage={item.modelUsage ?? []}
                            contextDiagnostics={item.contextDiagnostics ?? {}}
                            collapsed={item.contextCollapsed !== false}
                            onToggle={() => toggleContextDiagnostics(item.id)}
                          />
                        )}
                        {item.role === "assistant" && traceItems.length > 0 && (
                          <div className="mt-3">
                            <ChatTraceInline
                              traceItems={traceItems}
                              collapsed={item.responsePending ? false : Boolean(item.traceCollapsed)}
                              responsePending={Boolean(item.responsePending)}
                              onToggle={() => toggleAssistantTrace(item.id)}
                            />
                          </div>
                        )}
                        {item.role === "assistant" && item.responsePending && (traceItems.length > 0 || item.content.trim()) && (
                          <div className="mt-3 flex items-center gap-2 rounded-md border border-teal-100 bg-teal-50 px-3 py-2 text-xs text-slate-600">
                            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
                            <span>Agent is replying; tool results collected, composing the final answer...</span>
                          </div>
                        )}
                        {item.role === "assistant" && item.messageId && !item.responsePending && selectedRepo && selectedConversation && (
                          <FeedbackControls
                            repoId={selectedRepo.id}
                            conversationId={selectedConversation.id}
                            messageId={item.messageId}
                            initialFeedback={item.feedback}
                            onSaved={(feedback) =>
                              setMessages((current) =>
                                current.map((message) => (message.id === item.id ? { ...message, feedback } : message))
                              )
                            }
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
                {selectedRepo && isEmptyConversation && selectedProjectIndexState && !indexSnoozed && selectedProjectIndexState.status !== "ready" && (
                  <MemoryIndexPromptCard
                    repo={selectedRepo}
                    state={selectedProjectIndexState}
                    scanning={indexScanningRepoId === selectedRepo.id || selectedProjectIndexState.status === "building"}
                    error={indexActionError}
                    onStartScan={startProjectIndexScan}
                    onSnooze={snoozeProjectIndexPrompt}
                  />
                )}
              </div>
            </div>

            <div className="border-t border-line bg-white/90 p-4">
              <div className="w-full">
                {(promptSuggestions.length > 0 || loadingPrompts) && (
                  <div className="mb-3 flex items-center gap-2">
                    <div ref={promptRowRef} className="relative min-w-0 flex-1 overflow-hidden">
                      <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
                      {loadingPrompts && promptSuggestions.length === 0 && (
                        <span className="shrink-0 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-slate-500">
                          Generating suggestions{promptLoadingDots}
                        </span>
                      )}
                      {promptSuggestions.slice(0, visiblePromptCount).map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => askAgent(prompt)}
                          disabled={!selectedRepo || loading || loadingPrompts}
                          className="max-w-full shrink-0 truncate rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-slate-600 transition hover:border-teal-200 hover:bg-teal-50 disabled:opacity-60"
                          title={prompt}
                        >
                          {prompt}
                        </button>
                      ))}
                      </div>
                      <div
                        ref={promptMeasureRef}
                        className="pointer-events-none invisible absolute -left-[9999px] top-0 flex items-center gap-2 whitespace-nowrap"
                        aria-hidden="true"
                      >
                        {promptSuggestions.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            data-prompt-chip-measure
                            className="shrink-0 rounded-full border border-line bg-panel px-3 py-1.5 text-xs text-slate-600"
                            tabIndex={-1}
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    </div>
                    {promptSuggestions.length > 0 && (
                      <button
                        onClick={refreshPromptSuggestions}
                        disabled={!selectedRepo || loading || loadingPrompts}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-500 transition hover:border-teal-200 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Refresh suggested prompts"
                        aria-label="Refresh suggested prompts"
                      >
                        <RefreshCw className={`h-4 w-4 ${loadingPrompts ? "animate-spin" : ""}`} />
                      </button>
                    )}
                  </div>
                )}
                <div className="flex items-stretch gap-3">
                  <textarea
                    className={`max-h-40 min-h-[5.5rem] flex-1 resize-none rounded-md border bg-white px-3 py-3 text-sm leading-6 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100 ${
                      planMode ? "border-teal-200" : "border-line"
                    }`}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Type a message to ask about the current repository..."
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (!loading) {
                          planMode ? createWorkflowPlan() : askAgent();
                        }
                      }
                    }}
                  />
                  <div className="flex w-12 shrink-0 flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setPlanMode((value) => !value)}
                      disabled={loading}
                      aria-pressed={planMode}
                      className={`inline-flex h-8 w-12 items-center justify-center rounded-md border transition disabled:opacity-60 ${
                        planMode
                          ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                          : "border-line bg-white text-slate-500 hover:border-teal-200 hover:bg-teal-50"
                      }`}
                      title={planMode ? "Switch to chat mode" : "Switch to plan mode"}
                    >
                      <ListTodo className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => (loading ? stopAgentResponse() : planMode ? createWorkflowPlan() : askAgent())}
                      disabled={!selectedRepo || (!loading && !message.trim())}
                      className="inline-flex min-h-12 flex-1 items-center justify-center rounded-md bg-accent text-white transition hover:bg-teal-700 disabled:opacity-60"
                      title={loading ? "Stop response" : "Send"}
                    >
                      {loading ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

      </section>
      {isAddProjectOpen && (
        <AddProjectOverlay
          source={projectSource}
          repoUrl={projectUrl}
          localPath={projectLocalPath}
          cloneParentDir={projectCloneParentDir}
          provider={projectProvider}
          apiBaseUrl={projectApiBaseUrl}
          token={projectToken}
          loading={connectingProject}
          status={addProjectStatus}
          onSourceChange={setProjectSource}
          onRepoUrlChange={setProjectUrl}
          onLocalPathChange={setProjectLocalPath}
          onCloneParentDirChange={setProjectCloneParentDir}
          onProviderChange={(value) => {
            setProjectProvider(value);
            if (value === "github") setProjectApiBaseUrl("https://api.github.com");
            if (value === "github_compatible") setProjectApiBaseUrl("https://api.example.com");
          }}
          onApiBaseUrlChange={setProjectApiBaseUrl}
          onTokenChange={setProjectToken}
          onConnect={connectProject}
          onClose={closeAddProject}
        />
      )}
      {analysisModalIssue && (
        <IssueAnalysisOverlay
          issue={analysisModalIssue}
          analysis={issueAnalysisById[analysisModalIssue.id]?.result}
          traceItems={issueAnalysisTraceById[analysisModalIssue.id] ?? []}
          loading={analyzingIssueId === analysisModalIssue.id}
          error={issueAnalysisError}
          onRetry={() => analyzeIssue(analysisModalIssue)}
          onClose={() => {
            setAnalysisModalIssueId(null);
            setIssueAnalysisError(null);
          }}
        />
      )}
      {analysisModalPr && (
        <PRAnalysisOverlay
          pr={analysisModalPr}
          analysis={prAnalysisById[analysisModalPr.id]?.result}
          traceItems={prAnalysisTraceById[analysisModalPr.id] ?? []}
          loading={analyzingPrId === analysisModalPr.id}
          error={prAnalysisError}
          onRetry={() => analyzePr(analysisModalPr)}
          onClose={() => {
            setAnalysisModalPrId(null);
            setPrAnalysisError(null);
          }}
        />
      )}
      {analysisModalRun && (
        <CIAnalysisOverlay
          run={analysisModalRun}
          analysis={ciAnalysisById[analysisModalRun.id]?.result}
          traceItems={ciAnalysisTraceById[analysisModalRun.id] ?? []}
          loading={analyzingRunId === analysisModalRun.id}
          error={ciAnalysisError}
          onRetry={() => analyzeCi(analysisModalRun)}
          onClose={() => {
            setAnalysisModalRunId(null);
            setCiAnalysisError(null);
          }}
        />
      )}
    </div>
  );
}

function WorkflowPlanCard({
  plan,
  status,
  disabled,
  onExecute
}: {
  plan: WorkflowPlan;
  status: "ready" | "executing" | "done" | "error";
  disabled: boolean;
  onExecute: () => void;
}) {
  const statusLabel = status === "executing" ? "Executing" : status === "done" ? "Executed" : status === "error" ? "Execution failed" : "Awaiting confirmation";
  return (
    <div className="rounded-md border border-teal-100 bg-teal-50/60 p-3 text-xs leading-5 text-slate-700">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-ink">
            <ListTodo className="h-4 w-4 text-teal-700" />
            <span>Plan mode</span>
            <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500">{statusLabel}</span>
          </div>
          <div className="mt-1 line-clamp-2 text-slate-600">{plan.goal}</div>
        </div>
        <button
          type="button"
          onClick={onExecute}
          disabled={disabled || status === "executing" || status === "done"}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "executing" ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          <span>{status === "done" ? "Executed" : status === "executing" ? "Executing" : "Execute Plan"}</span>
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {plan.tasks.map((task, index) => (
          <div key={task.id} className="rounded-md border border-teal-100 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">
                {index + 1}. {task.agent_name}
              </span>
              <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{task.task_type}</span>
            </div>
            <div className="mt-1 text-slate-600">{task.objective}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
              {task.dependencies?.length ? <span>Depends on: {task.dependencies.join(", ")}</span> : <span>No dependencies</span>}
              <span>Scope: {task.claim.target_type}</span>
              {task.critical && <span className="text-rose-600">Critical task</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContextDiagnostics({
  compressionStats,
  progressiveCompaction,
  modelUsage,
  contextDiagnostics,
  collapsed,
  onToggle
}: {
  compressionStats: Record<string, unknown>;
  progressiveCompaction: Record<string, unknown>;
  modelUsage: Array<Record<string, unknown>>;
  contextDiagnostics: Record<string, unknown>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pressure = contextRecord(compressionStats.pressure);
  const rawPressure = contextRecord(compressionStats.raw_history_pressure);
  const microcompact = contextRecord(compressionStats.microcompact);
  const boundary = contextRecord(compressionStats.compact_boundary);
  const promptBreakdown = contextRecord(compressionStats.prompt_breakdown);
  const historyCoverage = contextRecord(compressionStats.history_coverage);
  const progressivePressure = contextRecord(progressiveCompaction.pressure);
  const runtimeToolContext = contextRecord(contextDiagnostics.runtime_tool_context);
  const promptCalls = Array.isArray(contextDiagnostics.prompt_calls) ? contextDiagnostics.prompt_calls : [];
  const latestPromptCall = promptCalls.length > 0 ? contextRecord(promptCalls[promptCalls.length - 1]) : {};
  const latestUsage = modelUsage.length > 0 ? contextRecord(modelUsage[modelUsage.length - 1]) : {};
  const stage = contextString(progressivePressure.stage) || contextString(pressure.stage) || "normal";
  const tokenUsage = contextNumber(progressivePressure.token_usage) || contextNumber(pressure.token_usage);
  const windowTokens = contextNumber(progressivePressure.effective_window_tokens) || contextNumber(pressure.effective_window_tokens);
  const remainingTokens = contextNumber(progressivePressure.remaining_tokens) || contextNumber(pressure.remaining_tokens);
  const utilization = windowTokens > 0 ? Math.min(100, Math.round((tokenUsage / windowTokens) * 100)) : 0;
  const attempted = progressiveCompaction.attempted === true;
  const compacted = progressiveCompaction.compacted === true;
  const reason = contextString(progressiveCompaction.reason) || (compacted ? "compacted" : "no formal compaction triggered");
  const microMessages = contextNumber(microcompact.compacted_messages);
  const microSaved = contextNumber(microcompact.estimated_tokens_saved);
  const rawTokens = contextNumber(progressivePressure.raw_segment_estimated_tokens) || contextNumber(rawPressure.token_usage);
  const assembledTokens = contextNumber(progressivePressure.assembled_context_estimated_tokens) || contextNumber(compressionStats.assembled_prompt_estimated_tokens) || contextNumber(compressionStats.system_context_estimated_tokens);
  const actualInputTokens = contextNumber(latestUsage.input_tokens);
  const providerUsage = contextString(latestUsage.source) === "provider";
  const toolSchemaTokens = contextNumber(latestPromptCall.tool_schema_tokens) || contextNumber(promptBreakdown.tool_schema_tokens);
  const runtimeSaved = contextNumber(runtimeToolContext.estimated_tokens_saved);
  const exactHistory = historyCoverage.complete_and_exact === true;
  const hasBoundary = historyCoverage.has_compaction_boundary === true;
  const stageStyle =
    stage === "manual_path"
      ? "bg-rose-100 text-rose-700"
      : stage === "aggressive"
        ? "bg-orange-100 text-orange-700"
        : stage === "auto_compact"
          ? "bg-amber-100 text-amber-700"
          : stage === "warning"
            ? "bg-yellow-100 text-yellow-700"
            : "bg-emerald-100 text-emerald-700";

  return (
    <div className="mt-3 border-t border-line pt-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 text-left text-xs text-slate-600"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Gauge className="h-4 w-4 shrink-0 text-accent" />
          <span className="font-semibold text-ink">Context Diagnostics</span>
          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${stageStyle}`}>{contextStageLabel(stage)}</span>
          {compacted && <span className="shrink-0 text-accent">Compaction boundary inserted</span>}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition ${collapsed ? "-rotate-90" : ""}`} />
      </button>

      {!collapsed && (
        <div className="mt-3 space-y-3 rounded-md bg-slate-50 p-3">
          <div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Context window usage</span>
              <span>{tokenUsage.toLocaleString()} / {windowTokens.toLocaleString()} tokens</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full ${stage === "normal" ? "bg-emerald-500" : stage === "warning" ? "bg-yellow-500" : "bg-orange-500"}`}
                style={{ width: `${Math.max(2, utilization)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-slate-400">
              <span>normal</span>
              <span>warning</span>
              <span>auto compact</span>
              <span>manual</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md bg-line text-xs">
            <div className="bg-white px-3 py-2">
              <div className="text-slate-400">Raw segments</div>
              <div className="mt-1 font-semibold text-ink">{rawTokens.toLocaleString()} tokens</div>
            </div>
            <div className="bg-white px-3 py-2">
              <div className="text-slate-400">Assembled context</div>
              <div className="mt-1 font-semibold text-ink">{assembledTokens.toLocaleString()} tokens</div>
            </div>
            <div className="bg-white px-3 py-2">
              <div className="text-slate-400">Remaining space</div>
              <div className="mt-1 font-semibold text-ink">{remainingTokens.toLocaleString()} tokens</div>
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ink">Full Prompt Metering</span>
              <span className={providerUsage ? "text-emerald-700" : "text-slate-500"}>
                {providerUsage ? "Actual provider usage" : "Pre-request estimate"}
              </span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-slate-500 sm:grid-cols-4">
              <span>Actual input: {actualInputTokens.toLocaleString()}</span>
              <span>Assembled estimate: {assembledTokens.toLocaleString()}</span>
              <span>Recent history: {contextNumber(promptBreakdown.recent_history).toLocaleString()}</span>
              <span>Tool schema: {toolSchemaTokens.toLocaleString()}</span>
            </div>
            {runtimeSaved > 0 && (
              <div className="mt-1 text-teal-700">In-turn tool projection saved about {runtimeSaved.toLocaleString()} tokens; full results are still kept in the archived transcript.</div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            <span className={exactHistory ? "text-emerald-700" : "text-amber-700"}>
              Recent history: {exactHistory ? "full original text" : "trimmed or omitted"}
            </span>
            {hasBoundary && <span>Earlier original text can be looked up exactly across the boundary with the transcript tool</span>}
            {contextDiagnostics.reactive_overflow_retry === true && <span className="text-orange-700">An overflow recovery ran during this turn</span>}
          </div>

          {(microMessages > 0 || microSaved > 0) && (
            <div className="flex items-start justify-between gap-4 border-l-2 border-teal-300 pl-3 text-xs leading-5">
              <div>
                <div className="font-semibold text-ink">Microcompact (lightweight)</div>
                <div className="text-slate-500">Cleared {microMessages} old tool results that can be fetched again</div>
              </div>
              <div className="shrink-0 font-semibold text-teal-700">Saved about {microSaved.toLocaleString()} tokens</div>
            </div>
          )}

          <div className="border-l-2 border-amber-300 pl-3 text-xs leading-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ink">Full compaction</span>
              <span className={attempted ? "text-amber-700" : "text-slate-500"}>{attempted ? (compacted ? "Completed" : "Attempted") : "Not run"}</span>
            </div>
            <div className="text-slate-500">Reason: {contextReasonLabel(reason)}</div>
            {compacted && (
              <div className="mt-1 text-slate-600">
                Summarized {contextNumber(progressiveCompaction.messages_summarized)} messages, kept the latest {contextNumber(progressiveCompaction.messages_preserved)}, about {contextNumber(progressiveCompaction.post_compact_estimated_tokens).toLocaleString()} tokens after compaction
              </div>
            )}
            {(contextString(progressiveCompaction.boundary_id) || contextString(boundary.id)) && (
              <div className="mt-1 truncate font-mono text-[11px] text-slate-400">
                boundary: {contextString(progressiveCompaction.boundary_id) || contextString(boundary.id)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function contextRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function contextNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function contextString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function contextStageLabel(stage: string): string {
  if (stage === "warning") return "Near threshold";
  if (stage === "auto_compact") return "Auto compaction";
  if (stage === "aggressive") return "Aggressive compaction";
  if (stage === "manual_path") return "Full compaction";
  return "Normal";
}

function contextReasonLabel(reason: string): string {
  if (reason === "microcompact_sufficient") return "Safe headroom restored after microcompact";
  if (reason === "normal") return "The current context is still in the safe zone";
  if (reason === "warning") return "Near the threshold, but full compaction is not needed yet";
  if (reason === "not_enough_messages") return "Not enough history to generate a compaction summary";
  if (reason === "nothing_to_summarize") return "No old messages left to summarize";
  if (reason === "compacted") return "Raw segments exceeded the threshold; a summary boundary was generated";
  return reason;
}

function SkillMcpWorkspace({
  runtime,
  skills,
  selectedSkillName,
  loading,
  error,
  onSelectSkill,
  onRefresh
}: {
  runtime: McpRuntime | null;
  skills: SkillResponse[];
  selectedSkillName: string;
  loading: boolean;
  error: string | null;
  onSelectSkill: (name: string) => void;
  onRefresh: () => void;
}) {
  const selectedSkill = skills.find((item) => item.manifest.name === selectedSkillName) ?? skills[0];

  return (
    <div className="space-y-5">
      <section aria-label="MCP Server verification">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Cable className="h-4 w-4 text-accent" />
              MCP Server Verification
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">This page really runs initialize, initialized and tools/list.</p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 text-xs font-medium text-slate-700 transition hover:bg-teal-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Re-verify
          </button>
        </div>

        {error && <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
        {!runtime && !error && (
          <div className="mt-3 rounded-md border border-dashed border-line bg-white p-4 text-center text-xs text-slate-500">
            {loading ? "Starting the stdio subprocess and running the MCP handshake..." : "Waiting to verify the MCP Server"}
          </div>
        )}
        {runtime && (
          <>
            <div className="mt-3 border-y border-line bg-white py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">{runtime.server_name}</div>
                  <div className="mt-1 text-xs text-slate-500">Server v{runtime.server_version}</div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Handshake succeeded
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div><dt className="text-slate-400">Protocol</dt><dd className="mt-0.5 font-medium text-slate-700">{runtime.protocol_version}</dd></div>
                <div><dt className="text-slate-400">Transport</dt><dd className="mt-0.5 font-medium text-slate-700">{runtime.transport}</dd></div>
              </dl>
            </div>
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-ink">tools/list result</span>
                <span className="text-slate-500">{runtime.tools.length} read-only tools</span>
              </div>
              <div className="mt-2 divide-y divide-line border-y border-line bg-white">
                {runtime.tools.map((tool) => (
                  <div key={tool.name} className="py-3">
                    <div className="break-all font-mono text-xs font-semibold text-accent">{tool.name}</div>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{tool.description}</p>
                    <div className="mt-1 text-[11px] text-slate-400">
                      Required params: {tool.input_schema.required?.join(", ") || "none"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      <section aria-label="Skill Registry verification" className="border-t border-line pt-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <BookOpen className="h-4 w-4 text-accent" />
          Skill Registry Verification
        </div>
        <label className="mt-3 block text-xs font-medium text-slate-600" htmlFor="skill-selector">Select a loaded skill</label>
        <select
          id="skill-selector"
          value={selectedSkill?.manifest.name ?? ""}
          onChange={(event) => onSelectSkill(event.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-line bg-white px-2 text-xs text-slate-700 outline-none focus:border-teal-400"
        >
          {skills.map((item) => <option key={item.manifest.name} value={item.manifest.name}>{item.manifest.title}</option>)}
        </select>

        {selectedSkill && (
          <div className="mt-3 border-y border-line bg-white py-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-ink">{selectedSkill.manifest.title}</div>
                <div className="mt-1 font-mono text-[11px] text-slate-500">{selectedSkill.manifest.name}</div>
              </div>
              <span className="rounded-full bg-teal-50 px-2 py-1 font-semibold text-teal-700">v{selectedSkill.manifest.version}</span>
            </div>
            <p className="mt-3 leading-5 text-slate-600">{selectedSkill.manifest.description}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div><dt className="text-slate-400">Entrypoint</dt><dd className="mt-0.5 break-all font-mono text-[11px] font-medium text-slate-700">{selectedSkill.manifest.entrypoint}</dd></div>
              <div><dt className="text-slate-400">Safety</dt><dd className="mt-0.5 inline-flex items-center gap-1 font-medium text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />{selectedSkill.manifest.safety_level}</dd></div>
            </dl>
            <div className="mt-4 font-semibold text-ink">Auto-trigger conditions</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedSkill.manifest.triggers.map((trigger) => <span key={trigger} className="rounded bg-teal-50 px-2 py-1 text-[10px] text-teal-700">{trigger}</span>)}
            </div>
            <div className="mt-4 font-semibold text-ink">Workflow steps</div>
            <ol className="mt-2 space-y-2">
              {selectedSkill.manifest.workflow_steps.map((step, index) => (
                <li key={step} className="flex items-start gap-2 text-slate-600">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">{index + 1}</span>
                  <span className="break-all font-mono text-[11px] leading-5">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4 font-semibold text-ink">Bound tools</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedSkill.manifest.tools.map((tool) => <span key={tool} className="rounded bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-600">{tool}</span>)}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ChatTraceInline({
  traceItems,
  collapsed,
  responsePending,
  onToggle
}: {
  traceItems: ChatTraceItem[];
  collapsed: boolean;
  responsePending: boolean;
  onToggle: () => void;
}) {
  if (!traceItems.length) return null;
  const runningCount = traceItems.filter((item) => item.status === "running").length;
  const errorCount = traceItems.filter((item) => item.status === "error").length;
  const toolCount = traceItems.filter((item) => item.kind === "tool" || item.kind === "error").length;
  const ragPrefetch = traceItems.find((item) => item.kind === "rag_prefetch");
  const statusLabel = responsePending ? "Replying" : runningCount > 0 ? "Running" : errorCount > 0 ? `${errorCount} failed` : "Completed";
  return (
    <div className="space-y-2 border-l-2 border-teal-100 pl-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-md border border-line bg-slate-50 px-3 py-2 text-left text-xs text-slate-600 transition hover:border-teal-200 hover:bg-teal-50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition ${collapsed ? "-rotate-90" : ""}`} />
          <span className="truncate font-semibold text-ink">Tool Call Process</span>
          <span className="shrink-0 text-slate-500">
            {toolCount} tools · {ragPrefetch ? `RAG pre-retrieval ${ragPrefetch.evidenceCount ?? 0} · ` : ""}{traceItems.length} events
          </span>
        </span>
        <span className={errorCount > 0 ? "shrink-0 text-rose-600" : responsePending || runningCount > 0 ? "shrink-0 text-accent" : "shrink-0 text-slate-500"}>
          {statusLabel}
        </span>
      </button>
      {!collapsed &&
        traceItems.map((item) => (
          <div
            key={item.id}
            className={`rounded-md px-3 py-2 text-xs leading-5 ${
              item.status === "error"
                ? "bg-rose-50 text-rose-700"
                : item.status === "running"
                  ? "bg-teal-50 text-slate-700"
                  : item.kind === "rag_prefetch"
                    ? "border border-cyan-100 bg-cyan-50 text-slate-700"
                  : "bg-slate-50 text-slate-600"
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">{item.title}</span>
              {item.status === "running" && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />}
            </div>
            {item.skillTitle && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 border-y border-teal-100 py-1.5 text-[11px] text-teal-700">
                <BookOpen className="h-3.5 w-3.5" />
                <span className="font-semibold">Skill: {item.skillTitle}</span>
                {item.skillVersion && <span>v{item.skillVersion}</span>}
                {item.skillName && <span className="font-mono text-teal-600">{item.skillName}</span>}
                {item.skillActivationMode && <span>· {item.skillActivationMode}</span>}
              </div>
            )}
            {item.kind === "thinking" ? (
              <MarkdownMessage content={item.content} />
            ) : (
              <div className="max-h-32 overflow-auto whitespace-pre-wrap">{item.content}</div>
            )}
            {item.skillSteps && item.skillSteps.length > 0 && (
              <div className="mt-2 border-t border-slate-200 pt-2">
                <div className="mb-1 font-semibold text-slate-600">Skill workflow</div>
                <div className="flex flex-wrap gap-1">
                  {item.skillSteps.map((step, index) => (
                    <span key={step} className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{index + 1}. {step}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children, ...props }) => (
            <div className="markdown-table-wrap">
              <table {...props}>{children}</table>
            </div>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function IssueAnalysisOverlay({
  issue,
  analysis,
  traceItems,
  loading,
  error,
  onRetry,
  onClose
}: {
  issue: Issue;
  analysis?: IssueAnalysisResult;
  traceItems: IssueAnalysisTraceItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const checklist = analysis?.checklist?.length ? analysis.checklist : analysis?.action_items ?? [];
  const drafts = analysis?.drafts;
  const hasDrafts = Boolean(drafts?.clarification_comment || drafts?.task_breakdown);
  const traceScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = traceScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [traceItems]);

  return (
    <div className="absolute inset-0 z-50 grid grid-cols-1 items-center gap-3 bg-slate-950/35 p-4 backdrop-blur-sm xl:grid-cols-[280px_minmax(0,1fr)] xl:p-6">
      <aside className="order-2 flex max-h-[28vh] min-h-0 flex-col overflow-hidden rounded-lg border border-teal-100 bg-white/95 shadow-xl xl:order-1 xl:h-[86vh] xl:max-h-[86vh]">
        <div className="border-b border-line px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Thinking Trace</div>
          <h3 className="mt-1 text-sm font-semibold text-ink">Public Analysis Process</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">Shows tool calls, evidence collection and the user-facing analysis summary.</p>
        </div>
        <div ref={traceScrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {traceItems.length === 0 && (
            <div className="rounded-md border border-dashed border-line bg-panel p-3 text-xs leading-5 text-slate-500">
              After you click “Re-analyze”, the analysis steps will stream here.
            </div>
          )}
          {traceItems.map((item) => (
            <div
              key={item.id}
              className={`rounded-md border p-3 text-xs leading-5 shadow-sm ${
                item.kind === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : item.kind === "thinking"
                    ? "border-teal-200 bg-teal-50/80 text-slate-700"
                    : "border-line bg-white text-slate-600"
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{item.title}</span>
                {item.status === "running" && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />}
              </div>
              {item.kind === "thinking" ? <MarkdownMessage content={item.content} /> : <div className="whitespace-pre-wrap">{item.content}</div>}
            </div>
          ))}
        </div>
      </aside>

      <div role="dialog" aria-modal="true" className="order-1 flex max-h-[86vh] min-h-0 w-full flex-col overflow-hidden rounded-lg border border-line bg-white shadow-2xl xl:order-2">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Issue Agent</div>
            <h3 className="mt-1 line-clamp-2 text-base font-semibold text-ink">
              #{issue.number} {issue.title}
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={onRetry}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-white px-2.5 text-xs text-slate-600 transition hover:bg-teal-50 disabled:opacity-50"
              title="Re-analyze"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Re-analyze
            </button>
            <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-slate-500 transition hover:bg-panel" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && !analysis && (
            <div className="rounded-md border border-line bg-panel p-4 text-sm text-slate-600">The Issue Agent is retrieving the issue, similar history, code, docs and conversation context...</div>
          )}

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-700">
              Analysis failed: {error}
            </div>
          )}

          {analysis && (
            <div className="space-y-4">
              <section className="rounded-md border border-teal-200 bg-teal-50/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white">{analysis.conclusion}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600">Priority {analysis.priority}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600">Complexity {analysis.complexity}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600">Category {analysis.category}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600">Confidence {Math.round((analysis.confidence ?? 0) * 100)}%</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{analysis.conclusion_reason || analysis.summary}</p>
              </section>

              <section className="rounded-md border border-line bg-white p-4">
                <h4 className="text-sm font-semibold text-ink">Suggested Owner</h4>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  <span className="font-semibold text-ink">{analysis.suggested_owner}</span>
                  <span className="ml-2">{analysis.owner_reason}</span>
                </p>
              </section>

              <section className="rounded-md border border-line bg-white p-4">
                <h4 className="text-sm font-semibold text-ink">Evidence</h4>
                <div className="mt-3 space-y-2">
                  {(analysis.evidence ?? []).length === 0 && <div className="text-sm text-slate-500">No evidence available.</div>}
                  {(analysis.evidence ?? []).map((item, index) => (
                    <div key={`${item.source_type}-${item.reference ?? "ref"}-${index}`} className="rounded-md bg-[#fbf7f2] p-3 text-sm leading-6 text-slate-700">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] text-slate-500">{item.source_type}</span>
                        <span className="font-medium text-ink">{item.title}</span>
                        {typeof item.confidence === "number" && <span className="text-xs text-slate-400">{Math.round(item.confidence * 100)}%</span>}
                      </div>
                      <p className="mt-1">{item.snippet}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-md border border-line bg-white p-4">
                <h4 className="text-sm font-semibold text-ink">Next-step Checklist</h4>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                  {checklist.map((item) => (
                    <li key={item} className="flex gap-2">
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-accent" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {hasDrafts && (
                <section className="rounded-md border border-line bg-white p-4">
                  <h4 className="text-sm font-semibold text-ink">Optional Drafts</h4>
                  {drafts?.clarification_comment && (
                    <div className="mt-3 rounded-md bg-panel p-3 text-sm leading-6 text-slate-700">
                      <div className="mb-2 text-xs font-semibold text-slate-500">Clarification comment</div>
                      <MarkdownMessage content={drafts.clarification_comment} />
                    </div>
                  )}
                  {drafts?.task_breakdown && (
                    <div className="mt-3 rounded-md bg-panel p-3 text-sm leading-6 text-slate-700">
                      <div className="mb-2 text-xs font-semibold text-slate-500">Task breakdown</div>
                      <MarkdownMessage content={drafts.task_breakdown} />
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentTraceAside({
  eyebrow,
  title,
  description,
  emptyLabel,
  traceItems
}: {
  eyebrow: string;
  title: string;
  description: string;
  emptyLabel: string;
  traceItems: IssueAnalysisTraceItem[];
}) {
  const traceScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = traceScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [traceItems]);

  return (
    <aside className="order-2 flex max-h-[28vh] min-h-0 flex-col overflow-hidden rounded-lg border border-teal-100 bg-white/95 shadow-xl xl:order-1 xl:h-[86vh] xl:max-h-[86vh]">
      <div className="border-b border-line px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">{eyebrow}</div>
        <h3 className="mt-1 text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <div ref={traceScrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {traceItems.length === 0 && (
          <div className="rounded-md border border-dashed border-line bg-panel p-3 text-xs leading-5 text-slate-500">{emptyLabel}</div>
        )}
        {traceItems.map((item) => (
          <div
            key={item.id}
            className={`rounded-md border p-3 text-xs leading-5 shadow-sm ${
              item.kind === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : item.kind === "thinking"
                  ? "border-teal-200 bg-teal-50/80 text-slate-700"
                  : "border-line bg-white text-slate-600"
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">{item.title}</span>
              {item.status === "running" && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />}
            </div>
            {item.kind === "thinking" ? <MarkdownMessage content={item.content} /> : <div className="whitespace-pre-wrap">{item.content}</div>}
          </div>
        ))}
      </div>
    </aside>
  );
}

function PRAnalysisOverlay({
  pr,
  analysis,
  traceItems,
  loading,
  error,
  onRetry,
  onClose
}: {
  pr: PullRequest;
  analysis?: PRAnalysisResult;
  traceItems: IssueAnalysisTraceItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid grid-cols-1 items-center gap-3 bg-slate-950/35 p-4 backdrop-blur-sm xl:grid-cols-[280px_minmax(0,1fr)] xl:p-6">
      <AgentTraceAside
        eyebrow="Plan & Execute"
        title="PR Review Process"
        description="Shows the review plan, execution steps, evidence collection and merge judgment."
        emptyLabel="After you click &quot;Re-analyze&quot;, the PR review plan and execution process will stream here."
        traceItems={traceItems}
      />

      <div role="dialog" aria-modal="true" className="order-1 flex max-h-[86vh] min-h-0 w-full flex-col overflow-hidden rounded-lg border border-line bg-white shadow-2xl xl:order-2">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">PR Merge Readiness Agent</div>
            <h3 className="mt-1 line-clamp-2 text-base font-semibold text-ink">
              #{pr.number} {pr.title}
            </h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={onRetry}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-white px-2.5 text-xs text-slate-600 transition hover:bg-teal-50 disabled:opacity-50"
              title="Re-analyze"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Re-analyze
            </button>
            <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-slate-500 transition hover:bg-panel" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && !analysis && (
            <div className="rounded-md border border-line bg-panel p-4 text-sm text-slate-600">The PR Agent is drawing up a review plan and checking the diff, code, CI, docs and review comments...</div>
          )}

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-700">
              Analysis failed: {error}
            </div>
          )}

          {analysis && (
            <div className="space-y-4">
              <section className="rounded-md border border-teal-200 bg-teal-50/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white">{analysis.merge_recommendation}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600">Confidence {Math.round((analysis.confidence ?? 0) * 100)}%</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600">Risk points {(analysis.risk_points ?? []).length}</span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600">Blockers {(analysis.blocking_issues ?? []).length}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{analysis.recommendation_reason || analysis.summary}</p>
              </section>

              <section className="rounded-md border border-line bg-white p-4">
                <h4 className="text-sm font-semibold text-ink">Review Plan & Execution</h4>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <AnalysisBulletList title="Plan" items={analysis.plan ?? []} emptyLabel="No plan yet." />
                  <AnalysisBulletList title="Executed" items={analysis.executed_steps ?? []} emptyLabel="No execution records yet." />
                </div>
              </section>

              <section className="rounded-md border border-line bg-white p-4">
                <h4 className="text-sm font-semibold text-ink">Changes & Risks</h4>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <AnalysisBulletList title="Key changes" items={analysis.key_changes ?? []} emptyLabel="No key change summary yet." />
                  <AnalysisBulletList title="Risk points" items={analysis.risk_points ?? []} emptyLabel="No obvious risk points." tone="warn" />
                  <AnalysisBulletList title="Blockers" items={analysis.blocking_issues ?? []} emptyLabel="No blockers." tone="danger" />
                  <AnalysisBulletList title="Key files" items={analysis.files_need_attention ?? []} emptyLabel="No key files." />
                </div>
              </section>

              <section className="rounded-md border border-line bg-white p-4">
                <h4 className="text-sm font-semibold text-ink">Pre-merge Actions</h4>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <AnalysisBulletList title="Review checklist" items={analysis.review_checklist ?? []} emptyLabel="No checklist yet." />
                  <AnalysisBulletList title="Test suggestions" items={analysis.test_suggestions ?? []} emptyLabel="No test suggestions yet." />
                </div>
              </section>

              {(analysis.review_comments ?? []).length > 0 && (
                <section className="rounded-md border border-line bg-white p-4">
                  <h4 className="text-sm font-semibold text-ink">Review Comments Summary</h4>
                  <AnalysisBulletList items={analysis.review_comments ?? []} emptyLabel="No review comments." />
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CIAnalysisOverlay({
  run,
  analysis,
  traceItems,
  loading,
  error,
  onRetry,
  onClose
}: {
  run: WorkflowRun;
  analysis?: CIAnalysisResult;
  traceItems: IssueAnalysisTraceItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid grid-cols-1 items-center gap-3 bg-slate-950/35 p-4 backdrop-blur-sm xl:grid-cols-[280px_minmax(0,1fr)] xl:p-6">
      <AgentTraceAside
        eyebrow="Plan & Execute"
        title="CI Investigation Process"
        description="Shows the debugging plan, failure localization, log evidence and blocking judgment."
        emptyLabel="After you click &quot;Re-analyze&quot;, the CI debugging plan and execution process will stream here."
        traceItems={traceItems}
      />

      <div role="dialog" aria-modal="true" className="order-1 flex max-h-[86vh] min-h-0 w-full flex-col overflow-hidden rounded-lg border border-line bg-white shadow-2xl xl:order-2">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">CI Root Cause Agent</div>
            <h3 className="mt-1 line-clamp-2 text-base font-semibold text-ink">{run.name}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={onRetry}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-white px-2.5 text-xs text-slate-600 transition hover:bg-teal-50 disabled:opacity-50"
              title="Re-analyze"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Re-analyze
            </button>
            <button onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-white text-slate-500 transition hover:bg-panel" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && !analysis && (
            <div className="rounded-md border border-line bg-panel p-4 text-sm text-slate-600">The CI Agent is drawing up a debugging plan and checking failed jobs, error logs, related files and recent PRs...</div>
          )}

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-700">
              Analysis failed: {error}
            </div>
          )}

          {analysis && (
            <div className="space-y-4">
              <section className="rounded-md border border-teal-200 bg-teal-50/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white">{analysis.failure_type}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs ${analysis.is_merge_blocking ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {analysis.is_merge_blocking ? "Blocks merge" : "Does not block merge"}
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-600">Confidence {Math.round((analysis.confidence ?? 0) * 100)}%</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{analysis.root_cause || analysis.failure_summary}</p>
                {analysis.blocking_reason && <p className="mt-2 text-xs leading-5 text-slate-500">{analysis.blocking_reason}</p>}
              </section>

              <section className="rounded-md border border-line bg-white p-4">
                <h4 className="text-sm font-semibold text-ink">Debugging Plan & Execution</h4>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <AnalysisBulletList title="Plan" items={analysis.plan ?? []} emptyLabel="No plan yet." />
                  <AnalysisBulletList title="Executed" items={analysis.executed_steps ?? []} emptyLabel="No execution records yet." />
                </div>
              </section>

              {analysis.first_error && (
                <section className="rounded-md border border-line bg-white p-4">
                  <h4 className="text-sm font-semibold text-ink">First Key Error Block</h4>
                  <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-900">{analysis.first_error}</pre>
                </section>
              )}

              <section className="rounded-md border border-line bg-white p-4">
                <h4 className="text-sm font-semibold text-ink">Root Cause & Fix</h4>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <AnalysisBulletList title="Possible causes" items={analysis.possible_causes ?? []} emptyLabel="No possible causes yet." tone="warn" />
                  <AnalysisBulletList title="Fix steps" items={analysis.fix_steps ?? []} emptyLabel="No fix steps yet." />
                  <AnalysisBulletList title="Debugging steps" items={analysis.debug_steps ?? []} emptyLabel="No debugging steps yet." />
                  <AnalysisBulletList title="Related files" items={analysis.related_files ?? []} emptyLabel="No related files." />
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AnalysisBulletList({
  title,
  items,
  emptyLabel,
  tone = "default"
}: {
  title?: string;
  items: string[];
  emptyLabel: string;
  tone?: "default" | "warn" | "danger";
}) {
  const iconClass = tone === "danger" ? "text-rose-500" : tone === "warn" ? "text-amber-500" : "text-accent";
  const Icon = tone === "default" ? CheckCircle2 : AlertTriangle;
  return (
    <div className="rounded-md bg-[#fbf7f2] p-3">
      {title && <div className="text-xs font-semibold text-slate-500">{title}</div>}
      {items.length === 0 ? (
        <div className={`${title ? "mt-2" : ""} text-sm text-slate-500`}>{emptyLabel}</div>
      ) : (
        <ul className={`${title ? "mt-2" : ""} space-y-2 text-sm leading-6 text-slate-700`}>
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <Icon className={`mt-1 h-4 w-4 shrink-0 ${iconClass}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddProjectOverlay({
  source,
  repoUrl,
  localPath,
  cloneParentDir,
  provider,
  apiBaseUrl,
  token,
  loading,
  status,
  onSourceChange,
  onRepoUrlChange,
  onLocalPathChange,
  onCloneParentDirChange,
  onProviderChange,
  onApiBaseUrlChange,
  onTokenChange,
  onConnect,
  onClose
}: {
  source: AddProjectSource;
  repoUrl: string;
  localPath: string;
  cloneParentDir: string;
  provider: string;
  apiBaseUrl: string;
  token: string;
  loading: boolean;
  status: AddProjectStatus | null;
  onSourceChange: (value: AddProjectSource) => void;
  onRepoUrlChange: (value: string) => void;
  onLocalPathChange: (value: string) => void;
  onCloneParentDirChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onApiBaseUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onConnect: () => void;
  onClose: () => void;
}) {
  const parsed = source === "remote" ? parseRepositoryInput(repoUrl) : null;
  const canConnect = source === "local" ? Boolean(localPath.trim()) : Boolean(repoUrl.trim());

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-project-title"
        className="flex max-h-[calc(100%-24px)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-line bg-[#eef9fb] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-teal-100 bg-[#eef9fb] px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Add Project</div>
            <h2 id="add-project-title" className="mt-1 text-xl font-semibold text-ink">
              Add Project
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-600 transition hover:bg-teal-50 disabled:opacity-60"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
          <section className="rounded-md border border-line bg-white p-4 shadow-sm">
            <div className="grid gap-4">
              <div className="grid grid-cols-2 overflow-hidden rounded-md border border-line bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => onSourceChange("remote")}
                  className={`h-9 rounded px-3 text-sm font-medium transition ${
                    source === "remote" ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:text-ink"
                  }`}
                >
                  GitHub URL
                </button>
                <button
                  type="button"
                  onClick={() => onSourceChange("local")}
                  className={`h-9 rounded px-3 text-sm font-medium transition ${
                    source === "local" ? "bg-white text-ink shadow-sm" : "text-slate-600 hover:text-ink"
                  }`}
                >
                  Local repository
                </button>
              </div>

              {source === "remote" ? (
                <div className="grid gap-4">
                  <label className="text-sm font-medium text-slate-700">
                    GitHub URL
                    <input
                      value={repoUrl}
                      onChange={(event) => onRepoUrlChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          onConnect();
                        }
                      }}
                      placeholder="https://github.com/owner/repository or owner/repository"
                      className="mt-2 h-11 w-full rounded-md border border-line bg-white px-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    />
                  </label>

                  <label className="text-sm font-medium text-slate-700">
                    Download parent directory
                    <input
                      value={cloneParentDir}
                      onChange={(event) => onCloneParentDirChange(event.target.value)}
                      placeholder="e.g. D:\\code\\repos; leave empty to use the default cache directory"
                      className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    />
                  </label>
                </div>
              ) : (
                <label className="text-sm font-medium text-slate-700">
                  Local repository path
                  <div className="mt-2 flex gap-2">
                    <input
                      value={localPath}
                      onChange={(event) => onLocalPathChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          onConnect();
                        }
                      }}
                      placeholder="e.g. D:\\code\\my-repo or ~/code/my-repo"
                      className="h-11 min-w-0 flex-1 rounded-md border border-line bg-white px-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    />
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line bg-white text-slate-500">
                      <Folder className="h-4 w-4" />
                    </span>
                  </div>
                </label>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">
                  Hosting platform
                  <select
                    value={provider}
                    onChange={(event) => onProviderChange(event.target.value)}
                    className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  >
                    <option value="github">GitHub</option>
                    <option value="github_compatible">GitHub-compatible API</option>
                  </select>
                </label>

                <label className="text-sm font-medium text-slate-700">
                  API Base URL
                  <input
                    value={apiBaseUrl}
                    disabled={provider === "github"}
                    onChange={(event) => onApiBaseUrlChange(event.target.value)}
                    className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </label>
              </div>

              <label className="text-sm font-medium text-slate-700">
                Access Token
                <input
                  type="password"
                  value={token}
                  onChange={(event) => onTokenChange(event.target.value)}
                  placeholder="Optional for public repos; required for private repos"
                  className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </label>

              {status && (
                <div
                  className={`rounded-md border px-3 py-2 text-sm leading-6 ${
                    status.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
                  }`}
                >
                  <div className="font-semibold">{status.title}</div>
                  {status.detail && <div className="mt-1 break-words">{status.detail}</div>}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={onConnect}
                  disabled={loading || !canConnect}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-60"
                >
                  {loading ? "Connecting and syncing..." : "Connect & Sync"}
                </button>
                <button
                  onClick={onClose}
                  disabled={loading}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-line bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-panel disabled:opacity-60"
                >
                  Close
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-md border border-line bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-ink">Detected</h3>
            <div className="mt-3 rounded-md bg-[#fbf7f2] p-3 text-sm leading-7 text-slate-600">
              {source === "remote" ? (
                <>
                  <div>
                    Owner: <span className="font-medium text-ink">{parsed?.owner || "pending"}</span>
                  </div>
                  <div>
                    Repository: <span className="font-medium text-ink">{parsed?.repo || "pending"}</span>
                  </div>
                  <div>
                    Download to: <span className="break-all font-medium text-ink">{cloneParentDir.trim() || "default cache directory"}</span>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    Local path: <span className="break-all font-medium text-ink">{localPath.trim() || "not selected"}</span>
                  </div>
                  <div>
                    Remote: <span className="font-medium text-ink">detected from origin after submitting</span>
                  </div>
                </>
              )}
            </div>
            <div className="mt-4 space-y-2 text-xs leading-6 text-slate-500">
              {source === "remote" ? (
                <div>Supports `https://github.com/owner/repo`, `git@github.com:owner/repo.git` and `owner/repo`.</div>
              ) : (
                <div>Local repositories must have an `origin` remote configured.</div>
              )}
              <div>After connecting, GitHub data is synced and code is indexed in the background for code RAG and risk analysis.</div>
              <div>If the connection fails, the backend’s reason is shown directly instead of raw JSON.</div>
            </div>
          </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">{label}</div>
        <Icon className="h-3.5 w-3.5 text-accent" />
      </div>
      <div className="mt-1 text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}

function WorkspaceControls({
  query,
  status,
  owner,
  time,
  owners,
  activeTab,
  onQueryChange,
  onStatusChange,
  onOwnerChange,
  onTimeChange
}: {
  query: string;
  status: string;
  owner: string;
  time: string;
  owners: string[];
  activeTab: WorkspaceTab;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onOwnerChange: (value: string) => void;
  onTimeChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search titles, bodies and labels"
          className="h-10 w-full rounded-md border border-line bg-white pl-9 pr-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <SelectFilter value={status} onChange={onStatusChange} label="Status">
          <option value="all">All statuses</option>
          <option value="open">open</option>
          <option value="closed">closed</option>
          {activeTab === "PR" && <option value="merged">merged</option>}
          {activeTab === "CI" && <option value="failure">failure</option>}
          {activeTab === "CI" && <option value="success">success</option>}
        </SelectFilter>
        <SelectFilter value={owner} onChange={onOwnerChange} label="Owner" disabled={activeTab === "CI"}>
          <option value="all">All owners</option>
          <option value="unassigned">Unassigned</option>
          {owners.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </SelectFilter>
        <SelectFilter value={time} onChange={onTimeChange} label="Time">
          <option value="all">All time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </SelectFilter>
      </div>
    </div>
  );
}

function SelectFilter({
  value,
  label,
  disabled,
  children,
  onChange
}: {
  value: string;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full appearance-none rounded-md border border-line bg-white px-2 pr-7 text-xs text-slate-700 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-100 disabled:text-slate-400"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </label>
  );
}

function CategoryGroup({
  label,
  color,
  count,
  items,
  isCollapsed,
  onToggle
}: {
  label: string;
  color: string;
  count: number;
  items: WorkspaceItem[];
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <section>
      <button type="button" onClick={onToggle} className="flex h-7 w-full items-center justify-between">
        <div className={`flex items-center gap-2 text-sm font-semibold ${color}`}>
          <span>{label}</span>
          <span className="rounded-full bg-[#f2eee8] px-2 py-0.5 text-xs font-medium text-slate-500">{count}</span>
        </div>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition ${isCollapsed ? "-rotate-90" : ""}`} />
      </button>
      {!isCollapsed && items.length > 0 && (
        <div className="mt-2 space-y-2">
          {items.map((item) => (
            <WorkspaceItemButton key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function WorkspaceItemButton({ item }: { item: WorkspaceItem }) {
  return (
    <button
      onClick={item.onClick}
      className={`w-full rounded-md border bg-white p-3 text-left transition ${
        item.selected ? "border-teal-400 ring-2 ring-teal-100" : "border-line hover:border-teal-200 hover:bg-teal-50"
      }`}
    >
      <div className="line-clamp-2 text-sm font-medium text-ink">{item.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        <span>{item.meta}</span>
        {item.badges?.slice(0, 3).map((badge) => (
          <span key={badge} className="rounded-full bg-panel px-2 py-0.5">
            {badge}
          </span>
        ))}
      </div>
      {item.detail && <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{item.detail}</div>}
    </button>
  );
}

function WorkspaceDetail({
  issue,
  pr,
  run,
  analyzingIssue,
  analyzingPr,
  analyzingRun,
  onAnalyzeIssue,
  onAnalyzePr,
  onAnalyzeRun,
  onClose
}: {
  issue?: Issue;
  pr?: PullRequest;
  run?: WorkflowRun;
  analyzingIssue?: boolean;
  analyzingPr?: boolean;
  analyzingRun?: boolean;
  onAnalyzeIssue?: () => void;
  onAnalyzePr?: () => void;
  onAnalyzeRun?: () => void;
  onClose: () => void;
}) {
  const title = issue ? `#${issue.number} ${issue.title}` : pr ? `#${pr.number} ${pr.title}` : run?.name ?? "";
  const body = issue?.body ?? pr?.body ?? run?.logs_text ?? "No details";
  const status = issue?.state ?? (pr?.merged_at ? "merged" : pr?.state) ?? run?.conclusion ?? run?.status ?? "";
  const owner = issue?.assignees?.join(", ") || issue?.author || pr?.author || "Unassigned";
  const updatedAt = issue?.updated_at ?? issue?.created_at ?? pr?.updated_at ?? pr?.created_at ?? run?.updated_at ?? run?.created_at;

  return (
    <div className="mb-4 rounded-md border border-teal-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Details</div>
          <h3 className="mt-1 text-sm font-semibold leading-6 text-ink">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {issue && (
            <button
              onClick={onAnalyzeIssue}
              disabled={!onAnalyzeIssue || analyzingIssue}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition hover:bg-teal-700 disabled:opacity-60"
            >
              <ListTodo className="h-3.5 w-3.5" />
              {analyzingIssue ? "Analyzing..." : "Analyze This Issue"}
            </button>
          )}
          {pr && (
            <button
              onClick={onAnalyzePr}
              disabled={!onAnalyzePr || analyzingPr}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition hover:bg-teal-700 disabled:opacity-60"
            >
              <GitPullRequest className="h-3.5 w-3.5" />
              {analyzingPr ? "Analyzing..." : "Analyze This PR"}
            </button>
          )}
          {run && (
            <button
              onClick={onAnalyzeRun}
              disabled={!onAnalyzeRun || analyzingRun}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition hover:bg-teal-700 disabled:opacity-60"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {analyzingRun ? "Investigating..." : "Analyze This CI Run"}
            </button>
          )}
          <button onClick={onClose} className="rounded-md border border-line px-2 py-1 text-xs text-slate-500 transition hover:bg-panel">
            Close
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <MetaPill label="Status" value={status} />
        <MetaPill label="Owner" value={owner} />
        <MetaPill label="Updated" value={formatDate(updatedAt)} />
      </div>
      {(issue?.labels?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {issue?.labels?.map((label) => (
            <span key={label} className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">
              {label}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 whitespace-pre-wrap rounded-md bg-[#fbf7f2] p-3 text-xs leading-6 text-slate-700">{body}</div>
      {pr?.files && pr.files.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {pr.files.map((file) => (
            <div key={file.id} className="rounded-md border border-line bg-white px-2 py-1.5 text-xs text-slate-600">
              <span className="font-medium text-ink">{file.filename}</span>
              <span className="ml-2 text-emerald-600">+{file.additions}</span>
              <span className="ml-1 text-rose-500">-{file.deletions}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full bg-panel px-2.5 py-1 text-xs text-slate-600">
      {label}: {value}
    </span>
  );
}

function EmptyWorkspaceState({ label }: { label: string }) {
  return <div className="rounded-md border border-line bg-white p-4 text-sm text-slate-500">{label}</div>;
}

function TeamWorkspace({
  members,
  draft,
  onDraftChange,
  onAddMember,
  onRemoveMember
}: {
  members: TeamMember[];
  draft: TeamMemberDraft;
  onDraftChange: (value: TeamMemberDraft) => void;
  onAddMember: () => void;
  onRemoveMember: (memberId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-md border border-line bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">People</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">Configure the project’s contributors; the agent references their role, strengths and tech stack when assigning issues.</p>
          </div>
          <span className="rounded-full bg-panel px-2 py-0.5 text-xs text-slate-500">{members.length}</span>
        </div>

        <div className="mt-4 grid gap-2">
          <input
            value={draft.name}
            onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
            placeholder="Name, e.g. Alice"
            className="h-9 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
          <input
            value={draft.role}
            onChange={(event) => onDraftChange({ ...draft, role: event.target.value })}
            placeholder="Role, e.g. Backend Engineer / Frontend Engineer / Tech Lead"
            className="h-9 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
          <textarea
            value={draft.strengths}
            onChange={(event) => onDraftChange({ ...draft, strengths: event.target.value })}
            placeholder="Strengths, e.g. auth, API design, CI debugging"
            className="min-h-16 resize-none rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
          <input
            value={draft.techStack}
            onChange={(event) => onDraftChange({ ...draft, techStack: event.target.value })}
            placeholder="Tech stack, e.g. Python, FastAPI, PostgreSQL"
            className="h-9 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
          <button
            onClick={onAddMember}
            disabled={!draft.name.trim()}
            className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            Add Member
          </button>
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4">
        <h3 className="text-sm font-semibold text-ink">Team Members</h3>
        <div className="mt-3 space-y-2">
          {members.length === 0 && <div className="rounded-md bg-panel p-3 text-sm text-slate-500">No members yet. Add a project contributor first.</div>}
          {members.map((member) => (
            <div key={member.id} className="rounded-md border border-line bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-ink">{member.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{member.role || "No role configured"}</div>
                </div>
                <button onClick={() => onRemoveMember(member.id)} className="rounded-md border border-line px-2 py-1 text-xs text-slate-500 hover:bg-panel">
                  Remove
                </button>
              </div>
              <div className="mt-3 space-y-1 text-xs leading-5 text-slate-600">
                <div>Strengths: {member.strengths || "not configured"}</div>
                <div>Tech stack: {member.techStack || "not configured"}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4 text-sm leading-7 text-slate-600">
        <div className="font-medium text-ink">Reports</div>
        <p className="mt-2">Type “Generate this week’s engineering report” in the chat box, or open the weekly report page for a Markdown preview.</p>
        <Link href="/reports" className="mt-3 inline-flex rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white">
          Open Weekly Report
        </Link>
      </section>
    </div>
  );
}

function MemoryIndexPromptCard({
  repo,
  state,
  scanning,
  error,
  onStartScan,
  onSnooze
}: {
  repo: Repository;
  state: ProjectIndexState;
  scanning: boolean;
  error: string | null;
  onStartScan: () => void;
  onSnooze: () => void;
}) {
  const isFailed = state.status === "failed";
  const isStale = state.status === "stale";
  const title = scanning ? "Building the project memory index..." : isFailed ? "Memory index build failed" : isStale ? "Memory index is out of date" : "This project has no memory index yet";
  const description = scanning
    ? "Scanning project docs, READMEs and manifests; once done, the agent can retrieve this context within the current repository."
    : isFailed
      ? `The last scan of ${repo.full_name} did not complete: ${state.error_message || error || "unknown error"}`
      : isStale
        ? `The local content of ${repo.full_name} has changed; update the index to keep answers fresh.`
        : "Once indexed, ShipMind can retrieve project descriptions, architecture docs, ADRs, plans and lessons learned instead of starting from scratch every time.";
  const actionLabel = scanning ? "Scanning..." : isFailed ? "Retry Scan" : isStale ? "Update Index" : "Start Scan";

  return (
    <div className="flex justify-start">
      <div className="w-full rounded-md border border-teal-100 bg-white px-4 py-4 text-sm shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-accent">
            {isFailed ? <AlertTriangle className="h-5 w-5" /> : scanning ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Database className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-ink">{title}</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
            {!isFailed && (
              <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                <div className="inline-flex items-center gap-1.5">
                  <Folder className="h-3.5 w-3.5 text-accent" />
                  README / docs / manifest
                </div>
                <div className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5 text-accent" />
                  Scans in the background; keep chatting
                </div>
                <div className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                  Writes to the local knowledge base only
                </div>
              </div>
            )}
            {error && !isFailed && <div className="mt-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={onSnooze}
                disabled={scanning}
                className="rounded-md border border-line bg-white px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-panel disabled:opacity-60"
              >
                Later
              </button>
              <button
                onClick={onStartScan}
                disabled={scanning}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-medium text-white transition hover:bg-teal-700 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
                {actionLabel}
              </button>
              <span className="text-xs text-slate-400">“Later” snoozes this reminder for 7 days; you can also manage indexed content on the knowledge base page.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MemoryHubWorkspace({
  repoId,
  notes,
  draft,
  knowledgeItems,
  uploading,
  onDraftChange,
  onAddNote,
  onRemoveNote,
  onUploadFile,
  onRemoveKnowledgeItem,
  onRefreshKnowledge
}: {
  repoId?: string;
  notes: MemoryNote[];
  draft: MemoryNoteDraft;
  knowledgeItems: KnowledgeItem[];
  uploading: boolean;
  onDraftChange: (value: MemoryNoteDraft) => void;
  onAddNote: () => void;
  onRemoveNote: (noteId: string) => void;
  onUploadFile: (file: File) => void;
  onRemoveKnowledgeItem: (item: KnowledgeItem) => void;
  onRefreshKnowledge: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"recall" | "search" | "status" | "review">("recall");
  const [recallEvents, setRecallEvents] = useState<RecallEvent[]>([]);
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemorySearchResult[]>([]);
  const [loadingPanel, setLoadingPanel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visibleKnowledgeItems = knowledgeItems.filter(
    (item) => item.source_type !== "memory_note" && item.source_type !== "team_member"
  );

  async function loadRecallEvents() {
    if (!repoId) return;
    setLoadingPanel("recall");
    setError(null);
    try {
      setRecallEvents(await apiGet<RecallEvent[]>(`/api/repos/${repoId}/memory/recall-events?limit=30`));
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setLoadingPanel((current) => (current === "recall" ? null : current));
    }
  }

  async function loadMemoryStatus() {
    if (!repoId) return;
    setLoadingPanel("status");
    setError(null);
    try {
      setMemoryStatus(await apiGet<MemoryStatus>(`/api/repos/${repoId}/memory/status`));
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setLoadingPanel((current) => (current === "status" ? null : current));
    }
  }

  async function loadCandidates(status = "pending") {
    if (!repoId) return;
    setLoadingPanel("review");
    setError(null);
    try {
      setCandidates(await apiGet<MemoryCandidate[]>(`/api/repos/${repoId}/memory/candidates?status=${encodeURIComponent(status)}&limit=50`));
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setLoadingPanel((current) => (current === "review" ? null : current));
    }
  }

  async function runMemorySearch() {
    if (!repoId || !searchQuery.trim()) return;
    setLoadingPanel("search");
    setError(null);
    try {
      const response = await apiGet<{ results: MemorySearchResult[] }>(
        `/api/repos/${repoId}/memory/search?q=${encodeURIComponent(searchQuery.trim())}&limit=10`
      );
      setSearchResults(response.results);
      await loadRecallEvents();
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setLoadingPanel((current) => (current === "search" ? null : current));
    }
  }

  async function approveCandidate(candidateId: string) {
    if (!repoId) return;
    setLoadingPanel(candidateId);
    setError(null);
    try {
      await apiPost(`/api/repos/${repoId}/memory/candidates/${candidateId}/approve`, {});
      await Promise.all([loadCandidates(), loadMemoryStatus()]);
      onRefreshKnowledge();
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setLoadingPanel((current) => (current === candidateId ? null : current));
    }
  }

  async function rejectCandidate(candidateId: string) {
    if (!repoId) return;
    setLoadingPanel(candidateId);
    setError(null);
    try {
      await apiPost(`/api/repos/${repoId}/memory/candidates/${candidateId}/reject`, {});
      await Promise.all([loadCandidates(), loadMemoryStatus()]);
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setLoadingPanel((current) => (current === candidateId ? null : current));
    }
  }

  useEffect(() => {
    if (!repoId) return;
    loadRecallEvents();
    loadMemoryStatus();
    loadCandidates();
  }, [repoId]);

  const tabs = [
    { id: "recall", label: "Recall Log" },
    { id: "search", label: "Search" },
    { id: "status", label: "Index Status" },
    { id: "review", label: "Pending Knowledge" }
  ] as const;
  const vectorRuntime = recordFromUnknown(memoryStatus?.vector);
  const vectorEmbedding = recordFromUnknown(vectorRuntime.embedding);
  const vectorBackend = memoryStatus
    ? `${String(vectorRuntime.backend ?? "not configured")} · ${String(vectorRuntime.status ?? "unknown")}`
    : "not loaded";

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-md border border-line bg-white p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeTab === tab.id ? "bg-accent text-white" : "text-slate-600 hover:bg-panel"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {activeTab === "recall" && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Recall Log</h3>
            <button type="button" onClick={loadRecallEvents} className="rounded-md border border-line px-2 py-1 text-xs text-slate-600 hover:bg-panel">
              Refresh
            </button>
          </div>
          {loadingPanel === "recall" && <div className="rounded-md border border-line bg-white p-4 text-sm text-slate-500">Loading recall log...</div>}
          {!loadingPanel && recallEvents.length === 0 && <div className="rounded-md border border-line bg-white p-4 text-sm text-slate-500">No recall records yet. They will appear here after the agent calls search_evidence or RAG search.</div>}
          {recallEvents.map((event) => (
            <div key={event.id} className="rounded-md border border-line bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-accent">{event.tool_name}</div>
                  <div className="mt-1 line-clamp-2 text-sm font-semibold text-ink">{event.query || "empty query"}</div>
                  <div className="mt-1 text-xs text-slate-500">{event.result_count} results · {event.mode} · {formatDateTime(event.created_at)}</div>
                </div>
                <span className="rounded-md bg-panel px-2 py-1 text-[11px] text-slate-600">{event.scope}</span>
              </div>
              <div className="mt-2 space-y-1">
                {(event.results ?? []).slice(0, 3).map((item, index) => (
                  <div key={`${event.id}-${index}`} className="rounded-md bg-panel px-3 py-2 text-xs text-slate-600">
                    <span className="font-medium text-ink">{String(item.source_type || "source")}</span>
                    <span className="mx-1">·</span>
                    {String(item.title || "")}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {activeTab === "search" && (
        <section className="space-y-4">
          <div className="rounded-md border border-line bg-white p-4">
            <h3 className="text-sm font-semibold text-ink">Unified Memory Search</h3>
            <div className="mt-3 flex gap-2">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runMemorySearch();
                }}
                placeholder="Search issues, PRs, CI, docs, conversation memory..."
                className="h-9 min-w-0 flex-1 rounded-md border border-line px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
              />
              <button
                type="button"
                onClick={runMemorySearch}
                disabled={!searchQuery.trim() || loadingPanel === "search"}
                className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-60"
              >
                Search
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {searchResults.map((item) => (
                <div key={`${item.source_type}-${item.source_id}-${item.title}`} className="rounded-md bg-panel p-3">
                  <div className="text-xs font-medium text-accent">{knowledgeTypeLabel(item.source_type)}</div>
                  <div className="mt-1 text-sm font-semibold text-ink">{item.title}</div>
                  <div className="mt-1 line-clamp-3 text-xs leading-5 text-slate-600">{item.snippet}</div>
                </div>
              ))}
            </div>
          </div>

          <section className="rounded-md border border-line bg-white p-4">
            <h3 className="text-sm font-semibold text-ink">Project Memory</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">Record project conventions, architecture background and long-term preferences; they are written to the current project’s RAG documents.</p>
            <div className="mt-4 grid gap-2">
              <input
                value={draft.title}
                onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
                placeholder="Title, e.g. Auth module conventions"
                className="h-9 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
              />
              <textarea
                value={draft.content}
                onChange={(event) => onDraftChange({ ...draft, content: event.target.value })}
                placeholder="Memory content, e.g. assign login-related issues to members familiar with JWT and FastAPI"
                className="min-h-24 resize-none rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
              />
              <button
                onClick={onAddNote}
                disabled={!draft.title.trim() && !draft.content.trim()}
                className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-60"
              >
                Save Memory
              </button>
            </div>
          </section>

          <section className="rounded-md border border-line bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">Knowledge Base Files</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">Uploaded documents are chunked into the vector index and included in unified memory search.</p>
              </div>
              <FileText className="h-4 w-4 text-accent" />
            </div>
            <label className="mt-4 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-teal-200 bg-teal-50/50 px-3 py-4 text-center transition hover:bg-teal-50">
              <Upload className="h-5 w-5 text-accent" />
              <span className="mt-2 text-sm font-medium text-ink">{uploading ? "Uploading and indexing..." : "Upload File to Knowledge Base"}</span>
              <span className="mt-1 text-xs text-slate-500">Supports text, Markdown, JSON, CSV, PDF, DOCX and other files with extractable text</span>
              <input
                type="file"
                className="hidden"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUploadFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
              <div className="rounded-md bg-panel px-3 py-2">Knowledge items: {visibleKnowledgeItems.length}</div>
            </div>
          </section>

          <MemoryItemLists notes={notes} knowledgeItems={visibleKnowledgeItems} onRemoveNote={onRemoveNote} onRemoveKnowledgeItem={onRemoveKnowledgeItem} />
        </section>
      )}

      {activeTab === "status" && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Index & Health Status</h3>
            <button type="button" onClick={loadMemoryStatus} className="rounded-md border border-line px-2 py-1 text-xs text-slate-600 hover:bg-panel">
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
            <MemoryStatusTile label="Index status" value={String(memoryStatus?.index?.status ?? "missing")} />
            <MemoryStatusTile label="Project docs" value={`${numberFromUnknown(memoryStatus?.documents?.total)}`} />
            <MemoryStatusTile label="Evidence" value={`${numberFromUnknown(memoryStatus?.evidence?.total)}`} />
            <MemoryStatusTile label="Recalls" value={`${numberFromUnknown(memoryStatus?.recall?.total)}`} />
            <MemoryStatusTile label="Pending" value={`${numberFromUnknown(memoryStatus?.candidates?.pending)}`} />
            <MemoryStatusTile label="Vector backend" value={vectorBackend} />
          </div>
          <div className="rounded-md border border-line bg-white p-3 text-xs leading-5 text-slate-600">
            <div>Last scan: {String(memoryStatus?.index?.last_scan_at ?? "never")}</div>
            <div>Embedding provider: {String(vectorEmbedding.provider ?? "not configured")}</div>
            <div>Embedding: {String(vectorEmbedding.model ?? "not configured")}</div>
            <div>Dimensions: {String(vectorEmbedding.dimensions ?? "not configured")}</div>
            <div>Collection: {String(vectorRuntime.collection ?? "not configured")}</div>
            <div>Status details: {String(vectorRuntime.error ?? vectorRuntime.status ?? "none")}</div>
          </div>
        </section>
      )}

      {activeTab === "review" && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Pending Knowledge</h3>
            <button type="button" onClick={() => loadCandidates()} className="rounded-md border border-line px-2 py-1 text-xs text-slate-600 hover:bg-panel">
              Refresh
            </button>
          </div>
          {candidates.length === 0 && <div className="rounded-md border border-line bg-white p-4 text-sm text-slate-500">No pending knowledge yet. New conversation summaries will collect here as candidates.</div>}
          {candidates.map((candidate) => (
            <div key={candidate.id} className="rounded-md border border-line bg-white p-3">
              <div className="text-xs font-medium text-accent">{memoryCandidateKindLabel(candidate.kind)}</div>
              <div className="mt-1 text-sm font-semibold text-ink">{candidate.title}</div>
              <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{candidate.content}</div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={loadingPanel === candidate.id}
                  onClick={() => approveCandidate(candidate.id)}
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={loadingPanel === candidate.id}
                  onClick={() => rejectCandidate(candidate.id)}
                  className="rounded-md border border-line px-3 py-1.5 text-xs text-slate-600 hover:bg-panel disabled:opacity-60"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function MemoryStatusTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-1 font-semibold text-ink">{value}</div>
    </div>
  );
}

function MemoryItemLists({
  notes,
  knowledgeItems,
  onRemoveNote,
  onRemoveKnowledgeItem
}: {
  notes: MemoryNote[];
  knowledgeItems: KnowledgeItem[];
  onRemoveNote: (noteId: string) => void;
  onRemoveKnowledgeItem: (item: KnowledgeItem) => void;
}) {
  return (
    <>
      <section className="space-y-2">
        {notes.length === 0 && <div className="rounded-md border border-line bg-white p-4 text-sm text-slate-500">No project memories yet.</div>}
        {notes.map((note) => (
          <div key={note.id} className="rounded-md border border-line bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="font-medium text-ink">{note.title}</div>
              <button onClick={() => onRemoveNote(note.id)} className="rounded-md border border-line px-2 py-1 text-xs text-slate-500 hover:bg-panel">
                Remove
              </button>
            </div>
            <div className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-600">{note.content || "No content"}</div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        {knowledgeItems.length === 0 && <div className="rounded-md border border-line bg-white p-4 text-sm text-slate-500">No uploaded files or weekly reports yet.</div>}
        {knowledgeItems.map((item) => (
          <div key={`${item.source_type}-${item.id}`} className="rounded-md border border-line bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="line-clamp-1 font-medium text-ink">{item.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {knowledgeTypeLabel(item.source_type)} · {item.chunk_count} chunks
                </div>
              </div>
              <button onClick={() => onRemoveKnowledgeItem(item)} className="rounded-md border border-line px-2 py-1 text-xs text-slate-500 hover:bg-panel">
                Remove
              </button>
            </div>
            <div className="mt-2 line-clamp-3 text-xs leading-6 text-slate-600">{item.content_preview || "No content preview"}</div>
          </div>
        ))}
      </section>
    </>
  );
}

function numberFromUnknown(value: unknown) {
  return typeof value === "number" ? value : Number(value || 0) || 0;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function formatDateTime(value?: string | null) {
  if (!value) return "No time";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return time.toLocaleString();
}

function memoryCandidateKindLabel(kind: string) {
  const labels: Record<string, string> = {
    decision: "Decision",
    fact: "Fact",
    task: "Task",
    preference: "Preference",
    repo_context: "Project context"
  };
  return labels[kind] ?? kind;
}

function MemoryWorkspace({
  notes,
  draft,
  knowledgeItems,
  uploading,
  onDraftChange,
  onAddNote,
  onRemoveNote,
  onUploadFile,
  onRemoveKnowledgeItem
}: {
  notes: MemoryNote[];
  draft: MemoryNoteDraft;
  knowledgeItems: KnowledgeItem[];
  uploading: boolean;
  onDraftChange: (value: MemoryNoteDraft) => void;
  onAddNote: () => void;
  onRemoveNote: (noteId: string) => void;
  onUploadFile: (file: File) => void;
  onRemoveKnowledgeItem: (item: KnowledgeItem) => void;
}) {
  const visibleKnowledgeItems = knowledgeItems.filter(
    (item) => item.source_type !== "memory_note" && item.source_type !== "team_member"
  );

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-line bg-white p-4">
        <h3 className="text-sm font-semibold text-ink">Project Memory</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">Record project conventions, architecture background and long-term preferences; they are written to this project’s own RAG documents.</p>
        <div className="mt-4 grid gap-2">
          <input
            value={draft.title}
            onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
            placeholder="Title, e.g. Auth module conventions"
            className="h-9 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
          <textarea
            value={draft.content}
            onChange={(event) => onDraftChange({ ...draft, content: event.target.value })}
            placeholder="Memory content, e.g. assign login-related issues to members familiar with JWT and FastAPI"
            className="min-h-24 resize-none rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
          <button
            onClick={onAddNote}
            disabled={!draft.title.trim() && !draft.content.trim()}
            className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            Save Memory
          </button>
        </div>
      </section>

      <section className="rounded-md border border-line bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Knowledge Base Files</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">Uploaded documents are chunked into Milvus and only retrieved within the current project.</p>
          </div>
          <FileText className="h-4 w-4 text-accent" />
        </div>
        <label className="mt-4 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-teal-200 bg-teal-50/50 px-3 py-4 text-center transition hover:bg-teal-50">
          <Upload className="h-5 w-5 text-accent" />
          <span className="mt-2 text-sm font-medium text-ink">{uploading ? "Uploading and indexing..." : "Upload File to Knowledge Base"}</span>
          <span className="mt-1 text-xs text-slate-500">Supports text, Markdown, JSON, CSV, PDF, DOCX and other files with extractable text</span>
          <input
            type="file"
            className="hidden"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUploadFile(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
          <div className="rounded-md bg-panel px-3 py-2">Knowledge items: {visibleKnowledgeItems.length}</div>
        </div>
      </section>

      <section className="space-y-2">
        {notes.length === 0 && <div className="rounded-md border border-line bg-white p-4 text-sm text-slate-500">No project memories yet.</div>}
        {notes.map((note) => (
          <div key={note.id} className="rounded-md border border-line bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="font-medium text-ink">{note.title}</div>
              <button onClick={() => onRemoveNote(note.id)} className="rounded-md border border-line px-2 py-1 text-xs text-slate-500 hover:bg-panel">
                Remove
              </button>
            </div>
            <div className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-600">{note.content || "No content"}</div>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        {visibleKnowledgeItems.length === 0 && <div className="rounded-md border border-line bg-white p-4 text-sm text-slate-500">No uploaded files or weekly reports yet.</div>}
        {visibleKnowledgeItems.map((item) => (
          <div key={`${item.source_type}-${item.id}`} className="rounded-md border border-line bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="line-clamp-1 font-medium text-ink">{item.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {knowledgeTypeLabel(item.source_type)} · {item.chunk_count} chunks
                </div>
              </div>
              <button onClick={() => onRemoveKnowledgeItem(item)} className="rounded-md border border-line px-2 py-1 text-xs text-slate-500 hover:bg-panel">
                Remove
              </button>
            </div>
            <div className="mt-2 line-clamp-3 text-xs leading-6 text-slate-600">{item.content_preview || "No content preview"}</div>
          </div>
        ))}
      </section>
    </div>
  );
}

function KnowledgeGraphWorkspace({
  graph,
  loading,
  error,
  query,
  selectedNodeKey,
  hiddenNodeTypes,
  hiddenRelations,
  onQueryChange,
  onSelectNode,
  onToggleNodeType,
  onToggleRelation,
  onRefresh,
  onRebuild,
  onFocusNode,
  onOpenNode
}: {
  graph: KnowledgeGraphResponse | null;
  loading: boolean;
  error: string | null;
  query: string;
  selectedNodeKey: string | null;
  hiddenNodeTypes: Record<string, boolean>;
  hiddenRelations: Record<string, boolean>;
  onQueryChange: (value: string) => void;
  onSelectNode: (value: string) => void;
  onToggleNodeType: (type: string) => void;
  onToggleRelation: (relation: string) => void;
  onRefresh: () => void;
  onRebuild: () => void;
  onFocusNode: (node: KnowledgeGraphNode) => void;
  onOpenNode: (node: KnowledgeGraphNode) => void;
}) {
  const allNodes = graph?.nodes ?? [];
  const allEdges = graph?.edges ?? [];
  const nodeByKey = useMemo(() => new Map(allNodes.map((node) => [knowledgeGraphNodeKey(node), node])), [allNodes]);
  const nodeTypes = useMemo(() => [...new Set(allNodes.map((node) => node.type))], [allNodes]);
  const relations = useMemo(() => [...new Set(allEdges.map((edge) => edge.relation))], [allEdges]);
  const filtered = useMemo(
    () => filterKnowledgeGraph(allNodes, allEdges, query, hiddenNodeTypes, hiddenRelations),
    [allNodes, allEdges, query, hiddenNodeTypes, hiddenRelations]
  );
  const centerKey = graph?.center_type && graph.center_id ? `${graph.center_type}:${graph.center_id}` : undefined;
  const positions = useMemo(() => layoutKnowledgeGraph(filtered.nodes, filtered.edges, centerKey), [filtered.nodes, filtered.edges, centerKey]);
  const selectedNode =
    (selectedNodeKey && filtered.nodes.find((node) => knowledgeGraphNodeKey(node) === selectedNodeKey)) ?? filtered.nodes[0] ?? null;
  const selectedEdges = selectedNode
    ? filtered.edges.filter(
        (edge) =>
          (edge.from_type === selectedNode.type && edge.from_id === selectedNode.id) ||
          (edge.to_type === selectedNode.type && edge.to_id === selectedNode.id)
      )
    : [];
  const showEdgeLabels = filtered.edges.length <= 8;
  const visibleNodeCount = graphStatNumber(graph, "visible_nodes", allNodes.length);
  const visibleEdgeCount = graphStatNumber(graph, "visible_edges", allEdges.length);
  const totalEdgeCount = graphStatNumber(graph, "total_edges", allEdges.length);

  return (
    <div className="space-y-3">
      <section className="rounded-md border border-line bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-ink">Project Knowledge Graph</h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">Links issues, PRs, CI, members, docs, memories and code files through traceable relations.</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              title="Refresh graph"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-slate-500 transition hover:bg-panel disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onRebuild}
              disabled={loading}
              title="Rebuild relation edges"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-slate-500 transition hover:bg-panel disabled:opacity-50"
            >
              <Database className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
          <div className="rounded-md bg-panel px-3 py-2">Nodes {visibleNodeCount}</div>
          <div className="rounded-md bg-panel px-3 py-2">Relations {visibleEdgeCount}</div>
          <div className="rounded-md bg-panel px-3 py-2">Total edges {totalEdgeCount}</div>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-white px-3">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search nodes or relations..."
            className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {query && (
            <button type="button" onClick={() => onQueryChange("")} className="text-slate-400 hover:text-slate-600" title="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {Boolean(nodeTypes.length) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {nodeTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => onToggleNodeType(type)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                  hiddenNodeTypes[type] ? "border-line bg-white text-slate-400" : "border-transparent bg-panel text-slate-700"
                }`}
              >
                {graphNodeTypeLabel(type)}
              </button>
            ))}
          </div>
        )}

        {Boolean(relations.length) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {relations.map((relation) => (
              <button
                key={relation}
                type="button"
                onClick={() => onToggleRelation(relation)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                  hiddenRelations[relation] ? "border-line bg-white text-slate-400" : "border-transparent bg-panel text-slate-700"
                }`}
              >
                {graphRelationLabel(relation)}
              </button>
            ))}
          </div>
        )}
      </section>

      {error && <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {!error && !loading && (!graph || graph.nodes.length === 0) && (
        <div className="rounded-md border border-line bg-white p-4 text-sm text-slate-500">No project relations to show yet. Sync issues/PRs/CI or add project memories, then rebuild the graph.</div>
      )}

      {loading && !graph && <div className="rounded-md border border-line bg-white p-4 text-sm text-slate-500">Loading the project knowledge graph...</div>}

      {graph && filtered.nodes.length === 0 && (
        <div className="rounded-md border border-line bg-white p-4 text-sm text-slate-500">No nodes match the current search or filters.</div>
      )}

      {graph && filtered.nodes.length > 0 && (
        <section className="rounded-md border border-line bg-white p-3">
          <div className="overflow-x-auto rounded-md bg-panel">
            <svg viewBox="0 0 720 420" className="h-[360px] min-w-[680px] w-full" role="img" aria-label="Project knowledge graph">
              {filtered.edges.map((edge) => {
                const from = positions.get(`${edge.from_type}:${edge.from_id}`);
                const to = positions.get(`${edge.to_type}:${edge.to_id}`);
                if (!from || !to) return null;
                const color = graphRelationColor(edge.relation);
                return (
                  <g key={edge.id}>
                    <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth={edge.relation === "used_as_evidence" ? 2.8 : 1.6} strokeOpacity="0.58" />
                    {showEdgeLabels && (
                      <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 5} textAnchor="middle" fontSize="10" fill={color} fontWeight="700">
                        {graphRelationLabel(edge.relation)}
                      </text>
                    )}
                  </g>
                );
              })}
              {filtered.nodes.map((node) => {
                const pos = positions.get(knowledgeGraphNodeKey(node));
                if (!pos) return null;
                const selected = selectedNode ? knowledgeGraphNodeKey(selectedNode) === knowledgeGraphNodeKey(node) : false;
                const style = graphNodeStyle(node.type);
                return (
                  <g key={knowledgeGraphNodeKey(node)} role="button" tabIndex={0} onClick={() => onSelectNode(knowledgeGraphNodeKey(node))} className="cursor-pointer">
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={selected ? 19 : 15}
                      fill={node.highlighted ? "#fff7ed" : style.fill}
                      stroke={node.highlighted ? "#f97316" : selected ? "#111827" : style.stroke}
                      strokeWidth={node.highlighted || selected ? 2.6 : 1.6}
                    />
                    <text x={pos.x} y={pos.y + 34} textAnchor="middle" fontSize="11" fontWeight={selected ? "700" : "600"} fill="#334155">
                      {clipGraphLabel(node.title, 18)}
                    </text>
                    <text x={pos.x} y={pos.y + 48} textAnchor="middle" fontSize="9" fill="#64748b">
                      {graphNodeTypeLabel(node.type)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {selectedNode && (
            <div className="mt-3 rounded-md border border-line bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-accent">{graphNodeTypeLabel(selectedNode.type)}</div>
                  <div className="mt-1 line-clamp-2 text-sm font-semibold text-ink">{selectedNode.title}</div>
                  {selectedNode.subtitle && <div className="mt-1 text-xs text-slate-500">{selectedNode.subtitle}</div>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onFocusNode(selectedNode)}
                    className="rounded-md border border-line px-2 py-1 text-xs text-slate-600 transition hover:bg-panel"
                  >
                    Focus
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenNode(selectedNode)}
                    className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-white transition hover:bg-teal-700"
                  >
                    Open
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-1.5">
                {selectedEdges.length === 0 && <div className="text-xs text-slate-500">This node has no visible relations yet.</div>}
                {selectedEdges.slice(0, 8).map((edge) => {
                  const isOutgoing = edge.from_type === selectedNode.type && edge.from_id === selectedNode.id;
                  const other = nodeByKey.get(isOutgoing ? `${edge.to_type}:${edge.to_id}` : `${edge.from_type}:${edge.from_id}`);
                  return (
                    <div key={edge.id} className="rounded-md bg-panel px-3 py-2 text-xs text-slate-600">
                      <span className="font-medium text-ink">{isOutgoing ? "→" : "←"} {graphRelationLabel(edge.relation)}</span>
                      <span className="ml-2">{other?.title ?? edge.to_id}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function knowledgeTypeLabel(sourceType: string) {
  if (sourceType === "knowledge_file") return "Uploaded file";
  if (sourceType === "weekly_report") return "Weekly report";
  if (sourceType === "project_overview") return "Project overview";
  if (sourceType === "project_doc") return "Project doc";
  if (sourceType === "project_manifest") return "Project manifest";
  if (sourceType === "memory_note") return "Memory";
  if (sourceType === "team_member") return "Team member";
  return sourceType;
}

function knowledgeGraphNodeKey(node: KnowledgeGraphNode) {
  return `${node.type}:${node.id}`;
}

function workspaceSelectionToGraphCenter(selection: WorkspaceSelection): { type: string; id: string } | null {
  if (selection.type === "issue") return { type: "issue", id: selection.id };
  if (selection.type === "pr") return { type: "pull_request", id: selection.id };
  if (selection.type === "ci") return { type: "ci_run", id: selection.id };
  return null;
}

function openGraphNodeInWorkspace(
  node: KnowledgeGraphNode,
  setWorkspaceTab: (tab: WorkspaceTab) => void,
  setSelectedWorkspaceItem: (item: WorkspaceSelection | null) => void,
  preserveSelectionRef: { current: boolean }
) {
  if (node.type === "issue") {
    preserveSelectionRef.current = true;
    setWorkspaceTab("Issue");
    setSelectedWorkspaceItem({ type: "issue", id: node.id });
    return;
  }
  if (node.type === "pull_request") {
    preserveSelectionRef.current = true;
    setWorkspaceTab("PR");
    setSelectedWorkspaceItem({ type: "pr", id: node.id });
    return;
  }
  if (node.type === "ci_run") {
    preserveSelectionRef.current = true;
    setWorkspaceTab("CI");
    setSelectedWorkspaceItem({ type: "ci", id: node.id });
    return;
  }
  setWorkspaceTab(node.type === "team_member" ? "Team" : "Memory & Knowledge");
  setSelectedWorkspaceItem(null);
}

function filterKnowledgeGraph(
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
  query: string,
  hiddenNodeTypes: Record<string, boolean>,
  hiddenRelations: Record<string, boolean>
) {
  const normalizedQuery = query.trim().toLowerCase();
  const baseAllowed = new Set(
    nodes.filter((node) => !hiddenNodeTypes[node.type]).map((node) => knowledgeGraphNodeKey(node))
  );
  const matches = new Set(
    nodes
      .filter((node) => baseAllowed.has(knowledgeGraphNodeKey(node)))
      .filter((node) => !normalizedQuery || graphNodeMatches(node, normalizedQuery))
      .map((node) => knowledgeGraphNodeKey(node))
  );
  if (normalizedQuery) {
    for (const edge of edges) {
      if (hiddenRelations[edge.relation]) continue;
      const fromKey = `${edge.from_type}:${edge.from_id}`;
      const toKey = `${edge.to_type}:${edge.to_id}`;
      const relationMatches = graphRelationLabel(edge.relation).toLowerCase().includes(normalizedQuery) || edge.relation.toLowerCase().includes(normalizedQuery);
      if (relationMatches || matches.has(fromKey) || matches.has(toKey)) {
        if (baseAllowed.has(fromKey)) matches.add(fromKey);
        if (baseAllowed.has(toKey)) matches.add(toKey);
      }
    }
  }
  const allowed = normalizedQuery ? matches : baseAllowed;
  const visibleEdges = edges.filter((edge) => {
    if (hiddenRelations[edge.relation]) return false;
    return allowed.has(`${edge.from_type}:${edge.from_id}`) && allowed.has(`${edge.to_type}:${edge.to_id}`);
  });
  return {
    nodes: nodes.filter((node) => allowed.has(knowledgeGraphNodeKey(node))),
    edges: visibleEdges
  };
}

function graphNodeMatches(node: KnowledgeGraphNode, query: string) {
  const metadataText = Object.values(node.metadata ?? {})
    .slice(0, 6)
    .join(" ")
    .toLowerCase();
  return `${node.title} ${node.subtitle ?? ""} ${node.type} ${metadataText}`.toLowerCase().includes(query);
}

function layoutKnowledgeGraph(nodes: KnowledgeGraphNode[], edges: KnowledgeGraphEdge[], centerKey?: string) {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;
  const degrees = new Map<string, number>();
  for (const node of nodes) degrees.set(knowledgeGraphNodeKey(node), 0);
  for (const edge of edges) {
    const fromKey = `${edge.from_type}:${edge.from_id}`;
    const toKey = `${edge.to_type}:${edge.to_id}`;
    degrees.set(fromKey, (degrees.get(fromKey) ?? 0) + 1);
    degrees.set(toKey, (degrees.get(toKey) ?? 0) + 1);
  }
  const requestedCenter = centerKey ? nodes.find((node) => knowledgeGraphNodeKey(node) === centerKey) : undefined;
  const resolvedCenter =
    requestedCenter ??
    [...nodes].sort((a, b) => (degrees.get(knowledgeGraphNodeKey(b)) ?? 0) - (degrees.get(knowledgeGraphNodeKey(a)) ?? 0))[0];
  const centerNodeKey = knowledgeGraphNodeKey(resolvedCenter);
  positions.set(centerNodeKey, { x: 360, y: 190 });
  const neighborKeys = new Set<string>();
  for (const edge of edges) {
    const fromKey = `${edge.from_type}:${edge.from_id}`;
    const toKey = `${edge.to_type}:${edge.to_id}`;
    if (fromKey === centerNodeKey) neighborKeys.add(toKey);
    if (toKey === centerNodeKey) neighborKeys.add(fromKey);
  }
  const neighbors = nodes.filter((node) => neighborKeys.has(knowledgeGraphNodeKey(node)));
  const remaining = nodes.filter((node) => knowledgeGraphNodeKey(node) !== centerNodeKey && !neighborKeys.has(knowledgeGraphNodeKey(node)));
  placeGraphRing(positions, neighbors, 360, 190, neighbors.length > 10 ? 145 : 122, -Math.PI / 2);
  placeGraphRing(positions, remaining, 360, 190, 184, Math.PI / 9);
  return positions;
}

function placeGraphRing(
  positions: Map<string, { x: number; y: number }>,
  nodes: KnowledgeGraphNode[],
  cx: number,
  cy: number,
  radius: number,
  start: number
) {
  if (nodes.length === 0) return;
  nodes.forEach((node, index) => {
    const angle = start + (Math.PI * 2 * index) / nodes.length;
    positions.set(knowledgeGraphNodeKey(node), {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius
    });
  });
}

function graphNodeTypeLabel(type: string) {
  const labels: Record<string, string> = {
    issue: "Issue",
    pull_request: "PR",
    ci_run: "CI",
    team_member: "Member",
    memory_note: "Memory",
    document: "Doc",
    code_file: "Code",
    session_decision: "Decision"
  };
  return labels[type] ?? type;
}

function graphRelationLabel(relation: string) {
  const labels: Record<string, string> = {
    resolves: "resolves",
    mentions: "mentions",
    assigned_to: "assigned",
    blocked_by: "blocked by",
    failed_in_ci: "CI failure",
    touches_file: "touches",
    documents: "documents",
    cites: "cites",
    produced_from_session: "from session",
    used_as_evidence: "recalled"
  };
  return labels[relation] ?? relation.replace(/_/g, " ");
}

function graphNodeStyle(type: string) {
  const styles: Record<string, { fill: string; stroke: string }> = {
    issue: { fill: "#fef3c7", stroke: "#d97706" },
    pull_request: { fill: "#ccfbf1", stroke: "#0f766e" },
    ci_run: { fill: "#fee2e2", stroke: "#dc2626" },
    team_member: { fill: "#e0e7ff", stroke: "#4f46e5" },
    memory_note: { fill: "#fce7f3", stroke: "#be185d" },
    document: { fill: "#dbeafe", stroke: "#2563eb" },
    code_file: { fill: "#dcfce7", stroke: "#16a34a" },
    session_decision: { fill: "#f3e8ff", stroke: "#9333ea" }
  };
  return styles[type] ?? { fill: "#f1f5f9", stroke: "#64748b" };
}

function graphRelationColor(relation: string) {
  const colors: Record<string, string> = {
    resolves: "#16a34a",
    mentions: "#64748b",
    assigned_to: "#4f46e5",
    blocked_by: "#dc2626",
    failed_in_ci: "#ef4444",
    touches_file: "#0f766e",
    documents: "#2563eb",
    cites: "#be185d",
    produced_from_session: "#9333ea",
    used_as_evidence: "#f97316"
  };
  return colors[relation] ?? "#64748b";
}

function graphStatNumber(graph: KnowledgeGraphResponse | null, key: string, fallback: number) {
  const value = graph?.stats?.[key];
  return typeof value === "number" ? value : fallback;
}

function clipGraphLabel(text: string, limit: number) {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trim()}…`;
}

function classifyIssue(issue: Issue) {
  const labels = (issue.labels ?? []).map((label) => label.toLowerCase());
  const text = `${issue.title} ${issue.body ?? ""}`.toLowerCase();
  if (labels.some((label) => ["rejected", "wontfix", "invalid", "duplicate"].includes(label)) || text.includes("reject")) return "rejected";
  if (labels.some((label) => ["accepted", "resolved", "done", "fixed"].includes(label))) return "accepted";
  if (issue.state === "closed") return "closed";
  if (labels.some((label) => ["decision", "needs-decision", "rfc", "proposal"].includes(label))) return "decision";
  if ((issue.assignees?.length ?? 0) === 0 && !issue.body) return "unanswered";
  if (labels.length === 0 && (issue.assignees?.length ?? 0) === 0) return "unanswered";
  return "discussing";
}

function classifyPr(pr: PullRequest) {
  const text = `${pr.title} ${pr.body ?? ""} ${(pr.files ?? []).map((file) => file.patch ?? file.filename).join(" ")}`.toLowerCase();
  if (pr.state === "closed" && !pr.merged_at) return "rejected";
  if (text.includes("conflict")) return "conflict";
  if (pr.merged_at) return "done";
  if (!pr.author) return "needsOwner";
  return "reviewing";
}

function matchesQuery(query: string, values: Array<string | null | undefined>) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}

function matchesStatus(filter: string, value?: string | null) {
  if (filter === "all") return true;
  return value === filter;
}

function matchesOwner(filter: string, people: string[]) {
  const normalizedPeople = people.filter(Boolean);
  if (filter === "all") return true;
  if (filter === "unassigned") return normalizedPeople.length === 0;
  return normalizedPeople.includes(filter);
}

function matchesTime(filter: string, value?: string | null) {
  if (filter === "all" || !value) return true;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return true;
  const days = filter === "7d" ? 7 : 30;
  return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000;
}

function formatDate(value?: string | null) {
  if (!value) return "None";
  return new Date(value).toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function parseRepositoryInput(value: string): { owner: string; repo: string } | null {
  const input = value.trim();
  if (!input) return null;

  let path = input;
  const sshMatch = input.match(/^git@[^:]+:(.+)$/);
  if (sshMatch) {
    path = sshMatch[1];
  } else {
    try {
      const url = new URL(input);
      path = url.pathname;
    } catch {
      path = input;
    }
  }

  const parts = path
    .replace(/^\/+/, "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!owner || !repo) return null;
  return { owner, repo };
}

function getFriendlyError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw === "Failed to fetch") {
    return "Cannot reach the backend API. Make sure the backend is running and CORS allows the current frontend port.";
  }
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown; message?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // Fall back to the raw error message below.
  }
  return raw || "Unknown error";
}
