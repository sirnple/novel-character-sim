"use client";
import { useState, useEffect, useRef } from "react";
import { useNovel } from "@/lib/novel-context";
import { GitBranch, Plus, BookOpen, Sparkles } from "lucide-react";
import ScrollEdgeButtons from "@/components/scroll-edge-buttons";

interface BranchInfo { id: string; name: string; text: string; parent_offset: number; updated_at: string; }

export default function WritePage() {
  const {
    novelId, novelTitle, novelText, setNovelText, setNovel, generatedProse, setActiveBranchId,
  } = useNovel();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [activeBranchId, setLocalBranchId] = useState<string | null>(null);
  const [freeMode, setFreeMode] = useState(false);
  const readerRef = useRef<HTMLDivElement>(null);
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchNameInput, setNewBranchNameInput] = useState("");
  // Click-to-fork state
  const [forkPoint, setForkPoint] = useState<{ offset: number; label: string; context: string } | null>(null);
  const [showForkDialog, setShowForkDialog] = useState(false);
  /** Mobile: branch list drawer (desktop uses permanent rail) */
  const [branchDrawerOpen, setBranchDrawerOpen] = useState(false);

  const activeBranch = branches.find(b => b.id === activeBranchId);
  const hasSelection = freeMode || activeBranchId === "main" || !!activeBranch;
  const currentText =
    freeMode || activeBranchId === "main"
      ? novelText
      : activeBranch
        ? (activeBranch.text || "")
        : "";

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

  const createBranch = async () => {
    if (!newBranchName.trim()) return;
    const offset = forkPoint?.offset || 0;
    const baseText = !activeBranchId ? novelText.slice(0, offset) : "";
    const res = await fetch("/api/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ novelId, name: newBranchName, parentOffset: offset, content: baseText }),
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
    const contextStart = Math.max(0, offset - 100);
    const contextEnd = Math.min(currentText.length, offset + 100);
    setForkPoint({
      offset,
      label: `偏移 ${offset} 字`,
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

  const branchList = (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
      {branches.length === 0 && (
        <button
          type="button"
          onClick={selectMain}
          className={`w-full text-left px-3 py-2.5 rounded text-xs transition-colors ${
            activeBranchId === "main" && !freeMode
              ? "bg-primary/10 border-l-2 border-primary text-foreground"
              : "text-muted-foreground hover:bg-panel-elevated hover:text-foreground/90"
          }`}
        >
          <div className="flex items-center justify-between">
            <span>主线</span>
            <span className="text-xs text-fog">{novelText.length.toLocaleString()}字</span>
          </div>
        </button>
      )}
      {branches.map(b => (
        <button
          key={b.id}
          type="button"
          onClick={() => selectBranch(b.id)}
          className={`w-full text-left px-3 py-2.5 rounded text-xs transition-colors ${
            activeBranchId === b.id
              ? "bg-primary/10 border-l-2 border-primary text-foreground"
              : "text-muted-foreground hover:bg-panel-elevated hover:text-foreground/90"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="truncate">{b.name}</span>
            <span className="text-xs text-fog shrink-0 ml-1">{(b.text || "").length.toLocaleString()}字</span>
          </div>
        </button>
      ))}
      <button
        type="button"
        onClick={selectFree}
        className={`w-full text-left px-3 py-2.5 rounded text-xs transition-colors ${
          freeMode
            ? "bg-blue-500/10 border-l-2 border-blue-500 text-blue-400"
            : "text-muted-foreground hover:bg-panel-elevated hover:text-muted-foreground"
        }`}
      >
        <div className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> 自由创作</div>
      </button>
    </div>
  );

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      {/* Desktop: branch rail */}
      <aside className="hidden lg:flex w-[200px] shrink-0 border-r border-border/80 bg-card flex-col">
        <div className="p-3 border-b border-border/60">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
            <GitBranch className="w-3 h-3" /> 分支
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
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <GitBranch className="w-3 h-3" /> 分支
              </h3>
              <button
                type="button"
                onClick={() => setBranchDrawerOpen(false)}
                className="text-muted-foreground text-xs px-2 py-1"
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
          <div className="flex items-center gap-2 text-xs min-w-0">
            <button
              type="button"
              onClick={() => setBranchDrawerOpen(true)}
              className="lg:hidden p-1.5 -ml-1 rounded text-primary hover:bg-primary/10 shrink-0"
              title="选择分支"
              aria-label="打开分支列表"
            >
              <GitBranch className="w-4 h-4" />
            </button>
            <BookOpen className="w-3.5 h-3.5 text-primary shrink-0 hidden sm:block" />
            <span className="text-muted-foreground truncate">
              {freeMode ? "自由创作" : activeBranch ? activeBranch.name : activeBranchId === "main" ? "主线" : "未选择分支"}
            </span>
            {hasSelection && (
              <span className="text-fog shrink-0 hidden sm:inline">
                {(currentText || novelText).length.toLocaleString()} 字
              </span>
            )}
          </div>
          <a href={`/novel/${novelId}/read`} className="text-xs text-muted-foreground hover:text-foreground/90 shrink-0">
            阅读
          </a>
        </div>

        {!hasSelection ? (
          <div className="flex-1 flex items-center justify-center min-h-0">
            <div className="text-center px-6">
              <GitBranch className="w-10 h-10 mx-auto mb-3 text-neutral-700" />
              <p className="text-sm text-muted-foreground mb-1">请先选择写作分支</p>
              <p className="text-xs text-fog leading-relaxed mb-4">
                点选「主线」、某个分支或「自由创作」后，才会打开助手面板。
              </p>
              <button
                type="button"
                onClick={() => setBranchDrawerOpen(true)}
                className="lg:hidden inline-flex items-center gap-1.5 px-4 py-2 rounded text-xs bg-primary hover:bg-primary text-white"
              >
                <GitBranch className="w-3.5 h-3.5" /> 选择分支
              </button>
            </div>
          </div>
        ) : freeMode ? (
          <div ref={readerRef} onClick={handleEditorClick} className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
            <div className="reader-frame py-4 sm:py-6">
              <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-8 sm:py-10 lg:py-12 min-h-[50vh]">
                <div className="prose-novel text-paper-foreground whitespace-pre-wrap">
                  {novelText}
                  {generatedProse && (
                    <span className="text-primary/80">{generatedProse}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div ref={readerRef} onClick={handleEditorClick} className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
            <div className="reader-frame py-4 sm:py-6">
              {currentText ? (
                <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-8 sm:py-10 lg:py-12 min-h-[50vh]">
                  <div className="prose-novel text-paper-foreground whitespace-pre-wrap">
                    {forkPoint ? (
                      <>
                        {currentText.slice(0, forkPoint.offset)}
                        <span className="inline-flex items-center gap-1 mx-1">
                          <span className="inline-block w-1.5 h-5 bg-primary animate-pulse rounded-sm" />
                          <button
                            type="button"
                            onClick={() => { setShowForkDialog(true); setNewBranchName(""); }}
                            className="text-xs font-medium bg-primary hover:brightness-110 text-primary-foreground px-2.5 py-1 rounded-md"
                          >
                            分叉
                          </button>
                        </span>
                        {currentText.slice(forkPoint.offset)}
                        {generatedProse && (
                          <span className="text-primary/80">{generatedProse}</span>
                        )}
                      </>
                    ) : (
                      <>
                        {currentText}
                        {generatedProse && (
                          <span className="text-primary/80">{generatedProse}</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : generatedProse ? (
                <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-8 sm:py-10 lg:py-12 min-h-[50vh]">
                  <div className="prose-novel text-primary/90 whitespace-pre-wrap">
                    {generatedProse}
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
                  <button onClick={() => { setForkPoint(null); setShowForkDialog(false); }} className="text-fog hover:text-muted-foreground">取消</button>
                </div>
              )}
            </div>
          </div>
        )}
        {hasSelection && <ScrollEdgeButtons scrollRef={readerRef} />}
      </div>

      {/* Fork dialog */}
      {showForkDialog && forkPoint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowForkDialog(false)}>
          <div className="w-full max-w-sm bg-card border border-border rounded-lg p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground/90 mb-4">新建分支</h3>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">分叉点</div>
                <div className="text-xs text-muted-foreground">{forkPoint.label}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">上下文</div>
                <div className="bg-secondary/50 rounded p-2 text-xs text-muted-foreground max-h-16 overflow-y-auto whitespace-pre-wrap">
                  ...{forkPoint.context.slice(0, 80)}...
                  <span className="text-primary font-bold mx-0.5">|</span>
                  {forkPoint.context.slice(80)}...
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">分支名称</div>
                <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
                  placeholder="IF线名称" onKeyDown={e => e.key === "Enter" && createBranch()}
                  className="w-full px-3 py-2 bg-secondary border border-border rounded text-sm text-foreground/90 outline-none focus:border-primary/50" autoFocus />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => { setShowForkDialog(false); setForkPoint(null); }}
                  className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground/90 border border-border rounded-lg">取消</button>
                <button onClick={createBranch} disabled={!newBranchName.trim()}
                  className="flex-1 py-2 bg-primary hover:bg-primary disabled:bg-secondary disabled:text-fog text-white text-sm rounded-lg">创建分支</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
