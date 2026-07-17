"use client";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNovel } from "@/lib/novel-context";
import { GitBranch, BookOpen, Sparkles, Trash2, Download } from "lucide-react";
import ScrollEdgeButtons from "@/components/scroll-edge-buttons";
import {
  TextFindBar,
  renderHighlightedText,
  useFindShortcut,
  useScrollToMatch,
  useTextFindSegments,
} from "@/components/text-find";
import { downloadBranchAsTxt } from "@/lib/download-branch-txt";
import {
  BODY_WINDOW_CHARS,
  expandEarlier,
  loadFullWindow,
  takeTailWindow,
  type TextWindow,
} from "@/lib/text-window";
import VirtualNovelBody, {
  absoluteOffsetFromClick,
  type VirtualChunk,
} from "@/components/virtual-novel-body";

/** Branch list metadata (no full text). */
interface BranchInfo {
  id: string;
  name: string;
  parent_offset: number;
  updated_at: string;
  char_count?: number;
}

export default function WritePage() {
  const {
    novelId, novelTitle, novelLength, setNovel, generatedProse, setActiveBranchId, setNovelText,
  } = useNovel();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [activeBranchId, setLocalBranchId] = useState<string | null>(null);
  const [freeMode, setFreeMode] = useState(false);
  const readerRef = useRef<HTMLDivElement>(null);
  const [newBranchName, setNewBranchName] = useState("");
  // Click-to-fork state — offsets are absolute in full branch body
  const [forkPoint, setForkPoint] = useState<{ offset: number; label: string; context: string } | null>(null);
  const [showForkDialog, setShowForkDialog] = useState(false);
  /** Mobile: branch list drawer (desktop uses permanent rail) */
  const [branchDrawerOpen, setBranchDrawerOpen] = useState(false);

  /** Full body of the selected branch (only one loaded at a time). */
  const [fullBody, setFullBody] = useState("");
  const [bodyLoading, setBodyLoading] = useState(false);
  const [win, setWin] = useState<TextWindow>(() => takeTailWindow(""));

  const activeBranch = branches.find(b => b.id === activeBranchId);
  const hasSelection = freeMode || activeBranchId === "main" || !!activeBranch;

  // Display = windowed body (tail by default for long novels)
  const bodyText = win.text;
  const proseText = generatedProse || "";
  const find = useTextFindSegments([bodyText, proseText]);
  useFindShortcut(find.searchInputRef, hasSelection);
  useScrollToMatch(readerRef, find.currentIndex, find.matchCount, [find.debouncedQuery, bodyText, proseText]);

  const [queryOffset, setQueryOffset] = useState<string | null>(null);
  const [queryLabel, setQueryLabel] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQueryOffset(params.get("offset"));
    setQueryLabel(params.get("label"));
  }, []);

  // Metadata list only
  useEffect(() => {
    if (!novelId) return;
    fetch(`/api/branches?novelId=${encodeURIComponent(novelId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.branches) setBranches(d.branches);
      })
      .catch(() => {});
  }, [novelId]);

  const applyBody = useCallback((text: string, preferFull = false) => {
    setFullBody(text);
    setWin(preferFull || text.length <= BODY_WINDOW_CHARS ? loadFullWindow(text) : takeTailWindow(text));
  }, []);

  const loadBranchBody = useCallback(
    async (branchId: string) => {
      if (!novelId || !branchId) return;
      setBodyLoading(true);
      try {
        const res = await fetch(
          `/api/branches?novelId=${encodeURIComponent(novelId)}&branchId=${encodeURIComponent(branchId)}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "load failed");
        const text = String(data.branch?.text || "");
        applyBody(text);
        setBranches((prev) =>
          prev.map((b) =>
            b.id === branchId
              ? { ...b, char_count: text.length, name: data.branch?.name || b.name }
              : b,
          ),
        );
        if (branchId === "main") {
          setNovelText(text);
          setNovel({ novelLength: text.length });
        }
      } catch {
        applyBody("");
      } finally {
        setBodyLoading(false);
      }
    },
    [novelId, applyBody, setNovel, setNovelText],
  );

  // Load body when selection changes
  useEffect(() => {
    if (freeMode) {
      loadBranchBody("main");
      return;
    }
    if (activeBranchId) {
      loadBranchBody(activeBranchId);
    } else {
      applyBody("");
    }
  }, [activeBranchId, freeMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Accept 续写：refetch body (do not trust multi-MB event payloads)
  useEffect(() => {
    const onBranchUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as {
        novelId?: string;
        branchId?: string;
        text?: string;
        totalLength?: number;
      };
      if (!detail || detail.novelId !== novelId || !detail.branchId) return;
      const bid = detail.branchId;
      if (typeof detail.totalLength === "number") {
        setBranches((prev) =>
          prev.map((b) => (b.id === bid ? { ...b, char_count: detail.totalLength! } : b)),
        );
      }
      // Prefer full text if small payload sent; else refetch
      if (detail.text != null && detail.text.length > 0 && detail.text.length <= BODY_WINDOW_CHARS * 2) {
        if (activeBranchId === bid || (freeMode && bid === "main")) {
          applyBody(detail.text);
        }
        if (bid === "main") setNovelText(detail.text);
      } else if (activeBranchId === bid || (freeMode && bid === "main") || bid === activeBranchId) {
        loadBranchBody(bid);
      } else {
        // inactive branch: just refresh meta length via list
        fetch(`/api/branches?novelId=${encodeURIComponent(novelId)}`)
          .then((r) => r.json())
          .then((d) => {
            if (d.branches) setBranches(d.branches);
          })
          .catch(() => {});
      }
    };
    window.addEventListener("ncs:branch-updated", onBranchUpdated);
    return () => window.removeEventListener("ncs:branch-updated", onBranchUpdated);
  }, [novelId, activeBranchId, freeMode, applyBody, loadBranchBody, setNovelText]);

  // Sync writing target to context — ids/offset only (no full sessionNovelText)
  useEffect(() => {
    const total = fullBody.length || win.totalLength;
    if (activeBranchId && activeBranch && !freeMode) {
      setNovel({
        sessionContinueOffset: total,
        sessionContinueLabel: `分支: ${activeBranch.name}`,
      });
      setActiveBranchId(activeBranchId);
    } else if (activeBranchId === "main" && !freeMode) {
      setNovel({
        sessionContinueOffset: total || novelLength,
        sessionContinueLabel: "主线",
      });
      setActiveBranchId("main");
    } else if (freeMode) {
      setNovel({
        sessionContinueOffset: undefined,
        sessionContinueLabel: "自由创作",
      });
      setActiveBranchId("main");
    } else if (queryOffset) {
      setLocalBranchId("main");
      setFreeMode(false);
      setNovel({
        sessionContinueOffset: parseInt(queryOffset, 10),
        sessionContinueLabel: queryLabel || "续写点",
      });
      setActiveBranchId("main");
    } else {
      setNovel({
        sessionContinueOffset: undefined,
        sessionContinueLabel: undefined,
      });
      setActiveBranchId(undefined);
    }
  }, [activeBranchId, activeBranch?.name, freeMode, fullBody.length, win.totalLength, novelLength, queryOffset, queryLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteBranchById = async (branchId: string, name: string) => {
    if (branchId === "main") return;
    if (!confirm(`确定删除分支「${name}」？此操作不可恢复。`)) return;
    const res = await fetch(
      `/api/branches?novelId=${encodeURIComponent(novelId)}&branchId=${encodeURIComponent(branchId)}`,
      { method: "DELETE" },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "删除失败");
      return;
    }
    setBranches((prev) => prev.filter((b) => b.id !== branchId));
    if (activeBranchId === branchId) {
      setLocalBranchId(null);
      setFreeMode(false);
      setActiveBranchId(undefined);
    }
  };

  const handleDownloadBranch = async (branchId: string, name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!novelId || !branchId) return;
    const err = await downloadBranchAsTxt(
      novelId,
      branchId,
      branchId === "main" ? `${novelTitle || "主线"}_主线` : name,
    );
    if (err) alert(err);
  };

  const createBranch = async () => {
    if (!newBranchName.trim()) return;
    // CoW fork: only parentOffset + parentBranchId; server stores empty suffix
    const sourceText = fullBody || "";
    const offset = Math.min(
      Math.max(0, forkPoint?.offset ?? sourceText.length),
      sourceText.length,
    );
    const parentBranchId =
      freeMode || !activeBranchId || activeBranchId === "main" ? "main" : activeBranchId;
    const res = await fetch("/api/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        novelId,
        name: newBranchName,
        parentOffset: offset,
        parentBranchId,
      }),
    });
    const data = await res.json();
    if (data.branch) {
      const b = data.branch;
      const meta: BranchInfo = {
        id: b.id,
        name: b.name || newBranchName,
        parent_offset: b.parent_offset ?? offset,
        updated_at: b.updated_at || new Date().toISOString(),
        char_count: typeof b.char_count === "number" ? b.char_count : offset,
      };
      setBranches((prev) => [meta, ...prev.filter((x) => x.id !== meta.id)]);
      setLocalBranchId(meta.id);
      // Resolved full text from API (parent prefix + empty suffix)
      applyBody(String(b.text || sourceText.slice(0, offset)));
      setShowForkDialog(false);
      setNewBranchName("");
      setForkPoint(null);
    }
  };

  // Click handler for fork — virtual chunks report absolute offset within bodyText window
  const handleEditorClick = (e: React.MouseEvent) => {
    if (!bodyText || freeMode) return;
    const el = readerRef.current;
    if (!el) return;
    const localInWindow = absoluteOffsetFromClick(
      el,
      e.clientX,
      e.clientY,
      bodyText.length,
    );
    if (localInWindow == null) return;
    const abs = win.baseOffset + localInWindow;
    const ctxStart = Math.max(0, abs - 100);
    const ctxEnd = Math.min(fullBody.length, abs + 100);
    setForkPoint({
      offset: abs,
      label: `偏移 ${abs.toLocaleString()} 字`,
      context: fullBody.slice(ctxStart, ctxEnd),
    });
  };

  const selectMain = () => {
    setLocalBranchId("main");
    setFreeMode(false);
    setBranchDrawerOpen(false);
  };
  const selectBranch = (id: string) => {
    setLocalBranchId(id);
    setFreeMode(false);
    setBranchDrawerOpen(false);
  };
  const selectFree = () => {
    setFreeMode(true);
    setLocalBranchId(null);
    setBranchDrawerOpen(false);
  };

  const forkNode =
    forkPoint && !freeMode ? (
      <span key="fork" className="inline-flex items-center gap-1.5 mx-1 align-middle">
        <span className="inline-block w-1.5 h-5 bg-primary animate-pulse rounded-sm" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowForkDialog(true);
            setNewBranchName("");
          }}
          className="text-xs font-medium bg-primary hover:brightness-110 text-primary-foreground px-2.5 py-1 rounded-md"
        >
          分叉
        </button>
      </span>
    ) : null;

  const localMatches = useCallback(
    (global: number[], base: number, len: number) => {
      const out: number[] = [];
      for (const m of global) {
        if (m >= base && m < base + len) out.push(m - base);
      }
      return out;
    },
    [],
  );

  const renderBodyChunk = useCallback(
    (chunk: VirtualChunk) => {
      const matches = localMatches(
        find.segmentMatches[0] || [],
        chunk.baseOffset,
        chunk.text.length,
      );
      let cont: number | null = null;
      let node: React.ReactNode = null;
      if (forkPoint && !freeMode) {
        const absInWindow = forkPoint.offset - win.baseOffset;
        if (
          absInWindow >= chunk.baseOffset &&
          absInWindow <= chunk.baseOffset + chunk.text.length
        ) {
          cont = absInWindow - chunk.baseOffset;
          node = forkNode;
        }
      }
      return (
        <div className="reader-frame py-2 sm:py-3">
          <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-4 sm:py-6">
            <div className="prose-novel text-paper-foreground whitespace-pre-wrap">
              {renderHighlightedText({
                text: chunk.text,
                matches,
                queryLen: find.queryLen,
                currentIndex: find.currentIndex,
                matchIndexBase: find.matchIndexBase(0),
                continueOffset: cont,
                continueNode: node,
              })}
            </div>
          </div>
        </div>
      );
    },
    [
      find.segmentMatches,
      find.queryLen,
      find.currentIndex,
      find.matchIndexBase,
      forkPoint,
      freeMode,
      win.baseOffset,
      forkNode,
      localMatches,
    ],
  );

  const proseHighlighted = useMemo(
    () =>
      proseText
        ? renderHighlightedText({
            text: proseText,
            matches: find.segmentMatches[1] || [],
            queryLen: find.queryLen,
            currentIndex: find.currentIndex,
            matchIndexBase: find.matchIndexBase(1),
          })
        : null,
    [proseText, find.segmentMatches, find.queryLen, find.currentIndex, find.matchIndexBase],
  );

  const charLabel = (b: BranchInfo) =>
    (typeof b.char_count === "number" ? b.char_count : 0).toLocaleString();

  const branchList = (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
      {branches.length === 0 && (
        <button
          type="button"
          onClick={selectMain}
          className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
            activeBranchId === "main" && !freeMode
              ? "bg-primary/10 border-l-2 border-primary text-foreground"
              : "text-muted-foreground hover:bg-panel-elevated hover:text-foreground"
          }`}
        >
          <div className="flex items-center justify-between">
            <span>主线</span>
            <span className="text-xs text-fog">{(novelLength || 0).toLocaleString()}字</span>
          </div>
        </button>
      )}
      {branches.map(b => (
        <div
          key={b.id}
          className={`group flex items-stretch rounded-lg transition-colors ${
            activeBranchId === b.id
              ? "bg-primary/10 border-l-2 border-primary"
              : "border-l-2 border-transparent hover:bg-panel-elevated"
          }`}
        >
          <button
            type="button"
            onClick={() => selectBranch(b.id)}
            className={`flex-1 min-w-0 text-left px-3 py-2.5 text-sm ${
              activeBranchId === b.id
                ? "text-foreground"
                : "text-muted-foreground group-hover:text-foreground"
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="truncate">{b.name || b.id}</span>
              <span className="text-xs text-fog shrink-0">
                {charLabel(b)}字
              </span>
            </div>
          </button>
          <button
            type="button"
            title="下载为 TXT"
            aria-label={`下载分支 ${b.name || b.id}`}
            onClick={(e) => handleDownloadBranch(b.id, b.name || b.id, e)}
            className="px-1.5 text-fog hover:text-primary shrink-0 opacity-70 hover:opacity-100"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          {b.id !== "main" && (
            <button
              type="button"
              title="删除分支"
              aria-label={`删除分支 ${b.name}`}
              onClick={(e) => {
                e.stopPropagation();
                deleteBranchById(b.id, b.name || b.id);
              }}
              className="px-2 text-fog hover:text-red-400 shrink-0 opacity-70 hover:opacity-100"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={selectFree}
        className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
          freeMode
            ? "bg-blue-500/10 border-l-2 border-blue-500 text-blue-400"
            : "text-muted-foreground hover:bg-panel-elevated hover:text-muted-foreground"
        }`}
      >
        <div className="flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> 自由创作</div>
      </button>
    </div>
  );

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      {/* Desktop: branch rail */}
      <aside className="hidden lg:flex w-[200px] shrink-0 border-r border-border/80 bg-card flex-col">
        <div className="p-3 border-b border-border/60">
          <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
            <GitBranch className="w-4 h-4" /> 分支
          </h3>
        </div>
        {branchList}
      </aside>

      {/* Mobile branch drawer */}
      {branchDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-30 flex safe-drawer-pad">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="关闭分支列表"
            onClick={() => setBranchDrawerOpen(false)}
          />
          <aside className="relative z-10 w-[min(100vw-3rem,220px)] h-full bg-card border-r border-border/80 flex flex-col shadow-2xl">
            <div className="p-3 border-b border-border/60 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                <GitBranch className="w-4 h-4" /> 分支
              </h3>
              <button
                type="button"
                onClick={() => setBranchDrawerOpen(false)}
                className="text-muted-foreground text-sm px-2 py-1 rounded-lg hover:bg-panel-elevated"
              >
                关闭
              </button>
            </div>
            {branchList}
          </aside>
        </div>
      )}

      {/* Center: Editor */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b border-border/60 bg-card shrink-0">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <button
              type="button"
              onClick={() => setBranchDrawerOpen(true)}
              className="lg:hidden p-1.5 -ml-1 rounded-lg text-primary hover:bg-primary/10 shrink-0"
              title="选择分支"
              aria-label="打开分支列表"
            >
              <GitBranch className="w-4 h-4" />
            </button>
            <BookOpen className="w-4 h-4 text-primary shrink-0 hidden sm:block" />
            <span className="text-muted-foreground truncate">
              {freeMode ? "自由创作" : activeBranch ? activeBranch.name : activeBranchId === "main" ? "主线" : "未选择分支"}
            </span>
            {hasSelection && (
              <span className="text-fog shrink-0 hidden sm:inline text-xs">
                {(win.totalLength || novelLength || 0).toLocaleString()} 字
                {bodyLoading ? " · 加载中" : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 min-w-0 shrink">
            {hasSelection && (
              <TextFindBar
                compact
                query={find.query}
                onQueryChange={find.setQuery}
                matchCount={find.matchCount}
                currentIndex={find.currentIndex}
                counterLabel={find.counterLabel}
                onPrev={find.goPrev}
                onNext={find.goNext}
                onClear={find.clearSearch}
                inputRef={find.searchInputRef}
              />
            )}
            {hasSelection && !freeMode && activeBranchId && (
              <button
                type="button"
                title="下载当前分支为 TXT"
                onClick={() =>
                  handleDownloadBranch(
                    activeBranchId,
                    activeBranchId === "main"
                      ? `${novelTitle || "主线"}_主线`
                      : (activeBranch?.name || activeBranchId),
                  )
                }
                className="text-sm text-muted-foreground hover:text-primary shrink-0 px-1.5 py-1 rounded-lg hover:bg-panel-elevated inline-flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">下载</span>
              </button>
            )}
            <a href={`/novel/${novelId}/read`} className="text-sm text-muted-foreground hover:text-foreground shrink-0 px-1">
              阅读
            </a>
          </div>
        </div>

        {!hasSelection ? (
          <div className="flex-1 flex items-center justify-center min-h-0">
            <div className="text-center px-6">
              <GitBranch className="w-10 h-10 mx-auto mb-3 text-fog" />
              <p className="text-sm text-muted-foreground mb-1">请先选择写作分支</p>
              <p className="text-sm text-fog leading-relaxed mb-4">
                点选「主线」、某个分支或「自由创作」后，才会打开助手面板。
              </p>
              <button
                type="button"
                onClick={() => setBranchDrawerOpen(true)}
                className="lg:hidden inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm bg-primary hover:brightness-110 text-primary-foreground"
              >
                <GitBranch className="w-4 h-4" /> 选择分支
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 relative">
            {win.hasEarlier && (
              <div className="shrink-0 px-3 sm:px-4 py-2 flex flex-wrap items-center gap-2 text-xs text-fog border-b border-border/40">
                <span>
                  全文 {win.totalLength.toLocaleString()} 字，当前窗口{" "}
                  {bodyText.length.toLocaleString()} 字（虚拟滚动）
                </span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setWin(expandEarlier(fullBody, win))}
                >
                  加载更早内容
                </button>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setWin(loadFullWindow(fullBody))}
                >
                  加载全文
                </button>
              </div>
            )}
            {bodyText || freeMode ? (
              <div className="flex-1 flex flex-col min-h-0">
                <VirtualNovelBody
                  text={bodyText}
                  scrollerRef={readerRef}
                  onBodyClick={handleEditorClick}
                  renderChunk={renderBodyChunk}
                />
                {proseHighlighted && (
                  <div className="reader-frame pb-8 shrink-0">
                    <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-4">
                      <div className="prose-novel text-primary/80 whitespace-pre-wrap">
                        {proseHighlighted}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : proseHighlighted ? (
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="reader-frame py-4">
                  <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-8">
                    <div className="prose-novel text-primary/90 whitespace-pre-wrap">
                      {proseHighlighted}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-fog text-sm">
                <div className="text-center py-12">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  这个分支还没有内容。在助手面板里说&ldquo;从这里续写&rdquo;开始创作。
                </div>
              </div>
            )}
            {forkPoint && !freeMode && (
              <div className="shrink-0 px-4 py-2 flex items-center gap-2 text-xs text-primary border-t border-border/40">
                <span>{forkPoint.label}</span>
                <button
                  type="button"
                  onClick={() => {
                    setForkPoint(null);
                    setShowForkDialog(false);
                  }}
                  className="text-fog hover:text-muted-foreground"
                >
                  取消
                </button>
              </div>
            )}
            <ScrollEdgeButtons scrollRef={readerRef} />
          </div>
        )}
      </div>

      {/* Fork dialog */}
      {showForkDialog && forkPoint && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowForkDialog(false)}
        >
          <div className="w-full max-w-sm bg-card border border-border rounded-xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground mb-4">新建分支</h3>
            <div className="space-y-3">
              <div>
                <div className="text-sm text-muted-foreground mb-0.5">分叉点</div>
                <div className="text-sm text-muted-foreground">{forkPoint.label}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">上下文</div>
                <div className="bg-secondary/50 rounded-lg p-2 text-xs text-muted-foreground max-h-16 overflow-y-auto whitespace-pre-wrap">
                  ...{forkPoint.context.slice(0, 80)}...
                  <span className="text-primary font-bold mx-0.5">|</span>
                  {forkPoint.context.slice(80)}...
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">分支名称</div>
                <input
                  value={newBranchName}
                  onChange={e => setNewBranchName(e.target.value)}
                  placeholder="IF线名称"
                  onKeyDown={e => e.key === "Enter" && createBranch()}
                  className="w-full px-3 py-2.5 bg-secondary border border-border rounded-lg text-sm text-foreground outline-none focus:border-primary/50"
                  autoFocus
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowForkDialog(false); setForkPoint(null); }}
                  className="flex-1 py-2.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={createBranch}
                  disabled={!newBranchName.trim()}
                  className="flex-1 py-2.5 bg-primary hover:brightness-110 disabled:bg-secondary disabled:text-fog text-primary-foreground text-sm rounded-lg"
                >
                  创建分支
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
