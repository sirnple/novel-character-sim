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

  const activeBranch = branches.find(b => b.id === activeBranchId);
  const currentText = activeBranchId ? (activeBranch?.text || "") : novelText;
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

  useEffect(() => {
    if (activeBranchId && activeBranch) {
      setNovel({
        sessionNovelText: activeBranch.text,
        sessionContinueOffset: activeBranch.text.length,
        sessionContinueLabel: `分支: ${activeBranch.name}`,
      });
      setActiveBranchId(activeBranchId);
    } else if (freeMode) {
      setNovel({
        sessionNovelText: novelText,
        sessionContinueOffset: undefined,
        sessionContinueLabel: "自由创作",
      });
      setActiveBranchId(undefined);
    } else if (queryOffset) {
      setNovel({
        sessionNovelText: novelText,
        sessionContinueOffset: parseInt(queryOffset),
        sessionContinueLabel: queryLabel || "续写点",
      });
      setActiveBranchId("main");
    } else {
      setNovel({
        sessionNovelText: undefined,
        sessionContinueOffset: undefined,
        sessionContinueLabel: undefined,
      });
      setActiveBranchId("main");
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

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: Branches only (风格/点子在全局侧栏) */}
      <aside className="w-[200px] shrink-0 border-r border-neutral-800/60 bg-[#0c0c0c] flex flex-col">
        <div className="p-3 border-b border-neutral-800/40">
          <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest flex items-center gap-1.5">
            <GitBranch className="w-3 h-3" /> 分支
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {branches.length === 0 && (
            <button onClick={() => { setLocalBranchId("main"); setFreeMode(false); }}
              className={`w-full text-left px-3 py-2 rounded text-xs font-mono transition-colors ${
                activeBranchId === "main" && !freeMode ? "bg-orange-500/10 border-l-2 border-orange-500 text-neutral-200" : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300"
              }`}>
              <div className="flex items-center justify-between">
                <span>主线</span>
                <span className="text-[10px] text-neutral-600">{novelText.length.toLocaleString()}字</span>
              </div>
            </button>
          )}
          {branches.map(b => (
            <button key={b.id} onClick={() => { setLocalBranchId(b.id); setFreeMode(false); }}
              className={`w-full text-left px-3 py-2 rounded text-xs font-mono transition-colors ${
                activeBranchId === b.id ? "bg-orange-500/10 border-l-2 border-orange-500 text-neutral-200" : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300"
              }`}>
              <div className="flex items-center justify-between">
                <span className="truncate">{b.name}</span>
                <span className="text-[10px] text-neutral-600 shrink-0 ml-1">{(b.text || "").length.toLocaleString()}字</span>
              </div>
            </button>
          ))}
          <button onClick={() => { setFreeMode(true); setLocalBranchId(null); }}
            className={`w-full text-left px-3 py-2 rounded text-xs font-mono transition-colors ${
              freeMode ? "bg-blue-500/10 border-l-2 border-blue-500 text-blue-400" : "text-neutral-500 hover:bg-neutral-800/50 hover:text-neutral-400"
            }`}>
            <div className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> 自由创作</div>
          </button>
        </div>
      </aside>

      {/* Center: Editor */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800/40 bg-[#0e0e0e] shrink-0">
          <div className="flex items-center gap-2 text-xs font-mono">
            <BookOpen className="w-3.5 h-3.5 text-orange-500" />
            <span className="text-neutral-400">{freeMode ? "自由创作" : activeBranch ? activeBranch.name : "主线"}</span>
            <span className="text-neutral-600">{novelText.length.toLocaleString()} 字</span>
          </div>
          <a href={`/novel/${novelId}/read`} className="text-[10px] text-neutral-500 hover:text-neutral-300 font-mono">阅读模式</a>
        </div>

        {freeMode ? (
          <div ref={readerRef} onClick={handleEditorClick} className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
            <div className="max-w-[800px] mx-auto p-6">
              <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif">
                {novelText}
                {generatedProse && (
                  <span className="text-orange-300/80">{generatedProse}</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div ref={readerRef} onClick={handleEditorClick} className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
            <div className="max-w-[800px] mx-auto p-6">
              {currentText ? (
                <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif">
                  {forkPoint ? (
                    <>
                      {currentText.slice(0, forkPoint.offset)}
                      <span className="inline-flex items-center gap-1 mx-1">
                        <span className="inline-block w-2 h-4 bg-orange-500 animate-pulse rounded-sm" />
                        <button onClick={() => { setShowForkDialog(true); setNewBranchName(""); }}
                          className="text-[10px] bg-orange-600 hover:bg-orange-500 text-white px-1.5 py-0.5 rounded font-mono">分叉</button>
                      </span>
                      {currentText.slice(forkPoint.offset)}
                      {generatedProse && (
                        <span className="text-orange-300/80">{generatedProse}</span>
                      )}
                    </>
                  ) : (
                    <>
                      {currentText}
                      {generatedProse && (
                        <span className="text-orange-300/80">{generatedProse}</span>
                      )}
                    </>
                  )}
                </div>
              ) : generatedProse ? (
                <div className="text-base text-orange-300/80 leading-relaxed whitespace-pre-wrap font-serif">
                  {generatedProse}
                </div>
              ) : (
                <div className="text-center py-12 text-neutral-600 text-sm font-mono">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  这个分支还没有内容。在助手面板里说&ldquo;从这里续写&rdquo;开始创作。
                </div>
              )}
              {forkPoint && (
                <div className="mt-3 flex items-center gap-2 text-[10px] text-orange-500 font-mono">
                  <span>{forkPoint.label}</span>
                  <button onClick={() => { setForkPoint(null); setShowForkDialog(false); }} className="text-neutral-600 hover:text-neutral-400">取消</button>
                </div>
              )}
            </div>
          </div>
        )}
        <ScrollEdgeButtons scrollRef={readerRef} />
      </div>

      {/* Fork dialog */}
      {showForkDialog && forkPoint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowForkDialog(false)}>
          <div className="w-full max-w-sm bg-[#0e0e0e] border border-neutral-800 rounded-lg p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-neutral-300 font-mono mb-4">新建分支</h3>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-neutral-500 font-mono mb-0.5">分叉点</div>
                <div className="text-xs text-neutral-400 font-mono">{forkPoint.label}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500 font-mono mb-1">上下文</div>
                <div className="bg-neutral-800/30 rounded p-2 text-xs text-neutral-500 font-mono max-h-16 overflow-y-auto whitespace-pre-wrap">
                  ...{forkPoint.context.slice(0, 80)}...
                  <span className="text-orange-500 font-bold mx-0.5">|</span>
                  {forkPoint.context.slice(80)}...
                </div>
              </div>
              <div>
                <div className="text-xs text-neutral-500 font-mono mb-1">分支名称</div>
                <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
                  placeholder="IF线名称" onKeyDown={e => e.key === "Enter" && createBranch()}
                  className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono outline-none focus:border-orange-600/50" autoFocus />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => { setShowForkDialog(false); setForkPoint(null); }}
                  className="flex-1 py-2 text-sm text-neutral-500 hover:text-neutral-300 font-mono border border-neutral-700 rounded-lg">取消</button>
                <button onClick={createBranch} disabled={!newBranchName.trim()}
                  className="flex-1 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-sm font-mono rounded-lg">创建分支</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
