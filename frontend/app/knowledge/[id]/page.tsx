"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  FileSearch,
  FileText,
  History,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings,
  TestTube2,
  X
} from "lucide-react";

import { RetrievalSettings } from "@/components/rag/retrieval-settings";
import { apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api";
import {
  formatBytes,
  formatDate,
  formatNumber,
  statusLabel,
  type KnowledgeBase,
  type KnowledgeChunk,
  type KnowledgeConfig,
  type KnowledgeDocument,
  type ModelCatalog,
  type RetrievalHistory,
  type RetrievalResponse
} from "@/lib/rag";

type Tab = "documents" | "retrieval" | "settings";

const tabs: { value: Tab; label: string; icon: typeof FileText }[] = [
  { value: "documents", label: "Documents", icon: FileText },
  { value: "retrieval", label: "Retrieval Test", icon: TestTube2 },
  { value: "settings", label: "Settings", icon: Settings }
];

const pipelineStageLabel: Record<string, string> = {
  vector_recall: "Vector recall",
  keyword_recall: "BM25 recall",
  weighted_fusion: "Weighted fusion",
  single_retriever_selection: "Single retriever",
  deduplication_and_parent_aggregation: "Dedup & aggregation",
  rerank: "Rerank",
  parent_expansion: "Parent expansion",
  score_threshold: "Score threshold",
  context_compression: "Evidence compression",
  answer_gate: "Answer gate"
};

const answerGateLabel: Record<string, string> = {
  answer: "Sufficient evidence",
  ask_clarification: "Needs narrower scope",
  insufficient_evidence: "Insufficient evidence",
  conflict: "Conflicting evidence"
};

export default function KnowledgeBaseDetailPage() {
  const id = String(useParams<{ id: string }>().id);
  const fileInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("documents");
  const [knowledge, setKnowledge] = useState<KnowledgeBase | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [config, setConfig] = useState<KnowledgeConfig | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null);
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [query, setQuery] = useState("");
  const [retrieval, setRetrieval] = useState<RetrievalResponse | null>(null);
  const [history, setHistory] = useState<RetrievalHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [base, docs, models] = await Promise.all([
      apiGet<KnowledgeBase>(`/api/rag/repositories/${id}`),
      apiGet<KnowledgeDocument[]>(`/api/rag/repositories/${id}/documents`),
      apiGet<ModelCatalog>("/api/rag/models")
    ]);
    setKnowledge(base);
    setDocuments(docs);
    setCatalog(models);
    setConfig(base.config);
  }, [id]);

  const loadHistory = useCallback(() => {
    apiGet<RetrievalHistory[]>(`/api/rag/repositories/${id}/retrieval-tests`).then(setHistory).catch(() => null);
  }, [id]);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("tab");
    if (initial === "retrieval" || initial === "settings") setTab(initial);
    load()
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
    loadHistory();
  }, [load, loadHistory]);

  useEffect(() => {
    if (!documents.some((item) => !["completed", "failed"].includes(item.status))) return;
    const timer = window.setInterval(() => load().catch(() => null), 1000);
    return () => window.clearInterval(timer);
  }, [documents, load]);

  function changeTab(next: Tab) {
    setTab(next);
    window.history.replaceState(null, "", `${window.location.pathname}?tab=${next}`);
  }

  async function uploadFiles(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(list)) {
        const form = new FormData();
        form.append("file", file);
        await apiUpload<KnowledgeDocument>(`/api/rag/repositories/${id}/documents`, form);
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function openChunks(document: KnowledgeDocument) {
    setSelectedDocument(document);
    setChunks([]);
    try {
      setChunks(await apiGet<KnowledgeChunk[]>(`/api/rag/repositories/${id}/documents/${document.id}/chunks`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load chunks");
    }
  }

  async function retry(document: KnowledgeDocument) {
    await apiPost(`/api/rag/repositories/${id}/documents/${document.id}/retry`, {});
    await load();
  }

  async function runRetrieval() {
    if (!query.trim() || !config) return;
    setTesting(true);
    setError("");
    try {
      const result = await apiPost<RetrievalResponse>(`/api/rag/repositories/${id}/retrieval-tests`, {
        query: query.trim(),
        top_k: config.top_k,
        retrieval_method: config.retrieval_method,
        rerank_enabled: config.rerank_enabled,
        score_threshold_enabled: config.score_threshold_enabled,
        score_threshold: config.score_threshold
      });
      setRetrieval(result);
      loadHistory();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Retrieval test failed");
    } finally {
      setTesting(false);
    }
  }

  async function saveSettings() {
    if (!config || !knowledge) return;
    setSaving(true);
    setMessage("");
    setError("");
    const reindexNeeded = config.embedding_model !== knowledge.config.embedding_model || config.embedding_provider !== knowledge.config.embedding_provider;
    try {
      const updated = await apiPatch<KnowledgeBase>(`/api/rag/repositories/${id}/config`, config);
      setKnowledge(updated);
      setConfig(updated.config);
      if (reindexNeeded && updated.chunk_count) {
        await apiPost(`/api/rag/${id}/reindex`, {});
        setMessage("Settings saved and existing chunks were re-embedded. Normally, changing the chunk size only affects newly uploaded documents.");
      } else {
        setMessage("Settings saved.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="grid min-h-[70vh] place-items-center text-sm text-slate-500">Loading project knowledge...</div>;
  if (!knowledge || !config) return <div className="m-6 border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error || "Repository not found"}</div>;

  return (
    <div className="min-h-[calc(100vh-74px)] bg-[#f7f8fa]">
      <header className="border-b border-line bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/knowledge" title="Back to project knowledge" className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line text-slate-600 hover:text-ink"><ArrowLeft className="h-4 w-4" /></Link>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-teal-50 text-teal-700"><BookOpen className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-ink">{knowledge.name}</h1>
            <p className="truncate text-xs text-slate-400">{knowledge.full_name}</p>
          </div>
          <div className="ml-auto hidden items-center gap-5 text-xs text-slate-500 sm:flex">
            <span>{formatNumber(knowledge.document_count)} docs</span><span>{formatNumber(knowledge.chunk_count)} chunks</span><span>{formatNumber(knowledge.character_count)} characters</span>
          </div>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-135px)] md:grid-cols-[190px_minmax(0,1fr)]">
        <aside className="border-b border-line bg-white p-3 md:border-b-0 md:border-r">
          <nav className="flex gap-1 overflow-x-auto md:block md:space-y-1">
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.value} type="button" onClick={() => changeTab(item.value)} className={`flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm transition md:w-full ${tab === item.value ? "bg-teal-50 font-medium text-teal-800" : "text-slate-600 hover:bg-slate-50"}`}>
                  <Icon className="h-4 w-4" /> {item.label}
                </button>
              );
            })}
          </nav>
          <div className="mt-5 hidden border-t border-line pt-4 text-xs leading-5 text-slate-400 md:block">
            <div className="font-medium text-slate-600">Runtime status</div>
            <div className="mt-2">Embedding</div>
            <div className={knowledge.runtime.embedding.available ? "text-emerald-700" : "text-amber-700"}>
              {knowledge.runtime.embedding.available
                ? `${knowledge.runtime.embedding.provider} ready`
                : `${knowledge.runtime.embedding.provider} unavailable`}
            </div>
            <div className="mt-2">Rerank</div>
            <div className={knowledge.runtime.rerank.available ? "text-emerald-700" : "text-amber-700"}>
              {knowledge.runtime.rerank.available
                ? `${knowledge.runtime.rerank.provider} ready`
                : knowledge.runtime.rerank.fallback === "heuristic"
                  ? "Heuristic rerank"
                  : `${knowledge.runtime.rerank.provider} unavailable`}
            </div>
          </div>
        </aside>

        <main className="min-w-0 p-4 sm:p-6">
          {error ? <div className="mb-4 flex items-center justify-between bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button onClick={() => setError("")} title="Close"><X className="h-4 w-4" /></button></div> : null}

          {tab === "documents" ? (
            <div className="mx-auto max-w-6xl">
              <div className="flex items-end justify-between gap-4">
                <div><h2 className="text-lg font-semibold text-ink">Documents</h2><p className="mt-1 text-sm text-slate-500">View parsing status and the actual chunk contents.</p></div>
                <input ref={fileInput} type="file" multiple accept=".txt,.md,.markdown,.pdf,.docx,.json,.csv,.log" className="hidden" onChange={(event) => uploadFiles(event.target.files)} />
                <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-medium text-white disabled:opacity-50">
                  {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add File
                </button>
              </div>

              <div className="mt-5 overflow-hidden border border-line bg-white shadow-sm">
                <div className="hidden grid-cols-[minmax(220px,1fr)_120px_100px_100px_140px_34px] gap-3 border-b border-line bg-slate-50 px-4 py-2.5 text-xs font-medium text-slate-500 md:grid">
                  <span>Name</span><span>Status</span><span>Chunks</span><span>Characters</span><span>Uploaded</span><span />
                </div>
                {documents.map((document) => (
                  <button key={document.id} type="button" onClick={() => document.status === "completed" && openChunks(document)} className="grid w-full gap-2 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-slate-50 md:grid-cols-[minmax(220px,1fr)_120px_100px_100px_140px_34px] md:items-center md:gap-3">
                    <span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-teal-700" /><span className="truncate text-sm font-medium text-ink">{document.name}</span></span>
                    <span className={`w-fit rounded px-2 py-1 text-xs ${document.status === "completed" ? "bg-emerald-50 text-emerald-700" : document.status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                      {statusLabel[document.status]}
                    </span>
                    <span className="text-xs text-slate-500"><span className="md:hidden">Chunks </span>{formatNumber(document.chunk_count)}</span>
                    <span className="text-xs text-slate-500"><span className="md:hidden">Characters </span>{formatNumber(document.character_count)}</span>
                    <span className="text-xs text-slate-400">{formatDate(document.created_at)}</span>
                    {document.status === "failed" ? <span onClick={(event) => { event.stopPropagation(); retry(document); }} title="Retry" className="grid h-7 w-7 place-items-center text-red-600"><RotateCcw className="h-4 w-4" /></span> : <ChevronRight className="hidden h-4 w-4 text-slate-300 md:block" />}
                  </button>
                ))}
                {!documents.length ? <div className="py-20 text-center text-sm text-slate-500">No documents yet. Add a file to start building.</div> : null}
              </div>
            </div>
          ) : null}

          {tab === "retrieval" ? (
            <div className="mx-auto max-w-7xl">
              <div><h2 className="text-lg font-semibold text-ink">Retrieval Test</h2><p className="mt-1 text-sm text-slate-500">Enter a real question and inspect the retrieved chunks, scores and ranking.</p></div>
              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(360px,.72fr)_minmax(520px,1.28fr)]">
                <div className="space-y-5">
                  <section className="border border-line bg-white p-4 shadow-sm">
                    <label className="text-xs font-medium text-slate-600">Query text</label>
                    <textarea value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") runRetrieval(); }} maxLength={250} placeholder="e.g. How many days of annual leave can a new employee take?" className="mt-2 min-h-36 w-full resize-y rounded-md border border-line p-3 text-sm leading-6 outline-none focus:border-teal-600" />
                    <div className="mt-3 flex items-center justify-between"><span className="text-xs text-slate-400">{query.length} / 250</span><button type="button" disabled={!query.trim() || testing} onClick={runRetrieval} className="inline-flex h-9 items-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-medium text-white disabled:opacity-40">{testing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Test</button></div>
                  </section>
                  <section className="border border-line bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><History className="h-4 w-4" /> Test History</h3><span className="text-xs text-slate-400">Last {history.length}</span></div>
                    <div className="mt-3 divide-y divide-slate-100">
                      {history.map((item) => <div key={item.id} className="py-3"><div className="truncate text-sm text-slate-700">{item.query}</div><div className="mt-1 flex gap-3 text-xs text-slate-400"><span>{item.result_count} results</span><span>{item.took_ms} ms</span><span>{formatDate(item.created_at)}</span></div></div>)}
                      {!history.length ? <div className="py-8 text-center text-xs text-slate-400">No test history yet</div> : null}
                    </div>
                  </section>
                </div>

                <section className="min-w-0">
                  <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-ink">Retrieval Results</h3>{retrieval ? <span className="text-xs text-slate-500">{retrieval.result_count} results · {retrieval.took_ms} ms</span> : null}</div>
                  {retrieval?.retrieval_config.pipeline?.stages?.length ? (
                    <div className="mt-3 border border-line bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-medium text-slate-600">Retrieval Trace</div>
                        <span className={`rounded px-2 py-1 text-xs font-medium ${retrieval.retrieval_config.answer_gate?.decision === "answer" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                          {answerGateLabel[String(retrieval.retrieval_config.answer_gate?.decision ?? "")] ?? "Pending"}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {retrieval.retrieval_config.pipeline.stages.map((stage, index) => {
                          const name = String(stage.name ?? "unknown");
                          const outputCount = stage.output_count ?? stage.candidate_count;
                          return (
                            <div key={`${name}-${index}`} className="flex items-center gap-2">
                              {index ? <span className="text-slate-300">→</span> : null}
                              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                                {pipelineStageLabel[name] ?? name}{typeof outputCount === "number" ? ` · ${outputCount}` : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {retrieval.retrieval_config.answer_gate?.reason ? <p className="mt-3 text-xs leading-5 text-slate-500">{retrieval.retrieval_config.answer_gate.reason}</p> : null}
                    </div>
                  ) : null}
                  <div className="mt-3 space-y-3">
                    {retrieval?.results.map((result, index) => (
                      <article key={`${result.document_id}-${index}`} className="border border-line bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-teal-50 text-xs font-semibold text-teal-700">{index + 1}</span>
                          <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-medium text-ink">{result.title}</h4><p className="mt-0.5 truncate text-xs text-slate-400">{String(result.metadata.filename ?? result.source_type)}</p></div>
                          <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{result.score.toFixed(3)}</span>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{result.snippet}</p>
                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400"><span>Chunk #{String(result.metadata.chunk_index ?? index + 1)}</span><span>{result.snippet.length} characters</span><span>{String(result.retrieval.keyword_backend ?? result.retrieval.vector_backend ?? "retrieval")}</span><span>{String(result.retrieval.fusion_method ?? retrieval.retrieval_config.fusion_method ?? config.retrieval_method)}</span><span>{String(result.retrieval.rerank_mode ?? result.retrieval.mode ?? "retrieval")}</span></div>
                      </article>
                    ))}
                    {!retrieval ? <div className="grid min-h-80 place-items-center border border-dashed border-slate-300 bg-white text-center"><div><FileSearch className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm text-slate-500">Enter a question to see the actual retrieved chunks</p></div></div> : null}
                    {retrieval && !retrieval.results.length ? <div className="grid min-h-64 place-items-center border border-line bg-white text-sm text-slate-500">No chunks passed the current retrieval conditions.</div> : null}
                  </div>
                </section>
              </div>
            </div>
          ) : null}

          {tab === "settings" ? (
            <div className="mx-auto max-w-4xl">
              <div><h2 className="text-lg font-semibold text-ink">Knowledge Base Settings</h2><p className="mt-1 text-sm text-slate-500">Controls the models and parameters used for future ingestion and retrieval tests.</p></div>
              <div className="mt-5 border border-line bg-white p-5 shadow-sm sm:p-7">
                <RetrievalSettings value={config} catalog={catalog} onChange={setConfig} />
                {message ? <div className="mt-5 flex items-center gap-2 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700"><Check className="h-4 w-4" /> {message}</div> : null}
                <div className="mt-6 flex justify-end border-t border-line pt-5"><button type="button" onClick={saveSettings} disabled={saving || config.chunk_overlap >= config.chunk_size} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-700 px-5 text-sm font-medium text-white disabled:opacity-40">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Settings</button></div>
              </div>
            </div>
          ) : null}
        </main>
      </div>

      {selectedDocument ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={() => setSelectedDocument(null)}>
          <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-line bg-[#f7f8fa] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-white px-5 py-4"><FileText className="h-5 w-5 text-teal-700" /><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-ink">{selectedDocument.name}</h2><p className="text-xs text-slate-400">{selectedDocument.chunk_count} chunks · {formatBytes(selectedDocument.file_size)}</p></div><button title="Close" onClick={() => setSelectedDocument(null)} className="grid h-8 w-8 place-items-center text-slate-500"><X className="h-4 w-4" /></button></header>
            <div className="space-y-3 p-4 sm:p-5">
              {chunks.map((chunk) => <article key={chunk.id} className="border border-line bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold text-teal-700">Chunk #{chunk.position}</span><span className="text-xs text-slate-400">{chunk.character_count} characters</span></div><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{chunk.content}</p></article>)}
              {!chunks.length ? <div className="py-20 text-center text-sm text-slate-500">Loading chunks...</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
