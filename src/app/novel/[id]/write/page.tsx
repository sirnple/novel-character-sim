"use client";
import { useState, useEffect, useRef } from "react";
import { useNovel } from "@/lib/novel-context";
import { GitBranch, Plus, BookOpen, Sparkles, Play } from "lucide-react";

interface BranchInfo { id: string; name: string; text: string; parent_offset: number; updated_at: string; }

export default function WritePage() {
  const { novelId, novelTitle, novelText, setNovelText } = useNovel();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [freeMode, setFreeMode] = useState(false);
  const [freeText, setFreeText] = useState("");
  const readerRef = useRef<HTMLDivElement>(null);
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  const activeBranch = branches.find(b => b.id === activeBranchId);
  const displayText = freeMode ? freeText : (activeBranchId ? activeBranch?.text || "" : novelText);

  useEffect(() => {
    fetch(`/api/branches?novelId=${novelId}`).then(r => r.json()).then(d => {
      if (d.branches) setBranches(d.branches);
    }).catch(() => {});
  }, [novelId]);

  const createBranch = async () => {
    if (!newBranchName.trim()) return;
    const res = await fetch("/api/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ novelId, name: newBranchName, parentOffset: 0, content: "" }),
    });
    const data = await res.json();
    if (data.branch) {
      setBranches(prev => [data.branch, ...prev]);
      setActiveBranchId(data.branch.id);
      setShowNewBranch(false);
      setNewBranchName("");
    }
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: Branch list */}
      <aside className="w-[220px] shrink-0 border-r border-neutral-800/60 bg-[#0c0c0c] flex flex-col">
        <div className="p-3 border-b border-neutral-800/40">
          <h3 className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-widest flex items-center gap-1.5">
            <GitBranch className="w-3 h-3" /> 分支
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {/* Main branch */}
          <button
            onClick={() => { setActiveBranchId(null); setFreeMode(false); }}
            className={`w-full text-left px-3 py-2 rounded text-xs font-mono transition-colors ${
              !activeBranchId && !freeMode ? "bg-orange-500/10 border-l-2 border-orange-500 text-neutral-200" : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300"
            }`}>
            <div className="flex items-center justify-between">
              <span>主线</span>
              <span className="text-[10px] text-neutral-600">{novelText.length.toLocaleString()}字</span>
            </div>
          </button>
          {/* IF branches */}
          {branches.map(b => (
            <button key={b.id}
              onClick={() => { setActiveBranchId(b.id); setFreeMode(false); }}
              className={`w-full text-left px-3 py-2 rounded text-xs font-mono transition-colors ${
                activeBranchId === b.id ? "bg-orange-500/10 border-l-2 border-orange-500 text-neutral-200" : "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300"
              }`}>
              <div className="flex items-center justify-between">
                <span className="truncate">{b.name}</span>
                <span className="text-[10px] text-neutral-600 shrink-0 ml-1">{(b.text || "").length.toLocaleString()}字</span>
              </div>
            </button>
          ))}
          {/* Free mode */}
          <button
            onClick={() => { setFreeMode(true); setActiveBranchId(null); }}
            className={`w-full text-left px-3 py-2 rounded text-xs font-mono transition-colors ${
              freeMode ? "bg-blue-500/10 border-l-2 border-blue-500 text-blue-400" : "text-neutral-500 hover:bg-neutral-800/50 hover:text-neutral-400"
            }`}>
            <div className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> 自由创作</div>
          </button>
        </div>
        <div className="p-2 border-t border-neutral-800/40">
          {showNewBranch ? (
            <div className="space-y-1">
              <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
                placeholder="分支名称" onKeyDown={e => e.key === "Enter" && createBranch()}
                className="w-full px-2 py-1 bg-[#111110] border border-neutral-800 rounded text-xs text-neutral-300 font-mono outline-none" autoFocus />
              <div className="flex gap-1">
                <button onClick={createBranch} className="flex-1 py-1 bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-mono rounded">创建</button>
                <button onClick={() => setShowNewBranch(false)} className="flex-1 py-1 text-neutral-500 hover:text-neutral-300 text-[10px] font-mono border border-neutral-700 rounded">取消</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowNewBranch(true)}
              className="w-full text-left px-3 py-2 rounded text-xs text-neutral-500 hover:bg-neutral-800/50 hover:text-neutral-400 font-mono transition-colors flex items-center gap-1">
              <Plus className="w-3 h-3" /> 新建分支
            </button>
          )}
        </div>
      </aside>

      {/* Center: Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800/40 bg-[#0e0e0e] shrink-0">
          <div className="flex items-center gap-2 text-xs font-mono">
            <BookOpen className="w-3.5 h-3.5 text-orange-500" />
            <span className="text-neutral-400">
              {freeMode ? "自由创作" : activeBranch ? activeBranch.name : "主线"}
            </span>
            <span className="text-neutral-600">
              {displayText.length.toLocaleString()} 字
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a href={`/novel/${novelId}/read`}
              className="text-[10px] text-neutral-500 hover:text-neutral-300 font-mono flex items-center gap-1">
              <BookOpen className="w-3 h-3" /> 阅读模式
            </a>
          </div>
        </div>

        {/* Editor body */}
        {freeMode ? (
          <textarea value={freeText} onChange={e => setFreeText(e.target.value)}
            className="flex-1 w-full bg-transparent border-0 outline-none resize-none p-6 text-base text-neutral-200 leading-relaxed font-serif custom-scrollbar placeholder-neutral-700"
            placeholder="自由创作模式——直接输入文字，或选中后告诉助手帮你续写..." />
        ) : (
          <div ref={readerRef} className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="max-w-[800px] mx-auto p-6">
              {displayText ? (
                <div className="text-base text-neutral-200 leading-relaxed whitespace-pre-wrap font-serif">
                  {displayText}
                </div>
              ) : (
                <div className="text-center py-12 text-neutral-600 text-sm font-mono">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  这个分支还没有内容。在助手面板里说"从这里续写"开始创作。
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
