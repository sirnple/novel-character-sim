"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Bot, Send, Loader2, Wrench, HelpCircle, Zap, Check } from "lucide-react";
import Markdown from "@/components/markdown";
import { useNovel } from "@/lib/novel-context";
import { notifyLibrariesRefresh } from "@/lib/library-events";
import { isUserConfirmSave } from "@/lib/analysis-confirm";

const WRITE_AGENT_TYPES = new Set([
  "generate_outline", "write_prose", "review_outline",
  "review_character", "review_continuity", "review_foreshadowing",
  "review_style", "review_world", "review_pacing",
]);

/** Analysis sub-agents via agent(agent_type=...) — verb-object ids + legacy aliases */
const ANALYSIS_AGENT_TYPES = new Set([
  "novel_analysis",
  "analyze_form",
  "analyze_story_world",
  "analyze_character_list",
  "extract_character_detail",
  "extract_character_relationships",
  "analyze_timeline",
  "extract_style",
  "extract_ideas",
  // legacy aliases
  "story_world",
  "form_analysis",
  "resolve_character_roster",
  "character_roster",
  "character_entity_resolve",
  "character_detail",
  "character_detail_agent",
  "character_relationships",
  "timeline_analysis",
  "style_extract",
  "style_extract_agent",
  "idea_extract",
  "idea_extract_agent",
]);

function isSubAgentToolName(name: string) {
  return WRITE_AGENT_TYPES.has(name) || ANALYSIS_AGENT_TYPES.has(name);
}

/** Floating chip strip: jump to sub-agent cards without reordering chat history. */
function SubAgentRunChips(props: {
  chips: Array<{
    toolCallId: string;
    tool: string;
    status: "running" | "done";
    progress?: string;
  }>;
  onJump: (toolCallId: string) => void;
}) {
  if (!props.chips.length) return null;
  const runningN = props.chips.filter((c) => c.status === "running").length;
  const doneN = props.chips.length - runningN;
  return (
    <div className="shrink-0 border-t border-border/60 bg-card/95 backdrop-blur-sm px-2.5 py-2">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-fog font-medium">
          子 Agent
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {runningN > 0
            ? `${runningN} 进行中${doneN ? ` · ${doneN} 已完成` : ""}`
            : `${doneN} 已完成 · 点击跳转`}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-[4.5rem] overflow-y-auto custom-scrollbar">
        {props.chips.map((c) => {
          const label = toolLabel(c.tool);
          const running = c.status === "running";
          return (
            <button
              key={c.toolCallId}
              type="button"
              title={
                running
                  ? `${label} 进行中${c.progress ? ` · ${c.progress}` : ""} · 点击定位`
                  : `${label} 已完成 · 点击定位`
              }
              onClick={() => props.onJump(c.toolCallId)}
              className={`inline-flex items-center gap-1 max-w-[11rem] px-2 py-1 rounded-full text-[11px] border transition-colors ${
                running
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  : "border-emerald-500/35 bg-emerald-500/10 text-emerald-300/90 hover:bg-emerald-500/15"
              }`}
            >
              {running ? (
                <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />
              ) : (
                <Check className="w-2.5 h-2.5 shrink-0" />
              )}
              <span className="truncate">{label}</span>
              {running && c.progress ? (
                <span className="tabular-nums opacity-80 shrink-0">{c.progress}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Reconstruct a valid OpenAI-format conversation from the local UI message
 * history. Tool cards are synthesized into a `tool_calls` array on the
 * preceding assistant message, paired with a `tool` message carrying the
 * matching `tool_call_id`. Without this pairing the API rejects tool
 * messages as orphans ("Messages with role 'tool' must be a response to a
 * preceding message with 'tool_calls'").
 */
function buildOutgoingMessages(messages: AgentMessage[], userMsg: AgentMessage): any[] {
  const out: any[] = [];
  let lastAssistantIdx = -1;
  for (const m of messages) {
    if (m.role === "tool" && m.metadata?.toolCallId) {
      // Skip unanswered questions — user message carries the answer
      if (m.metadata.status === "awaiting_user") continue;
      // Sub-agent UI cards use agentType as tool name; rebuild as agent() for the API
      const metaTool = m.metadata.tool || "unknown";
      const isSub = isSubAgentToolName(metaTool);
      const fnName = isSub ? "agent" : metaTool;
      const args =
        m.metadata.tool === "ask_question" && m.metadata.question
          ? JSON.stringify({ question: m.metadata.question, options: m.metadata.options || [] })
          : isSub
            ? JSON.stringify({ agent_type: metaTool, prompt: "(continued)" })
            : "{}";
      const tc = { id: m.metadata.toolCallId, type: "function", function: { name: fnName, arguments: args } };
      if (lastAssistantIdx >= 0) {
        out[lastAssistantIdx].tool_calls = [...(out[lastAssistantIdx].tool_calls || []), tc];
      } else {
        out.push({ role: "assistant", content: null, tool_calls: [tc] });
        lastAssistantIdx = out.length - 1;
      }
      // For answered ask_question, tool result is the user's choice
      const toolContent =
        m.metadata.tool === "ask_question" && m.metadata.answer
          ? `用户回答：${m.metadata.answer}`
          : m.content;
      out.push({ role: "tool", content: toolContent, tool_call_id: m.metadata.toolCallId });
    } else if (m.role === "tool") {
      // incomplete tool card without a toolCallId — drop
    } else {
      const role = m.role === "agent" ? "assistant" : m.role;
      // Skip empty agent placeholders
      if (role === "assistant" && !m.content?.trim() && !m.metadata) continue;
      out.push({ role, content: m.content });
      if (role === "assistant") lastAssistantIdx = out.length - 1;
    }
  }
  out.push(userMsg);
  return out;
}

interface SubAgentMessage {
  role: string;
  content: string;
  toolName?: string;
}

interface AgentMessage {
  id: string;
  role: "user" | "agent" | "tool";
  content: string;
  metadata?: {
    tool?: string;
    status?: "running" | "done" | "awaiting_user";
    toolCallId?: string;
    subMessages?: SubAgentMessage[];
    /** ask_question */
    question?: string;
    options?: string[];
    answer?: string;
  };
  timestamp: string;
}

const TOOL_LABELS: Record<string, string> = {
  get_outline: "获取大纲",
  get_prose: "获取正文",
  get_findings: "获取审查发现",
  get_branch_text: "获取分支前文",
  get_branch_characters: "获取角色",
  get_branch_timeline: "获取时间线",
  get_branch_world: "获取世界观",
  get_branch_meta: "获取分支信息",
  get_novel_form: "获取目录/章法",
  save_outline: "保存大纲",
  save_prose: "保存正文",
  save_findings: "保存审查发现",
  clear_findings: "清空审查发现",
  get_current_novel: "当前小说",
  get_current_branch: "当前分支",
  get_analysis_context: "分析上下文",
  get_analysis_status: "分析状态",
  run_form_analysis: "程序·章法一键(兼容)",
  scan_chapter_catalog: "扫描章节目录",
  build_form_draft: "建章法草稿",
  list_form_catalog: "分页列目录",
  apply_catalog_tracks: "修正章节轨",
  set_form_narrative: "写入形态字段",
  enrich_form_draft: "LLM补全章法(旧)",
  submit_form: "提交章法",
  scan_character_mentions: "扫描角色指称",
  list_cross_name_candidates: "异名怀疑列表",
  resolve_cross_name_pair: "异名对表态",
  list_surface_candidates: "列出称呼候选",
  lookup_surface: "查称呼上下文(可批)",
  lookup_offset: "按位置读文(可批)",
  submit_character_entities: "提交角色实体",
  finish_novel_analysis: "完成分析",
  list_text_units: "列出章节单元",
  get_unit_text: "读单元正文(可批)",
  get_kept_roster: "角色名单摘要",
  // Sub-agents — 动宾中文名
  analyze_form: "分析章法",
  analyze_story_world: "分析故事世界",
  analyze_character_list: "分析角色列表",
  extract_character_detail: "抽取角色详情",
  extract_character_relationships: "抽取角色关系",
  analyze_timeline: "分析时间线",
  extract_style: "抽取文风",
  extract_ideas: "抽取点子",
  // legacy aliases
  story_world: "分析故事世界",
  form_analysis: "分析章法",
  resolve_character_roster: "分析角色列表",
  character_roster: "分析角色列表",
  character_entity_resolve: "分析角色列表",
  character_detail: "抽取角色详情",
  character_detail_agent: "抽取角色详情",
  character_relationships: "抽取角色关系",
  timeline_analysis: "分析时间线",
  style_extract: "抽取文风",
  style_extract_agent: "抽取文风",
  idea_extract: "抽取点子",
  idea_extract_agent: "抽取点子",
  agent: "调用子 Agent",
};

function toolLabel(name?: string) {
  if (!name) return "tool";
  return TOOL_LABELS[name] || name;
}

/** Expand legacy trails that still stringify Anthropic tool blocks as JSON. */
function normalizeSubMessages(messages: SubAgentMessage[]): SubAgentMessage[] {
  const out: SubAgentMessage[] = [];
  for (const sm of messages) {
    const raw = (sm.content || "").trim();
    if (
      (sm.role === "assistant" || sm.role === "user" || sm.role === "tool") &&
      (raw.startsWith("[") || raw.startsWith("{"))
    ) {
      try {
        const parsed = JSON.parse(raw);
        const blocks = Array.isArray(parsed) ? parsed : [parsed];
        if (blocks.length > 0 && blocks[0] && typeof blocks[0] === "object" && "type" in blocks[0]) {
          for (const b of blocks) {
            if (b.type === "tool_use") {
              out.push({
                role: "tool_call",
                toolName: String(b.name || "tool"),
                content: b.input && Object.keys(b.input).length
                  ? JSON.stringify(b.input, null, 2)
                  : "(无参数)",
              });
            } else if (b.type === "tool_result") {
              const body = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "", null, 2);
              out.push({ role: "tool_result", toolName: "tool", content: body });
            } else if (b.type === "text" && b.text) {
              out.push({ role: sm.role === "user" ? "user" : "assistant", content: String(b.text) });
            }
          }
          continue;
        }
      } catch { /* not JSON blocks — fall through */ }
    }
    out.push(sm);
  }
  return out;
}

/**
 * Nested scroll: keep wheel on this box while it can still scroll,
 * so the outer chat list does not steal the gesture mid-card.
 */
function nestedScrollWheel(
  e: React.WheelEvent<HTMLElement>,
): void {
  const el = e.currentTarget;
  const { scrollTop, scrollHeight, clientHeight } = el;
  if (scrollHeight <= clientHeight + 1) return;
  const atTop = scrollTop <= 0;
  const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
  if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
    return;
  }
  e.stopPropagation();
}

function PrettyBody({ text, className }: { text: string; className?: string }) {
  const trimmed = text.trim();
  let pretty = text;
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length > 1) {
    try {
      pretty = JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch { /* keep */ }
  }
  return (
    <pre
      className={
        className ||
        "text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto overscroll-contain custom-scrollbar"
      }
      onWheel={nestedScrollWheel}
    >
      {pretty}
    </pre>
  );
}

const SEV_UI: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  major: "bg-primary/15 text-primary border-primary/30",
  minor: "bg-neutral-700/40 text-muted-foreground border-neutral-600/40",
  致命: "bg-red-500/15 text-red-400 border-red-500/30",
  重要: "bg-primary/15 text-primary border-primary/30",
  次要: "bg-neutral-700/40 text-muted-foreground border-neutral-600/40",
};

/** Render findings: JSON array → cards; otherwise markdown (new readable format). */
function FindingsDisplay({ text }: { text: string }) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return <div className="text-xs text-fog">（空）</div>;
  }

  // Legacy: raw JSON array of findings
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        if (arr.length === 0) {
          return <div className="text-xs text-green-600/80">暂无问题</div>;
        }
        return (
          <div className="space-y-2 max-h-[280px] overflow-y-auto">
            {arr.map((f: any, i: number) => {
              const sev = String(f.severity || "minor");
              return (
                <div key={i} className="rounded-lg border border-border/80 bg-background p-2 space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${SEV_UI[sev] || SEV_UI.minor}`}>
                      {sev}
                    </span>
                    {f.dimension && (
                      <span className="text-xs text-muted-foreground">{f.dimension}</span>
                    )}
                  </div>
                  <div className="text-xs text-foreground/90 leading-relaxed">{String(f.description || "")}</div>
                  {f.suggestion && (
                    <div className="text-xs text-emerald-500/80 leading-relaxed">
                      → {String(f.suggestion)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      }
    } catch { /* fall through to markdown */ }
  }

  return (
    <div className="text-xs text-foreground/90 leading-relaxed max-h-[280px] overflow-y-auto prose-headings:text-muted-foreground prose-headings:text-xs prose-headings:prose-headings:mt-2 prose-headings:mb-1">
      <Markdown>{trimmed}</Markdown>
    </div>
  );
}

function isFindingsTool(name?: string) {
  return name === "get_findings";
}

type TranscriptItem =
  | { kind: "message"; msg: SubAgentMessage; key: string }
  | { kind: "tool"; call?: SubAgentMessage; result?: SubAgentMessage; key: string };

/** Pair consecutive tool_call + tool_result into one UI unit */
function groupTranscript(messages: SubAgentMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  for (let i = 0; i < messages.length; i++) {
    const sm = messages[i];
    if (sm.role === "tool_call") {
      const next = messages[i + 1];
      if (next && (next.role === "tool_result" || next.role === "tool")) {
        items.push({ kind: "tool", call: sm, result: next, key: `tool-${i}` });
        i++;
      } else {
        items.push({ kind: "tool", call: sm, key: `tool-${i}` });
      }
    } else if (sm.role === "tool_result" || sm.role === "tool") {
      items.push({ kind: "tool", result: sm, key: `tool-${i}` });
    } else {
      items.push({ kind: "message", msg: sm, key: `msg-${i}` });
    }
  }
  return items;
}

/** Parse live tool progress lines: 【进度】扫描角色指称 12/48（25%）· 第12章 */
function parseToolProgress(text?: string): {
  label: string;
  done: number;
  total: number;
  pct: number;
  detail: string;
} | null {
  if (!text) return null;
  const m = text.match(
    /【进度】([^\s]+)?\s*(\d+)\s*\/\s*(\d+)(?:（(\d+)%）)?(?:\s*·\s*(.+))?/,
  );
  if (!m) {
    // also accept plain: 扫描角色指称 12/48
    const m2 = text.match(/(扫描角色指称)\s+(\d+)\s*\/\s*(\d+)/);
    if (!m2) return null;
    const done = parseInt(m2[2], 10);
    const total = parseInt(m2[3], 10) || 1;
    return {
      label: m2[1],
      done,
      total,
      pct: Math.round((done / total) * 100),
      detail: "",
    };
  }
  const done = parseInt(m[2], 10);
  const total = Math.max(1, parseInt(m[3], 10) || 1);
  const pct = m[4] != null ? parseInt(m[4], 10) : Math.round((done / total) * 100);
  return {
    label: (m[1] || "进度").trim(),
    done,
    total,
    pct,
    detail: (m[5] || "").trim(),
  };
}

function ToolProgressBar({
  progress,
}: {
  progress: { label: string; done: number; total: number; pct: number; detail: string };
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-primary/90 flex items-center gap-1.5 flex-wrap">
        <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />
        <span>
          {progress.label} {progress.done}/{progress.total}（{progress.pct}%）
        </span>
        {progress.detail ? (
          <span className="text-muted-foreground truncate max-w-[14rem]">
            · {progress.detail}
          </span>
        ) : null}
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full bg-primary/80 transition-[width] duration-300 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, progress.pct))}%` }}
        />
      </div>
    </div>
  );
}

/** One collapsed card: tool name · args (if any) · result preview */
function ToolPairCard({ call, result }: { call?: SubAgentMessage; result?: SubAgentMessage }) {
  const name = call?.toolName || result?.toolName;
  const callBody = call?.content || "";
  const progress = parseToolProgress(callBody);
  const argsOnly = callBody
    .split(/\n\n【进度】/)[0]
    ?.replace(/\n\n扫描角色指称\s+\d+\/\d+[\s\S]*$/, "")
    .trim();
  const noArgs = !argsOnly || argsOnly === "(无参数)" || argsOnly === "{}";
  const pending = !!call && !result;
  const resultLen = result?.content?.length ?? 0;

  return (
    <div className="flex justify-start">
      <details
        className="max-w-[95%] w-full rounded-lg border border-border/50 bg-neutral-900/40 group"
        open={pending && !!progress}
      >
        <summary className="cursor-pointer list-none px-2.5 py-1.5 text-xs flex items-center gap-1.5 select-none text-foreground/90">
          <span className="text-fog group-open:rotate-90 transition-transform inline-block">▸</span>
          <Wrench className="w-3 h-3 shrink-0 text-sky-500" />
          <span className="text-sky-400/90">工具</span>
          <span className="px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-200 text-xs">
            {toolLabel(name)}
          </span>
          {name && TOOL_LABELS[name] && (
            <span className="text-fog text-xs">{name}</span>
          )}
          <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
            {pending ? (
              progress ? (
                <span className="text-primary/90 truncate max-w-[10rem]">
                  {progress.done}/{progress.total} · {progress.pct}%
                </span>
              ) : (
                <span className="text-primary/80 flex items-center gap-1">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />执行中
                </span>
              )
            ) : (
              <span className="text-emerald-600/80">{resultLen} 字</span>
            )}
            <span className="text-fog shrink-0">展开</span>
          </span>
        </summary>
        <div className="px-2.5 pb-2 space-y-2 border-t border-border/50 pt-2">
          {call && (
            <div>
              <div className="text-xs text-sky-600/90 mb-0.5">参数</div>
              {noArgs ? (
                <div className="text-xs text-fog">（无参数）</div>
              ) : (
                <PrettyBody
                  text={argsOnly}
                  className="text-xs text-sky-200/70  font-mono whitespace-pre-wrap break-all max-h-[160px] overflow-y-auto overscroll-contain custom-scrollbar bg-sky-950/20 rounded p-1.5"
                />
              )}
            </div>
          )}
          <div>
            <div className="text-xs text-emerald-600/90 mb-0.5">返回</div>
            {pending ? (
              progress ? (
                <ToolProgressBar progress={progress} />
              ) : (
                <div className="text-xs text-fog flex items-center gap-1">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />等待结果…
                </div>
              )
            ) : result ? (
              !(result.content || "").trim() ? (
                <div className="text-xs text-amber-500/90">
                  （返回正文为空 — 工具未写入 content，属异常）
                </div>
              ) : isFindingsTool(name) ? (
                <div className="bg-emerald-950/15 rounded p-1.5">
                  <FindingsDisplay text={result.content} />
                </div>
              ) : (
                <PrettyBody
                  text={result.content}
                  className="text-xs text-muted-foreground  font-mono leading-relaxed whitespace-pre-wrap max-h-[min(40vh,320px)] overflow-y-auto overscroll-contain custom-scrollbar bg-emerald-950/15 rounded p-1.5"
                />
              )
            ) : (
              <div className="text-xs text-fog">（无返回）</div>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

/** Chat-style transcript inside a sub-agent tool card */
function SubAgentTranscript({ messages }: { messages: SubAgentMessage[] }) {
  const items = groupTranscript(normalizeSubMessages(messages));
  return (
    <div
      className="mt-1 space-y-2 max-h-[min(70vh,560px)] overflow-y-auto overscroll-contain custom-scrollbar bg-background rounded-lg p-2.5 border border-border/60"
      onWheel={nestedScrollWheel}
    >
      {items.map((item) => {
        if (item.kind === "tool") {
          return <ToolPairCard key={item.key} call={item.call} result={item.result} />;
        }

        const sm = item.msg;
        if (sm.role === "system") {
          return (
            <details key={item.key} className="group">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-muted-foreground list-none flex items-center gap-1.5">
                <span className="text-fog">▸</span>
                <span className="uppercase tracking-wide">System</span>
                <span className="text-fog">({sm.content.length} 字)</span>
              </summary>
              <div
                className="mt-1.5 text-xs text-muted-foreground leading-relaxed bg-background rounded-lg p-2.5 border border-border/50 max-h-[200px] overflow-y-auto overscroll-contain custom-scrollbar"
                onWheel={nestedScrollWheel}
              >
                <Markdown>{sm.content}</Markdown>
              </div>
            </details>
          );
        }

        const isUser = sm.role === "user";
        return (
          <div key={item.key} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                isUser
                  ? "bg-primary/15 text-orange-100/90 border border-primary/25 rounded-br-md"
                  : "bg-secondary/70 text-foreground border border-border/40 rounded-bl-md"
              }`}
            >
              <div className={`text-xs mb-1 ${isUser ? "text-primary/70" : "text-muted-foreground"}`}>
                {isUser ? "任务" : "Agent"}
              </div>
              {sm.content ? (
                <Markdown>{sm.content}</Markdown>
              ) : (
                <span className="text-fog italic">（空）</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface AgentPanelProps {
  novelTitle?: string;
  characters?: any[];
  novelText?: string;
  continueFromOffset?: number;
  continueFromLabel?: string;
  branchId?: string;
  novelId?: string;
  onOutlineGenerated?: (outline: any) => void;
  /**
   * write = 续写主编（默认）；analysis = 全书分析主编（概览）
   */
  mode?: "write" | "analysis";
  /** analysis 完成回调（finish 或用户结束） */
  onAnalysisDone?: () => void;
}

export default function AgentPanel({
  novelTitle,
  characters,
  novelText,
  continueFromOffset,
  continueFromLabel,
  branchId,
  novelId,
  onOutlineGenerated,
  mode = "write",
  onAnalysisDone,
}: AgentPanelProps) {
  const isAnalysis = mode === "analysis";
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [status, setStatus] = useState<"idle" | "generating">("idle");
  const [input, setInput] = useState("");
  const [fsStatus, setFsStatus] = useState<{
    hasProseDraft: boolean;
    proseLength: number;
    pass: boolean | null;
    hasRealization: boolean;
    activeCount: number;
    loading?: boolean;
    message?: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  /** When false, user scrolled up to read history — do not yank to bottom on stream. */
  const stickToBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<AgentMessage[]>([]);
  const {
    setNovel,
    selectedStyleId,
    selectedIdeaIds,
    autoPickIdeas,
  } = useNovel();

  const refreshFsStatus = useCallback(async () => {
    if (!novelId || !branchId) return;
    try {
      const res = await fetch(
        `/api/foreshadowing?novelId=${encodeURIComponent(novelId)}&branchId=${encodeURIComponent(branchId)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setFsStatus({
        hasProseDraft: !!data.hasProseDraft,
        proseLength: data.proseLength || 0,
        pass: data.realization ? !!data.realization.pass : null,
        hasRealization: !!data.realization,
        activeCount: data.ledger?.active?.length || 0,
      });
    } catch {
      /* ignore */
    }
  }, [novelId, branchId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /** Keep completed sub-agent chips visible briefly after the last one finishes. */
  const [lingerSubAgentChips, setLingerSubAgentChips] = useState(false);
  const subAgentChipSource = useMemo(() => {
    return messages.filter(
      (m) =>
        m.role === "tool" &&
        m.metadata?.toolCallId &&
        isSubAgentToolName(m.metadata?.tool || "") &&
        (m.metadata?.status === "running" || m.metadata?.status === "done"),
    );
  }, [messages]);
  const hasRunningSubAgent = subAgentChipSource.some(
    (m) => m.metadata?.status === "running",
  );
  useEffect(() => {
    if (hasRunningSubAgent) {
      setLingerSubAgentChips(true);
      return;
    }
    if (!lingerSubAgentChips) return;
    const t = window.setTimeout(() => setLingerSubAgentChips(false), 12_000);
    return () => window.clearTimeout(t);
  }, [hasRunningSubAgent, lingerSubAgentChips]);

  const subAgentChips = useMemo(() => {
    const show =
      hasRunningSubAgent ||
      (lingerSubAgentChips && subAgentChipSource.length > 0) ||
      (status === "generating" && subAgentChipSource.length > 0);
    if (!show) return [];
    return subAgentChipSource.map((m) => {
      const running = m.metadata?.status === "running";
      const p = running ? parseToolProgress(m.content) : null;
      return {
        toolCallId: m.metadata!.toolCallId as string,
        tool: m.metadata?.tool || "agent",
        status: (running ? "running" : "done") as "running" | "done",
        progress: p ? `${p.done}/${p.total}` : undefined,
      };
    });
  }, [
    hasRunningSubAgent,
    lingerSubAgentChips,
    subAgentChipSource,
    status,
  ]);

  const jumpToToolCard = useCallback((toolCallId: string) => {
    stickToBottomRef.current = false;
    const root = messagesScrollRef.current;
    if (!root) return;
    const safe =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(toolCallId)
        : toolCallId.replace(/"/g, '\\"');
    const el = root.querySelector(
      `[data-tool-call-id="${safe}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-primary/50");
    window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-primary/50");
    }, 1600);
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = messagesScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [messages]);

  useEffect(() => {
    refreshFsStatus();
  }, [refreshFsStatus, status]);

  const runChat = useCallback(async (
    history: AgentMessage[],
    userMsg: AgentMessage,
    opts?: { autoPassCheckpoints?: boolean },
  ) => {
    setStatus("generating");
    const abort = new AbortController();
    abortRef.current = abort;
    const autoPassCheckpoints = !!opts?.autoPassCheckpoints;

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: buildOutgoingMessages(history, userMsg),
          branchId: branchId || "main",
          novelId,
          selectedStyleId: selectedStyleId ?? null,
          selectedIdeaIds: selectedIdeaIds || [],
          autoPickIdeas: autoPickIdeas !== false,
          autoPassCheckpoints: isAnalysis ? false : autoPassCheckpoints,
          mode: isAnalysis ? "analysis" : "write",
          // Analysis always re-runs (no catalog / domain cache reuse)
          forceRefresh: isAnalysis,
        }),
        signal: abort.signal,
      });
      if (!res.ok) throw new Error("Failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      let agentContent = "";
      let currentTextMsgId: string | null = Math.random().toString(36).slice(2);

      // First agent message — will be replaced if not used
      const firstId = currentTextMsgId;
      setMessages(prev => [...prev, {
        id: firstId, role: "agent", content: "",
        timestamp: new Date().toISOString(),
      }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "chunk") {
              agentContent = event.content;
              if (!currentTextMsgId) {
                currentTextMsgId = Math.random().toString(36).slice(2);
                const id = currentTextMsgId;
                setMessages(prev => [...prev, {
                  id, role: "agent", content: "",
                  timestamp: new Date().toISOString(),
                }]);
              }
              setMessages(prev => prev.map(m =>
                m.id === currentTextMsgId ? { ...m, content: agentContent } : m
              ));
            } else if (event.type === "tool_chunk") {
              setMessages(prev => prev.map(m =>
                m.metadata?.toolCallId === event.toolCallId
                  ? { ...m, content: event.content }
                  : m
              ));
              // Do not bind tool_chunk stream to reading pane — intermediate
              // "先获取大纲…" chatter was being shown as appended 正文.
            } else if (event.type === "tool_trail") {
              // Live sub-agent conversation (system/user/tool/assistant) while still running
              const trailMsgs: SubAgentMessage[] = event.messages || [];
              const lastTrail = trailMsgs[trailMsgs.length - 1];
              // Keep stream buffer only while the latest turn is still an assistant draft;
              // clear it after tool_call/tool_result so we don't re-append stale text.
              const streamContent = lastTrail?.role === "assistant" ? (lastTrail.content || "") : "";
              setMessages(prev => prev.map(m =>
                m.metadata?.toolCallId === event.toolCallId
                  ? {
                      ...m,
                      content: streamContent,
                      metadata: {
                        ...m.metadata,
                        tool: event.tool || m.metadata?.tool,
                        status: m.metadata?.status || "running",
                        toolCallId: event.toolCallId,
                        subMessages: trailMsgs,
                      },
                    }
                  : m
              ));
            } else if (event.type === "ask_question") {
              currentTextMsgId = null;
              const question = String(event.question || "");
              const options = Array.isArray(event.options) ? event.options.map(String) : [];
              setMessages(prev => {
                const existing = prev.find(m => m.metadata?.toolCallId === event.toolCallId);
                const data = {
                  content: question,
                  metadata: {
                    tool: "ask_question" as const,
                    status: "awaiting_user" as const,
                    toolCallId: event.toolCallId as string,
                    question,
                    options,
                  },
                };
                // Drop empty agent placeholder so the question card is the focus
                const cleaned = prev.filter(m => !(m.role === "agent" && !m.content?.trim()));
                if (existing) {
                  return cleaned.map(m => m.id === existing.id ? { ...m, ...data } : m);
                }
                return [...cleaned, {
                  id: Math.random().toString(36).slice(2),
                  role: "tool" as const,
                  ...data,
                  timestamp: new Date().toISOString(),
                }];
              });
            } else if (event.type === "ask_question_auto") {
              // 一键续写：审核卡点已自动通过
              currentTextMsgId = null;
              const question = String(event.question || "");
              const options = Array.isArray(event.options) ? event.options.map(String) : [];
              const answer = String(event.answer || "");
              setMessages(prev => {
                const existing = prev.find(m => m.metadata?.toolCallId === event.toolCallId);
                const data = {
                  content: answer || question,
                  metadata: {
                    tool: "ask_question" as const,
                    status: "done" as const,
                    toolCallId: event.toolCallId as string,
                    question,
                    options,
                    answer: answer ? `（一键续写自动通过）${answer}` : "（一键续写自动通过）",
                  },
                };
                if (existing) {
                  return prev.map(m => m.id === existing.id ? { ...m, ...data } : m);
                }
                return [...prev, {
                  id: Math.random().toString(36).slice(2),
                  role: "tool" as const,
                  ...data,
                  timestamp: new Date().toISOString(),
                }];
              });
            } else if (event.type === "tool_call") {
              if (event.status === "running") {
                currentTextMsgId = null;
                setMessages(prev => [...prev, {
                  id: Math.random().toString(36).slice(2), role: "tool", content: "",
                  metadata: { tool: event.tool, status: "running", toolCallId: event.toolCallId, subMessages: [] },
                  timestamp: new Date().toISOString(),
                }]);
              } else if (event.status === "awaiting_user") {
                currentTextMsgId = null;
                let question = "";
                let options: string[] = [];
                try {
                  const parsed = JSON.parse(event.result || "{}");
                  question = String(parsed.question || "");
                  options = Array.isArray(parsed.options) ? parsed.options.map(String) : [];
                } catch { /* ignore */ }
                setMessages(prev => {
                  const existing = prev.find(m => m.metadata?.toolCallId === event.toolCallId);
                  const data = {
                    content: question || event.result || "",
                    metadata: {
                      tool: "ask_question",
                      status: "awaiting_user" as const,
                      toolCallId: event.toolCallId,
                      question: question || existing?.metadata?.question,
                      options: options.length ? options : (existing?.metadata?.options || []),
                    },
                  };
                  if (existing) {
                    return prev.map(m => m.id === existing.id ? { ...m, ...data } : m);
                  }
                  return [...prev, { id: Math.random().toString(36).slice(2), role: "tool", ...data, timestamp: new Date().toISOString() }];
                });
              } else if (event.status === "done") {
                currentTextMsgId = null;
                setMessages(prev => {
                  const existing = prev.find(m => m.metadata?.toolCallId === event.toolCallId);
                  // Preserve auto-pass answer if tool result JSON carries it
                  let answer = existing?.metadata?.answer;
                  let question = existing?.metadata?.question;
                  let options = existing?.metadata?.options;
                  if (event.tool === "ask_question" && event.result) {
                    try {
                      const parsed = JSON.parse(event.result);
                      if (parsed?.autoPassed && parsed?.answer) {
                        answer = answer || `（一键续写自动通过）${parsed.answer}`;
                      }
                      if (parsed?.question) question = question || String(parsed.question);
                      if (Array.isArray(parsed?.options)) options = options || parsed.options.map(String);
                    } catch { /* ignore */ }
                  }
                  const data = {
                    content: event.result || "",
                    metadata: {
                      tool: event.tool,
                      status: "done" as const,
                      toolCallId: event.toolCallId,
                      // Prefer final messages; keep live trail if done payload omitted them
                      subMessages: (event.messages && event.messages.length > 0)
                        ? event.messages
                        : (existing?.metadata?.subMessages || []),
                      question,
                      options,
                      answer,
                    },
                  };
                  if (existing) {
                    return prev.map(m => m.id === existing.id ? { ...m, ...data } : m);
                  }
                  return [...prev, { id: Math.random().toString(36).slice(2), role: "tool", ...data, timestamp: new Date().toISOString() }];
                });
              }
            } else if (event.type === "error") {
              if (currentTextMsgId) {
                setMessages(prev => prev.map(m =>
                  m.id === currentTextMsgId ? { ...m, content: "**出错了**: " + event.message } : m
                ));
              } else {
                setMessages(prev => [...prev, {
                  id: Math.random().toString(36).slice(2),
                  role: "agent", content: "**出错了**: " + event.message,
                  timestamp: new Date().toISOString(),
                }]);
              }
            } else if (event.type === "stopped") {
              if (currentTextMsgId) {
                setMessages(prev => prev.map(m =>
                  m.id === currentTextMsgId && !m.content ? { ...m, content: "**已停止**" } : m
                ));
              } else {
                setMessages(prev => [...prev, {
                  id: Math.random().toString(36).slice(2),
                  role: "agent", content: "**已停止**",
                  timestamp: new Date().toISOString(),
                }]);
              }
            } else if (event.type === "continuation_accepted") {
              const bid = String(event.branchId || branchId || "main");
              const totalLength =
                typeof event.totalLength === "number"
                  ? event.totalLength
                  : typeof event.text === "string"
                    ? event.text.length
                    : undefined;
              setNovel({ generatedProse: undefined });
              if (bid === "main" && typeof totalLength === "number") {
                setNovel({ novelLength: totalLength });
              }
              // Client refetches branch body; optional small text still supported
              window.dispatchEvent(
                new CustomEvent("ncs:branch-updated", {
                  detail: {
                    novelId: event.novelId || novelId,
                    branchId: bid,
                    totalLength,
                    text: typeof event.text === "string" && event.text.length <= 160_000
                      ? event.text
                      : undefined,
                  },
                }),
              );
              refreshFsStatus();
            }
          } catch {}
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMessages(prev => [...prev, {
          id: Math.random().toString(36).slice(2),
          role: "agent", content: "**连接失败**: " + (e as Error).message,
          timestamp: new Date().toISOString(),
        }]);
      }
    }
    abortRef.current = null;
    setStatus("idle");
    refreshFsStatus();
    // Analysis finished (or stopped): refresh overview meta + libraries
    if (isAnalysis) {
      try {
        notifyLibrariesRefresh();
      } catch { /* ignore */ }
      onAnalysisDone?.();
    }
    // Load final save_prose draft for reading pane (not stream junk)
    if (novelId && branchId && !isAnalysis) {
      try {
        const dr = await fetch(
          `/api/agent/draft?novelId=${encodeURIComponent(novelId)}&branchId=${encodeURIComponent(branchId)}`,
        );
        if (dr.ok) {
          const d = await dr.json();
          if (d.prose && d.prose.length > 50) {
            setNovel({ generatedProse: d.prose });
          }
        }
      } catch { /* ignore */ }
    }
  }, [
    branchId,
    novelId,
    setNovel,
    selectedStyleId,
    selectedIdeaIds,
    autoPickIdeas,
    refreshFsStatus,
    isAnalysis,
    onAnalysisDone,
  ]);

  const handleSend = async (overrideText?: string, opts?: { autoPassCheckpoints?: boolean }) => {
    const text = (overrideText ?? input).trim();
    if (!text || status === "generating") return;
    const userMsg: AgentMessage = {
      id: Math.random().toString(36).slice(2),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    // If a question is waiting, treat this reply as the answer
    const history = messagesRef.current.map(m =>
      m.metadata?.status === "awaiting_user" && m.metadata.tool === "ask_question"
        ? {
            ...m,
            content: text,
            metadata: { ...m.metadata, status: "done" as const, answer: text },
          }
        : m
    );
    stickToBottomRef.current = true;
    setMessages([...history, userMsg]);
    if (!overrideText) setInput("");
    await runChat(history, userMsg, opts);
  };

  /** 一键续写：全流程自动推进，审核卡点全部自动通过 */
  const handleOneClickContinue = async () => {
    if (status === "generating" || !branchId || !novelId || isAnalysis) return;
    const text =
      "请对本分支进行【一键续写】：按标准流程完成 大纲→大纲审核→写正文→六维审查→接受续写写入分支。" +
      "所有审核卡点自动通过，不要停下来等我确认。完成后简要汇报。";
    await handleSend(text, { autoPassCheckpoints: true });
  };

  /** 一键全书分析：有已完成域时必须 ask_question，再按选择派工 */
  const handleOneClickAnalyze = async () => {
    if (status === "generating" || !novelId) return;
    const text =
      `请【续跑/完整分析】。` +
      `先 get_current_novel + get_current_branch + get_analysis_status。` +
      `范围不清时 ask_question：选项必须无歧义（禁止「全部重新分析」这种说不清范围的）；` +
      `角色拆名单/详情/关系；中文写清将运行什么；各域已齐勿问确认保存。禁止自己写长文。`;
    // onAnalysisDone runs at end of runChat when isAnalysis
    await handleSend(text);
  };

  /** Answer an ask_question card: mark answered + send as user message */
  const handleAnswerQuestion = async (msgId: string, answer: string) => {
    if (!answer.trim() || status === "generating") return;
    const ans = answer.trim();
    const history = messagesRef.current.map(m =>
      m.id === msgId
        ? {
            ...m,
            content: ans,
            metadata: {
              ...m.metadata,
              status: "done" as const,
              answer: ans,
            },
          }
        : m
    );
    const userMsg: AgentMessage = {
      id: Math.random().toString(36).slice(2),
      role: "user",
      content: ans,
      timestamp: new Date().toISOString(),
    };
    setMessages([...history, userMsg]);

    // Analysis: user confirmed save → commit workspace in code (don't rely on LLM finish)
    if (isAnalysis && novelId && isUserConfirmSave(ans)) {
      try {
        const res = await fetch("/api/analysis/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            novelId,
            branchId: branchId || "main",
            userConfirmed: true,
          }),
        });
        const data = await res.json().catch(() => ({}));
        const nChars = typeof data.characters === "number" ? data.characters : 0;
        const committed = Array.isArray(data.committed) ? data.committed : [];
        const skipped = Array.isArray(data.skipped) ? data.skipped : [];
        const ok = res.ok && (data.ok === true || committed.length > 0);
        const charLine = committed.find((c: string) => String(c).startsWith("characters"));
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).slice(2),
            role: "agent",
            content: ok
              ? `**已保存到本书**\n- 角色：${nChars} 人${charLine ? `（${charLine}）` : nChars === 0 ? " ⚠️ 工作区无角色草稿，请重跑角色列表/详情后再保存" : ""}\n- committed: ${committed.join(", ") || "无"}\n- skipped: ${skipped.join(", ") || "无"}`
              : `**保存未完成**（角色 ${nChars}）\n${data.content || data.error || res.statusText}\nskipped: ${skipped.join(", ")}`,
            timestamp: new Date().toISOString(),
          },
        ]);
        try {
          notifyLibrariesRefresh();
        } catch { /* ignore */ }
        onAnalysisDone?.();
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          {
            id: Math.random().toString(36).slice(2),
            role: "agent",
            content: `**保存失败**：${(e as Error).message}`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
      // Still continue chat so master can acknowledge; commit already done
    }

    await runChat(history, userMsg);
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const toolNames: Record<string, string> = {
    generate_outline: "大纲 Agent", write_prose: "Writer Agent",
    review_outline: "大纲审核",
    review_character: "角色审查", review_continuity: "连贯与逻辑审查",
    review_foreshadowing: "伏笔审查", review_style: "风格审查",
    review_world: "世界观审查", review_pacing: "节奏审查",
    get_novel_context: "获取原文", get_characters: "获取角色",
    get_timeline: "获取时间线", get_codex: "获取创作法典",
    get_world_bible: "获取世界观",
    get_findings: "审查清单", get_outline: "获取大纲",
    get_branch_text: "分支前文", get_branch_characters: "角色",
    clear_findings: "清空审查",
    ask_question: "向你提问",
    run_reviews: "六维审查（并行）",
    accept_continuation: "接受续写",
    ...TOOL_LABELS,
    analyze_form: "分析章法",
    analyze_story_world: "分析故事世界",
    analyze_character_list: "分析角色列表",
    resolve_character_roster: "分析角色列表",
    extract_character_detail: "抽取角色详情",
    extract_character_relationships: "抽取角色关系",
    analyze_timeline: "分析时间线",
    extract_style: "抽取文风",
    extract_ideas: "抽取点子",
  };

  // External trigger: overview FAB → 一键分析
  useEffect(() => {
    if (!isAnalysis) return;
    const onExt = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (d.novelId && novelId && d.novelId !== novelId) return;
      void handleOneClickAnalyze();
    };
    window.addEventListener("ncs:start-analysis", onExt as EventListener);
    return () => window.removeEventListener("ncs:start-analysis", onExt as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable listener; handleOneClickAnalyze closes over latest
  }, [isAnalysis, novelId]);

  return (
    <div className="flex flex-col h-full bg-card min-h-0">
      {/*
        No second title bar — layout already shows「分析助手」/「助手」+ 关闭.
        One-click actions live in empty state / stay available near input when chat has messages.
      */}

      {/* Messages */}
      <div
        ref={messagesScrollRef}
        className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 min-h-0"
        onScroll={(e) => {
          const el = e.currentTarget;
          const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
          stickToBottomRef.current = dist < 80;
        }}
      >
        {messages.length === 0 && (
          <div className="text-center py-8 text-fog text-xs">
            <Bot className="w-6 h-6 mx-auto mb-2 opacity-30" />
            {isAnalysis ? (
              <>
                我是全书分析助手。组织章法、角色、故事、时间线、文风与点子。
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => handleOneClickAnalyze()}
                    disabled={!novelId || status === "generating"}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
                  >
                    <Zap className="w-3 h-3" />
                    一键分析
                  </button>
                </div>
              </>
            ) : (
              <>
                我是你的创作助手。告诉我你想做什么——续写、修改大纲、检查 prose。
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => handleOneClickContinue()}
                    disabled={!branchId || !novelId || status === "generating"}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-amber-500/40 bg-amber-500/10 text-amber-200/90 hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
                  >
                    <Zap className="w-3 h-3" />
                    一键续写（审核自动通过）
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {messages.map(msg => {
          // Tool card
          if (msg.role === "tool") {
            const isRunning = msg.metadata?.status === "running";
            const isDone = msg.metadata?.status === "done";
            const isAwaiting = msg.metadata?.status === "awaiting_user";
            const isAsk = msg.metadata?.tool === "ask_question";
            const isReview = msg.metadata?.tool?.startsWith("review_");
            const hasFindings = msg.content && !msg.content.includes('"findings":[]') && !msg.content.includes('"converged":true');

            // Interactive question card
            if (isAsk) {
              const question = msg.metadata?.question || msg.content || "请选择";
              const options = msg.metadata?.options || [];
              const answer = msg.metadata?.answer;
              return (
                <div
                  key={msg.id}
                  className={`rounded-lg border p-3 space-y-2.5 ${
                    isAwaiting
                      ? "bg-primary/[0.06] border-primary/30"
                      : "bg-secondary/20 border-border/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <HelpCircle className={`w-3.5 h-3.5 ${isAwaiting ? "text-primary" : "text-muted-foreground"}`} />
                    <span className={`text-xs uppercase tracking-wider ${isAwaiting ? "text-primary" : "text-muted-foreground"}`}>
                      {isAwaiting ? "等待你的选择" : "已回答"}
                    </span>
                  </div>
                  <div className="text-sm text-foreground leading-relaxed">{question}</div>
                  {isAwaiting ? (
                    <div className="space-y-2">
                      {options.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {options.map((opt, i) => (
                            <button
                              key={i}
                              type="button"
                              disabled={status === "generating"}
                              onClick={() => handleAnswerQuestion(msg.id, opt)}
                              className="px-2.5 py-1.5 rounded-md text-xs border border-primary/35 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary/50 disabled:opacity-40 transition-colors"
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-1.5">
                        <input
                          id={`ask-free-${msg.id}`}
                          placeholder={options.length ? "或输入其它回答…" : "输入你的回答…"}
                          disabled={status === "generating"}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              const el = e.target as HTMLInputElement;
                              if (el.value.trim()) handleAnswerQuestion(msg.id, el.value);
                            }
                          }}
                          className="flex-1 bg-secondary border border-border rounded px-2.5 py-1.5 text-xs text-foreground/90 outline-none focus:border-primary/50 disabled:opacity-50"
                        />
                        <button
                          type="button"
                          disabled={status === "generating"}
                          onClick={() => {
                            const el = document.getElementById(`ask-free-${msg.id}`) as HTMLInputElement | null;
                            if (el?.value.trim()) handleAnswerQuestion(msg.id, el.value);
                          }}
                          className="px-2.5 py-1.5 rounded bg-primary hover:bg-primary disabled:bg-secondary text-white text-xs transition-colors"
                        >
                          发送
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={`text-xs ${String(answer || "").includes("一键续写") ? "text-amber-400/90" : "text-emerald-500/90"}`}>
                      {String(answer || "").includes("一键续写") ? answer : `你的回答：${answer || msg.content}`}
                    </div>
                  )}
                </div>
              );
            }

            const isSubAgentCard = isSubAgentToolName(msg.metadata?.tool || "");
            return (
              <div
                key={msg.id}
                data-tool-call-id={msg.metadata?.toolCallId || undefined}
                className={`transition-shadow ${isDone && isReview && !hasFindings ? "py-1" : "bg-secondary/20 border border-border/50 rounded-lg p-2"}`}
              >
                <div className="flex items-center gap-2">
                  {isDone && isReview && !hasFindings ? (
                    <span className="text-xs text-green-600">✓ {toolNames[msg.metadata?.tool || ""] || msg.metadata?.tool}</span>
                  ) : (
                    <>
                      {isSubAgentCard ? (
                        <Bot className="w-3 h-3 text-primary" />
                      ) : (
                        <Wrench className="w-3 h-3 text-muted-foreground" />
                      )}
                      <span className={`text-xs ${isSubAgentCard ? "text-primary/90 font-medium" : "text-muted-foreground"}`}>
                        {toolNames[msg.metadata?.tool || ""] || msg.metadata?.tool}
                        {isSubAgentCard ? " · 子 Agent" : ""}
                      </span>
                      <span className={`w-2 h-2 rounded-full ml-auto ${isRunning ? "bg-primary animate-pulse" : "bg-green-500"}`} />
                      <span className="text-xs text-fog">
                        {isRunning
                          ? (() => {
                              const p = parseToolProgress(msg.content);
                              return p ? `${p.done}/${p.total}` : "执行中";
                            })()
                          : "完成"}
                      </span>
                    </>
                  )}
                </div>
                {/* Live tool progress (scan_character_mentions etc.) — from tool_chunk */}
                {isRunning && parseToolProgress(msg.content) && (
                  <div className="mt-1.5 px-1">
                    <ToolProgressBar progress={parseToolProgress(msg.content)!} />
                  </div>
                )}
                {/* Live + done chat transcript (streamed via tool_trail; tool_chunk merges into last assistant) */}
                {(() => {
                  const base = msg.metadata?.subMessages || [];
                  let live = base;
                  if (isRunning && msg.content && !parseToolProgress(msg.content)) {
                    const last = base[base.length - 1];
                    if (last?.role === "assistant") {
                      // Replace provisional / partial assistant with latest stream chunk
                      if (msg.content !== last.content) {
                        live = [...base.slice(0, -1), { role: "assistant", content: msg.content }];
                      }
                    } else {
                      live = [...base, { role: "assistant", content: msg.content }];
                    }
                  }
                  if (live.length === 0) {
                    if (isRunning && !parseToolProgress(msg.content)) {
                      return (
                        <div className="mt-1.5 text-xs text-fog flex items-center gap-1">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />等待对话…
                        </div>
                      );
                    }
                    if (isRunning) return null;
                    return null;
                  }
                  // Compact review pass with no findings: keep one-line header only when done
                  if (isDone && isReview && !hasFindings && !base.some(s => s.role === "tool_call")) {
                    return null;
                  }
                  return (
                    <details className="mt-1.5" open>
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-muted-foreground">
                        对话 ({live.length}){isRunning ? " · 进行中" : ""}
                      </summary>
                      <div className="mt-1.5">
                        <SubAgentTranscript messages={live} />
                      </div>
                    </details>
                  );
                })()}
                {/* Done — data tool result (e.g. get_findings) when no sub-agent trail */}
                {isDone && msg.content && !(isReview && !hasFindings) && (!msg.metadata?.subMessages || msg.metadata.subMessages.length === 0) && (
                  <details className="mt-1.5" open={msg.metadata?.tool === "get_findings"}>
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-muted-foreground">
                      {msg.metadata?.tool === "get_findings" ? "审查清单" : `输出 (${msg.content.length} 字符)`}
                    </summary>
                    <div className="mt-1.5 bg-background rounded p-2 border border-border/60">
                      {msg.metadata?.tool === "get_findings" ? (
                        <FindingsDisplay text={msg.content} />
                      ) : (
                        <pre
                          className="text-xs text-muted-foreground font-mono leading-relaxed whitespace-pre-wrap max-h-[min(40vh,320px)] overflow-y-auto overscroll-contain custom-scrollbar"
                          onWheel={nestedScrollWheel}
                        >
                          {msg.content.slice(0, 5000)}
                        </pre>
                      )}
                    </div>
                  </details>
                )}
              </div>
            );
          }

          // Chat bubble
          return (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs ${
                msg.role === "user"
                  ? "bg-primary/20 text-primary border border-primary/20"
                  : "bg-secondary/70 text-foreground/90 border border-border/50"
              }`}>
                {msg.content ? (
                  <Markdown>{msg.content}</Markdown>
                ) : (
                  <span className="text-muted-foreground italic">思考中...</span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Sub-agent run chips: no history reorder — jump to card in transcript */}
      <SubAgentRunChips chips={subAgentChips} onJump={jumpToToolCard} />

      {/* Status only — accept via ask_question + master accept_continuation */}
      {!isAnalysis && branchId && novelId && (fsStatus?.hasProseDraft || fsStatus?.hasRealization) && (
        <div className="px-3 py-1.5 border-t border-border/60 bg-background/80 shrink-0 flex items-center justify-between gap-2 text-[10px] text-fog">
          <span>
            {fsStatus?.hasProseDraft ? `草稿 ${fsStatus.proseLength} 字` : "无草稿"}
            {fsStatus?.hasRealization
              ? ` · 伏笔 ${fsStatus.pass ? "pass" : "未全落实"}`
              : ""}
            {` · active=${fsStatus?.activeCount ?? "—"}`}
            {" · 接受请在审查后的选项里选择"}
          </span>
          <button type="button" onClick={() => refreshFsStatus()} className="hover:text-muted-foreground shrink-0">
            刷新
          </button>
        </div>
      )}

      {/* Input + one-click (title is only on layout shell) */}
      <div className="p-3 border-t border-border/60 shrink-0 space-y-2">
        {messages.length > 0 && status !== "generating" && (
          <div className="flex items-center gap-2">
            {isAnalysis ? (
              <button
                type="button"
                onClick={() => handleOneClickAnalyze()}
                disabled={!novelId}
                title="章法→角色→故事/时间线/文风/点子"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors"
              >
                <Zap className="w-3 h-3" />
                一键分析
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleOneClickContinue()}
                disabled={!branchId || !novelId}
                title="大纲→正文→审查→接受；所有审核卡点自动通过"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border border-amber-500/40 bg-amber-500/10 text-amber-200/90 hover:bg-amber-500/20 disabled:opacity-40 transition-colors"
              >
                <Zap className="w-3 h-3" />
                一键续写
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2 items-center">
          {status === "generating" && (
            <span className="text-xs text-primary flex items-center gap-1 shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" />
              工作中
            </span>
          )}
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSend()}
            placeholder={
              messages.some(m => m.metadata?.status === "awaiting_user")
                ? "也可在上方问题卡片里选择或输入…"
                : isAnalysis
                  ? "例如：只重跑角色 / 强制重分析…"
                  : "告诉主编你想做什么..."
            }
            disabled={status === "generating"}
            className="flex-1 bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground/90 outline-none focus:border-primary/50 disabled:opacity-50"
          />
          <button onClick={() => handleSend()}
            disabled={status === "generating" || !input.trim()}
            className="px-3 py-1.5 bg-primary hover:bg-primary disabled:bg-secondary disabled:text-fog text-white rounded text-xs transition-colors">
            <Send className="w-3 h-3" />
          </button>
          {status === "generating" && (
            <button onClick={handleStop}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded text-xs transition-colors">
              停止
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
