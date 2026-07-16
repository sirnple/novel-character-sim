"use client";
import { useState, useEffect, useRef } from "react";
import { useNovel } from "@/lib/novel-context";
import { GitBranch, BookOpen, Sparkles, Trash2 } from "lucide-react";
import ScrollEdgeButtons from "@/components/scroll-edge-buttons";
import {
  TextFindBar,
  renderHighlightedText,
  useFindShortcut,
  useScrollToMatch,
  useTextFindSegments,
} from "@/components/text-find";

interface BranchInfo { id: string; name: string; text: string; parent_offset: number; updated_at: string; }

export default function WritePage() {
  const {
    novelId, novelTitle, novelText, setNovel, generatedProse, setActiveBranchId,
  } = useNovel();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [activeBranchId, setLocalBranchId] = useState<string | null>(null);
  const [freeMode, setFreeMode] = useState(false);
  const readerRef = useRef<HTMLDivElement>(null);
  const [newBranchName, setNewBranchName] = useState("");
  // Click-to-fork state
  const [forkPoint, setForkPoint] = useState<{ offset: number; label: string; context: string } | null>(null);
  const [showForkDialog, setShowForkDialog] = useState(false);
  /** Mobile: branch list drawer (desktop uses permanent rail) */
  const [branchDrawerOpen, setBranchDrawerOpen] = useState(false);

  const activeBranch = branches.find(b => b.id === activeBranchId);
  const hasSelection = freeMode || activeBranchId === "main" || !!activeBranch;
  // Prefer branch row for main when present (accepted 续写 lives on branches.main)
  const mainBranchRow = branches.find((b) => b.id === "main");
  const mainDisplayText =
    (mainBranchRow?.text && mainBranchRow.text.length >= (novelText || "").length
      ? mainBranchRow.text
      : novelText) || "";

  const currentText =
    freeMode || activeBranchId === "main"
      ? mainDisplayText
      : activeBranch
        ? (activeBranch.text || "")
        : "";

  const bodyText = freeMode ? mainDisplayText : (currentText || "");
  // Draft only: never treat intermediate tool streams as body (agent-panel loads save_prose)
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

  useEffect(() => {
    fetch(`/api/branches?novelId=${novelId}`).then(r => r.json()).then(d => {
      if (d.branches) setBranches(d.branches);
    }).catch(() => {});
  }, [novelId]);

  // Accept 续写后刷新本分支正文（避免列表/阅读区仍是旧 text）
  useEffect(() => {
    const onBranchUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as {
        novelId?: string;
        branchId?: string;
        text?: string;
      };
      if (!detail || detail.novelId !== novelId || !detail.branchId) return;
      setBranches((prev) =>
        prev.map((b) =>
          b.id === detail.branchId ? { ...b, text: detail.text || "" } : b,
        ),
      );
      // 若本地没有该分支行（仅 main 用 novelText），主线已由 agent-panel setNovelText
    };
    window.addEventListener("ncs:branch-updated", onBranchUpdated);
    return () => window.removeEventListener("ncs:branch-updated", onBranchUpdated);
  }, [novelId]);

  // Sync writing target to context only after explicit selection (no silent default to main)
  useEffect(() => {
    if (activeBranchId && activeBranch) {
      setNovel({
        sessionNovelText: activeBranch.text,
        sessionContinueOffset: activeBranch.text.length,
        sessionContinueLabel: `分支: ${activeBranch.name}`,
      });
      setActiveBranchId(activeBranchId);
    } else if (activeBranchId === "main" && !freeMode) {
      setNovel({
        sessionNovelText: novelText,
        sessionContinueOffset: novelText.length,
        sessionContinueLabel: "主线",
      });
      setActiveBranchId("main");
    } else if (freeMode) {
      setNovel({
        sessionNovelText: novelText,
        sessionContinueOffset: undefined,
        sessionContinueLabel: "自由创作",
      });
      // Agent tools still bind to main line text; id marks "target chosen"
      setActiveBranchId("main");
    } else if (queryOffset) {
      setLocalBranchId("main");
      setFreeMode(false);
      setNovel({
        sessionNovelText: novelText,
        sessionContinueOffset: parseInt(queryOffset),
        sessionContinueLabel: queryLabel || "续写点",
      });
      setActiveBranchId("main");
    } else {
      // No branch chosen yet — clear so layout hides agent panel
      setNovel({
        sessionNovelText: undefined,
        sessionContinueOffset: undefined,
        sessionContinueLabel: undefined,
      });
      setActiveBranchId(undefined);
    }
  }, [activeBranchId, activeBranch?.text, freeMode, novelText, queryOffset, queryLabel]);

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

  const createBranch = async () => {
    if (!newBranchName.trim()) return;
    // Source text of the line we're forking from (not "" when a branch is already selected)
    const sourceText =
      freeMode || !activeBranchId || activeBranchId === "main"
        ? novelText || ""
        : activeBranch?.text || novelText || "";
    const offset = Math.min(
      Math.max(0, forkPoint?.offset ?? sourceText.length),
      sourceText.length,
    );
    // Branch body = text up to fork point (full source if forking at end)
    const baseText = sourceText.slice(0, offset);
    const parentBranchId =
      freeMode || !activeBranchId || activeBranchId === "main" ? "main" : activeBranchId;
    const res = await fetch("/api/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        novelId,
        name: newBranchName,
        parentOffset: offset,
        content: baseText,
        parentBranchId,
      }),
    });
    const data = await res.json();
    if (data.branch) {
      setBranches(prev => [data.branch, ...prev]);
      setLocalBranchId(data.branch.id);
      setShowForkDialog(false);
      setNewBranchName("");
      setForkPoint(null);
    }
  };

  // Click handler for fork point selection
  const handleEditorClick = (e: React.MouseEvent) => {
    if (!currentText || freeMode) return;
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return;
    const el = readerRef.current; if (!el) return;
    let offset = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node === range.startContainer) { offset += range.startOffset; break; }
      offset += node.textContent?.length || 0;
    }
    // Cap to body text — ignore generated prose / chrome labels for fork offset
    const capped = Math.min(offset, currentText.length);
    const contextStart = Math.max(0, capped - 100);
    const contextEnd = Math.min(currentText.length, capped + 100);
    setForkPoint({
      offset: capped,
      label: `偏移 ${capped} 字`,
      context: currentText.slice(contextStart, contextEnd),
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

  const bodyHighlighted = renderHighlightedText({
    text: bodyText,
    matches: find.segmentMatches[0] || [],
    queryLen: find.queryLen,
    currentIndex: find.currentIndex,
    matchIndexBase: find.matchIndexBase(0),
    continueOffset: forkPoint && !freeMode ? forkPoint.offset : null,
    continueNode: forkNode,
  });

  const proseHighlighted = proseText
    ? renderHighlightedText({
        text: proseText,
        matches: find.segmentMatches[1] || [],
        queryLen: find.queryLen,
        currentIndex: find.currentIndex,
        matchIndexBase: find.matchIndexBase(1),
      })
    : null;

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
            <span className="text-xs text-fog">{novelText.length.toLocaleString()}字</span>
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
                {(b.text || "").length.toLocaleString()}字
              </span>
            </div>
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
                {(currentText || novelText).length.toLocaleString()} 字
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
        ) : freeMode ? (
          <div ref={readerRef} onClick={handleEditorClick} className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
            <div className="reader-frame py-4 sm:py-6">
              <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-8 sm:py-10 lg:py-12 min-h-[50vh]">
                <div className="prose-novel text-paper-foreground whitespace-pre-wrap">
                  {bodyHighlighted}
                  {proseHighlighted && (
                    <span className="text-primary/80">{proseHighlighted}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div ref={readerRef} onClick={handleEditorClick} className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
            <div className="reader-frame py-4 sm:py-6">
              {bodyText ? (
                <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-8 sm:py-10 lg:py-12 min-h-[50vh]">
                  <div className="prose-novel text-paper-foreground whitespace-pre-wrap">
                    {bodyHighlighted}
                    {proseHighlighted && (
                      <span className="text-primary/80">{proseHighlighted}</span>
                    )}
                  </div>
                </div>
              ) : proseHighlighted ? (
                <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-8 sm:py-10 lg:py-12 min-h-[50vh]">
                  <div className="prose-novel text-primary/90 whitespace-pre-wrap">
                    {proseHighlighted}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-fog text-sm">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  这个分支还没有内容。在助手面板里说&ldquo;从这里续写&rdquo;开始创作。
                </div>
              )}
              {forkPoint && (
                <div className="mt-3 flex items-center gap-2 text-xs text-primary">
                  <span>{forkPoint.label}</span>
                  <button
                    type="button"
                    onClick={() => { setForkPoint(null); setShowForkDialog(false); }}
                    className="text-fog hover:text-muted-foreground"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {hasSelection && <ScrollEdgeButtons scrollRef={readerRef} />}
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
