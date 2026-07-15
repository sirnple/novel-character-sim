"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Key, Save, RotateCcw, Terminal, Filter, Check, AlertCircle } from "lucide-react";

interface AgentRow {
  agent_id: string;
  name: string;
  description: string;
  category: string;
  system_prompt: string | null;
  user_prompt_template: string | null;
  is_modified: number;
  updated_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  master: "主编",
  extraction: "提取",
  simulation: "大纲",
  writing: "写作",
  review: "审查",
};

const CATEGORY_ICONS: Record<string, string> = {
  master: "🎯",
  extraction: "🔍",
  simulation: "📋",
  writing: "✍️",
  review: "✅",
};

function PasswordGate({ onUnlock }: { onUnlock: (token: string) => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (res.ok) {
        onUnlock(data.token);
      } else {
        setError(data.error || "验证失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#080808]/95 backdrop-blur-sm">
      <div className="w-full max-w-sm px-8 py-10 border border-neutral-800 rounded-lg bg-[#0e0e0e] shadow-2xl shadow-black/50">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-md bg-orange-600/20 border border-orange-600/40 flex items-center justify-center">
            <Terminal className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-200 font-mono tracking-wide">
              管理后台
            </h2>
            <p className="text-xs text-neutral-500">Agent 提示词管理</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-neutral-400 mb-1.5 font-mono">
              <Key className="w-3 h-3 inline mr-1.5 -mt-0.5" />
              请输入管理密码
            </label>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="w-full px-3 py-2 bg-[#1a1a1a] border border-neutral-700 rounded text-sm text-neutral-200 font-mono placeholder-neutral-600 focus:outline-none focus:border-orange-600 transition-colors"
              placeholder="······"
              autoFocus
            />
          </div>
          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || !pw}
            className="w-full py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white text-sm font-mono rounded transition-colors"
          >
            {loading ? "验证中..." : "进入后台"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLang, setSelectedLang] = useState<"zh" | "en">("zh");
  const [currentPrompt, setCurrentPrompt] = useState<AgentRow | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userTemplate, setUserTemplate] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Try restore session from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem("admin_token");
    if (stored) setToken(stored);
  }, []);

  // Load agent list
  const fetchList = useCallback(async () => {
    if (!token) return;
    const res = await fetch("/api/admin/prompts", {
      headers: { "x-admin-token": token },
    });
    if (res.status === 401) {
      sessionStorage.removeItem("admin_token");
      setToken(null);
      return;
    }
    const data = await res.json();
    setAgents(data);
  }, [token]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Load single agent prompt when selected
  useEffect(() => {
    if (!selectedId || !token) return;
    (async () => {
      const res = await fetch(
        `/api/admin/prompts?agent=${selectedId}&lang=${selectedLang}`,
        { headers: { "x-admin-token": token } }
      );
      if (res.ok) {
        const data = await res.json();
        setCurrentPrompt(data);
        setSystemPrompt(data.system_prompt || "");
        setUserTemplate(data.user_prompt_template || "");
      }
    })();
  }, [selectedId, selectedLang, token]);

  const handleSave = async () => {
    if (!selectedId || !token) return;
    setSaving(true);
    setSaved(false);
    await fetch("/api/admin/prompts", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token,
      },
      body: JSON.stringify({
        agentId: selectedId,
        language: selectedLang,
        systemPrompt: systemPrompt || null,
        userPromptTemplate: userTemplate || null,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    fetchList();
  };

  const handleReset = async () => {
    if (!selectedId || !token) return;
    if (!confirm("确定要重置为默认提示词吗？所有修改将丢失。")) return;
    await fetch("/api/admin/prompts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token,
      },
      body: JSON.stringify({
        agentId: selectedId,
        language: selectedLang,
      }),
    });
    setSystemPrompt("");
    setUserTemplate("");
    fetchList();
  };

  const handleUnlock = (t: string) => {
    sessionStorage.setItem("admin_token", t);
    setToken(t);
  };

  const selectedMeta = agents.find((a) => a.agent_id === selectedId);

  if (!token) {
    return <PasswordGate onUnlock={handleUnlock} />;
  }

  const grouped = agents.reduce(
    (acc, a) => {
      const cat = a.category || "extraction";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(a);
      return acc;
    },
    {} as Record<string, AgentRow[]>
  );

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0a] text-neutral-200 font-sans">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-neutral-800/60 bg-[#0e0e0e] shrink-0">
        <div className="flex items-center gap-4">
          <a
            href="/"
            className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            返回主站
          </a>
          <span className="w-px h-4 bg-neutral-800" />
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-orange-500" />
            <h1 className="text-sm font-bold tracking-wider text-neutral-300 font-[family-name:var(--font-geist-mono)]">
              AGENT PROMPT 管理
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-neutral-600 font-[family-name:var(--font-geist-mono)]">
          <span>{agents.length} agents</span>
          <span>|</span>
          <span>{agents.filter((a) => a.is_modified).length} modified</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[270px] shrink-0 border-r border-neutral-800/60 bg-[#0c0c0c] flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-800/40">
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 font-[family-name:var(--font-geist-mono)] uppercase tracking-widest">
              <Filter className="w-3 h-3" />
              Agents
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {Object.entries(grouped).map(([cat, list]) => (
              <div key={cat} className="mb-1">
                <div className="px-4 py-2 text-[10px] text-neutral-500 font-[family-name:var(--font-geist-mono)] uppercase tracking-widest">
                  {CATEGORY_ICONS[cat]}{" "}
                  {CATEGORY_LABELS[cat]}
                </div>
                {list.map((agent) => (
                  <button
                    key={agent.agent_id}
                    onClick={() => setSelectedId(agent.agent_id)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors border-l-2 ${
                      selectedId === agent.agent_id
                        ? "border-orange-500 bg-orange-500/5 text-neutral-200"
                        : "border-transparent hover:bg-neutral-800/30 text-neutral-400 hover:text-neutral-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate">{agent.name}</span>
                      {agent.is_modified ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" title="已修改" />
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {/* Editor */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0a]">
          {selectedMeta ? (
            <>
              {/* Editor header */}
              <div className="px-6 py-3 border-b border-neutral-800/40 bg-[#0c0c0c] flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-300 font-[family-name:var(--font-geist-mono)]">
                    {selectedMeta.name}
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {selectedMeta.description}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex rounded border border-neutral-700 overflow-hidden text-[10px] font-[family-name:var(--font-geist-mono)]">
                    {(["zh", "en"] as const).map((l) => (
                      <button
                        key={l}
                        onClick={() => setSelectedLang(l)}
                        className={`px-2.5 py-1 transition-colors ${
                          selectedLang === l
                            ? "bg-neutral-700 text-neutral-200"
                            : "bg-transparent text-neutral-500 hover:text-neutral-300"
                        }`}
                      >
                        {l === "zh" ? "中文" : "EN"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Editor body */}
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                {/* System Prompt */}
                <section>
                  <label className="block text-[10px] text-neutral-500 font-[family-name:var(--font-geist-mono)] uppercase tracking-widest mb-2">
                    System Prompt
                  </label>
                  <div className="relative">
                    <textarea
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      className="w-full min-h-[420px] px-4 py-3 bg-[#111110] border border-neutral-800 rounded font-[family-name:var(--font-geist-mono)] text-sm text-neutral-300 leading-relaxed resize-y focus:outline-none focus:border-orange-600/50 transition-colors placeholder-neutral-700"
                      placeholder="未修改 — 使用硬编码默认提示词"
                      spellCheck={false}
                    />
                  </div>
                  {currentPrompt?.is_modified ? (
                    <p className="text-[10px] text-orange-500/70 mt-1.5 font-[family-name:var(--font-geist-mono)] flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      已自定义 — 将覆盖默认提示词
                    </p>
                  ) : null}
                </section>

                {/* Variables reference */}
                <section className="border border-neutral-800/60 rounded bg-[#0c0c0c] p-4 mt-6">
                  <h3 className="text-[10px] text-neutral-500 font-[family-name:var(--font-geist-mono)] uppercase tracking-widest mb-2">
                    可用变量
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    <code className="px-2 py-0.5 bg-[#1a1a1a] border border-neutral-700/50 rounded text-xs text-orange-400/80 font-[family-name:var(--font-geist-mono)]">
                      {"{{" + "变量名" + "}}"}
                    </code>
                    <span className="text-xs text-neutral-600 self-center">
                      — 使用双花括号包裹变量名
                    </span>
                  </div>
                </section>
              </div>

              {/* Editor footer */}
              <div className="px-6 py-3 border-t border-neutral-800/40 bg-[#0c0c0c] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 text-[10px] text-neutral-600 font-[family-name:var(--font-geist-mono)]">
                  <span>
                    agent_id: <code className="text-neutral-500">{selectedMeta.agent_id}</code>
                  </span>
                  {selectedMeta.is_modified ? (
                    <span className="text-orange-500/60">
                      · modified {selectedMeta.updated_at}
                    </span>
                  ) : (
                    <span className="text-neutral-700">· default</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleReset}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-500 hover:text-red-400 border border-neutral-700 hover:border-red-500/30 rounded transition-colors font-[family-name:var(--font-geist-mono)]"
                  >
                    <RotateCcw className="w-3 h-3" />
                    重置默认
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className={`flex items-center gap-1.5 px-4 py-1.5 text-xs rounded transition-all font-[family-name:var(--font-geist-mono)] ${
                      saved
                        ? "bg-green-600/20 border border-green-600/30 text-green-400"
                        : "bg-orange-600 hover:bg-orange-500 text-white border border-orange-600"
                    }`}
                  >
                    {saved ? (
                      <>
                        <Check className="w-3 h-3" /> 已保存
                      </>
                    ) : saving ? (
                      "保存中..."
                    ) : (
                      <>
                        <Save className="w-3 h-3" /> 保存修改
                      </>
                    )}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-neutral-700">
              <div className="text-center">
                <Terminal className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm font-[family-name:var(--font-geist-mono)]">
                  选择一个 Agent 开始编辑
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
