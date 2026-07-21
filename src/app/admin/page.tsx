"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowLeft,
  Save,
  RotateCcw,
  Terminal,
  Filter,
  Check,
  AlertCircle,
  BarChart3,
  RefreshCw,
  Loader2,
  Settings,
} from "lucide-react";
import { isClientDebugMode } from "@/lib/debug-mode";

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

type AdminTab = "prompts" | "tokens" | "settings";

interface RuntimeSettingsShape {
  mentionScanConcurrency: number;
  mentionScanBatchUnits: number;
  mentionScanBatchChars: number;
  privilegedMentionScanConcurrency: number;
  adminMentionScanBatchUnits: number;
}

interface TokenAggRow {
  key: string;
  label?: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCalls: number;
}

interface TokenRecentRow {
  id: string;
  userId: string;
  userLabel?: string;
  novelId: string;
  branchId: string;
  agentId: string;
  category: string;
  model: string;
  operation: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  createdAt: string;
}

interface TokenStatsData {
  summary: {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCalls: number;
  };
  byAgent: TokenAggRow[];
  byUser: TokenAggRow[];
  byBranch: TokenAggRow[];
  byDay: TokenAggRow[];
  recent?: TokenRecentRow[];
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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function shortId(id: string, n = 10): string {
  if (!id || id === "(empty)") return "—";
  return id.length > n ? id.slice(0, n) + "…" : id;
}

/**
 * Admin gate: only logged-in admin users (users.is_admin / ADMIN_EMAILS).
 * Debug mode still auto-unlocks for local development.
 */
function AdminAccessGate({ onUnlock }: { onUnlock: (token: string) => void }) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"checking" | "denied" | "unlocking">("checking");
  const debugMode = isClientDebugMode();
  const autoUnlockStarted = useRef(false);

  const unlock = useCallback(
    async (password = "") => {
      setStatus("unlocking");
      setError("");
      try {
        const res = await fetch("/api/admin/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (res.ok) {
          onUnlock(data.token);
        } else {
          setError(data.error || "验证失败");
          setStatus("denied");
        }
      } catch {
        setError("网络错误");
        setStatus("denied");
      }
    },
    [onUnlock],
  );

  useEffect(() => {
    if (autoUnlockStarted.current) return;
    autoUnlockStarted.current = true;

    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        const me = res.ok ? await res.json() : null;
        if (me?.user?.isAdmin) {
          await unlock("");
          return;
        }
        if (debugMode) {
          await unlock("");
          return;
        }
        setStatus("denied");
        setError("需要管理员账号登录后访问");
      } catch {
        if (debugMode) {
          await unlock("");
          return;
        }
        setStatus("denied");
        setError("无法验证登录状态");
      }
    })();
  }, [debugMode, unlock]);

  if (status === "checking" || status === "unlocking") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
        <div className="w-full max-w-sm px-8 py-10 border border-border rounded-lg bg-card shadow-2xl shadow-black/50 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground font-mono">
            {debugMode && status === "unlocking"
              ? "debug 模式：进入管理后台…"
              : "正在验证管理员权限…"}
          </p>
          {error && (
            <p className="text-xs text-red-400 mt-3 flex items-center justify-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="w-full max-w-sm px-8 py-10 border border-border rounded-lg bg-card shadow-2xl shadow-black/50">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-md bg-primary/20 border border-primary/40 flex items-center justify-center">
            <Terminal className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground font-mono tracking-wide">
              管理后台
            </h2>
            <p className="text-xs text-muted-foreground">仅管理员可访问</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          请使用已标记为管理员的账号登录后再访问此页面。
          管理员邮箱通过环境变量 <code className="text-xs font-mono text-primary">ADMIN_EMAILS</code> 配置。
        </p>
        {error && (
          <p className="text-xs text-red-400 flex items-center gap-1 mb-4">
            <AlertCircle className="w-3 h-3" /> {error}
          </p>
        )}
        <a
          href="/"
          className="block w-full py-2 text-center bg-secondary hover:bg-panel-elevated text-foreground text-sm font-mono rounded transition-colors"
        >
          返回首页登录
        </a>
      </div>
    </div>
  );
}

function RuntimeSettingsPanel({ adminToken }: { adminToken: string }) {
  const [effective, setEffective] = useState<RuntimeSettingsShape | null>(null);
  const [envDefaults, setEnvDefaults] = useState<RuntimeSettingsShape | null>(
    null,
  );
  const [form, setForm] = useState<RuntimeSettingsShape | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/settings", {
        headers: { "x-admin-token": adminToken },
      });
      if (res.status === 401) {
        setError("未授权，请重新登录");
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "加载失败");
        return;
      }
      const data = await res.json();
      setEffective(data.effective);
      setEnvDefaults(data.envDefaults);
      setForm({ ...data.effective });
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  useEffect(() => {
    load();
  }, [load]);

  const setNum = (key: keyof RuntimeSettingsShape, raw: string) => {
    if (!form) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setForm({ ...form, [key]: Math.floor(n) });
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setError("");
    setOkMsg("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": adminToken,
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "保存失败");
        return;
      }
      const data = await res.json();
      setEffective(data.effective);
      setForm({ ...data.effective });
      setOkMsg("已保存（写入 data/runtime-settings.json，立即生效）");
      setTimeout(() => setOkMsg(""), 3000);
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("清除运行时覆盖，恢复为环境变量/默认值？")) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": adminToken,
        },
        body: JSON.stringify({ reset: true }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "重置失败");
        return;
      }
      const data = await res.json();
      setEffective(data.effective);
      setForm({ ...data.effective });
      setOkMsg("已恢复 env 默认");
      setTimeout(() => setOkMsg(""), 3000);
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const fields: {
    key: keyof RuntimeSettingsShape;
    label: string;
    hint: string;
    min?: number;
  }[] = [
    {
      key: "mentionScanConcurrency",
      label: "普通用户 · 并行 LLM",
      hint: "默认 4。同时进行的扫名请求数",
      min: 1,
    },
    {
      key: "mentionScanBatchUnits",
      label: "普通用户 · 每 call UNIT",
      hint: "默认 4。一次模型调用打包的 unit 数",
      min: 1,
    },
    {
      key: "mentionScanBatchChars",
      label: "每 call 正文字符预算",
      hint: "默认 16000",
      min: 4000,
    },
    {
      key: "privilegedMentionScanConcurrency",
      label: "Admin/Debug · 并行 LLM",
      hint: "默认 20。更高但仍限流友好，不会一次拉满",
      min: 1,
    },
    {
      key: "adminMentionScanBatchUnits",
      label: "管理员 · 每 call UNIT",
      hint: "默认 1。管理员扫名按 unit 粒度更细",
      min: 1,
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" />
            运行配置 · 角色扫名
          </h2>
          <p className="text-[11px] text-fog mt-1 max-w-xl leading-relaxed">
            统一管理扫名并发与打包。保存后立即生效；也可写 env（见 .env.example）。
            Admin/Debug 使用更高并发（默认 20），不是无上限并行。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={saving || !form}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="w-3 h-3" />
            恢复 env
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !form}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Save className="w-3 h-3" />
            )}
            保存
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" />
          {error}
        </p>
      )}
      {okMsg && (
        <p className="text-xs text-primary flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" />
          {okMsg}
        </p>
      )}

      {loading && !form ? (
        <div className="flex items-center gap-2 text-xs text-fog py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中…
        </div>
      ) : form ? (
        <div className="grid gap-4 sm:grid-cols-2 max-w-3xl">
          {fields.map((f) => (
            <label
              key={f.key}
              className="block p-4 rounded-lg border border-border bg-card space-y-2"
            >
              <span className="text-xs font-medium text-foreground block">
                {f.label}
              </span>
              <span className="text-[11px] text-fog block leading-snug">
                {f.hint}
                {envDefaults && (
                  <span className="text-muted-foreground">
                    {" "}
                    · env 默认 {envDefaults[f.key]}
                  </span>
                )}
              </span>
              <input
                type="number"
                min={f.min ?? 1}
                value={form[f.key]}
                onChange={(e) => setNum(f.key, e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#1a1a1a] border border-border rounded text-sm text-foreground font-mono"
              />
            </label>
          ))}
        </div>
      ) : null}

      {effective && (
        <pre className="text-[10px] text-fog font-mono p-3 rounded border border-border/60 bg-card/50 max-w-3xl overflow-x-auto">
          {JSON.stringify({ effective, envDefaults }, null, 2)}
        </pre>
      )}
    </div>
  );
}

function TokenStatsPanel({ adminToken }: { adminToken: string }) {
  const [data, setData] = useState<TokenStatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [novelId, setNovelId] = useState("");
  const [sinceDays, setSinceDays] = useState("7");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ includeRecent: "1", limit: "80" });
      if (userId.trim()) params.set("userId", userId.trim());
      if (agentId.trim()) params.set("agentId", agentId.trim());
      if (branchId.trim()) params.set("branchId", branchId.trim());
      if (novelId.trim()) params.set("novelId", novelId.trim());
      const days = Number(sinceDays);
      if (days > 0) {
        const d = new Date();
        d.setDate(d.getDate() - days);
        params.set("since", d.toISOString().slice(0, 19).replace("T", " "));
      }
      const res = await fetch(`/api/admin/tokens?${params}`, {
        headers: { "x-admin-token": adminToken },
      });
      if (res.status === 401) {
        setError("未授权，请重新登录");
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "加载失败");
        return;
      }
      setData(await res.json());
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [adminToken, userId, agentId, branchId, novelId, sinceDays]);

  useEffect(() => {
    load();
  }, [load]);

  const maxAgent = Math.max(1, ...(data?.byAgent.map((r) => r.totalTokens) || [1]));

  return (
    <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 p-4 border border-border rounded-lg bg-card">
        <label className="text-xs text-muted-foreground">
          <span className="block mb-1 font-mono">用户 ID</span>
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="guest_… / uuid"
            className="w-44 px-2 py-1.5 bg-[#1a1a1a] border border-border rounded text-xs text-foreground font-mono"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="block mb-1 font-mono">Agent</span>
          <input
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder="master / write_prose"
            className="w-40 px-2 py-1.5 bg-[#1a1a1a] border border-border rounded text-xs text-foreground font-mono"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="block mb-1 font-mono">Branch</span>
          <input
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            placeholder="main / …"
            className="w-32 px-2 py-1.5 bg-[#1a1a1a] border border-border rounded text-xs text-foreground font-mono"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="block mb-1 font-mono">Novel ID</span>
          <input
            value={novelId}
            onChange={(e) => setNovelId(e.target.value)}
            placeholder="fingerprint"
            className="w-36 px-2 py-1.5 bg-[#1a1a1a] border border-border rounded text-xs text-foreground font-mono"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="block mb-1 font-mono">时间范围</span>
          <select
            value={sinceDays}
            onChange={(e) => setSinceDays(e.target.value)}
            className="px-2 py-1.5 bg-[#1a1a1a] border border-border rounded text-xs text-foreground font-mono"
          >
            <option value="1">近 1 天</option>
            <option value="7">近 7 天</option>
            <option value="30">近 30 天</option>
            <option value="0">全部</option>
          </select>
        </label>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary hover:bg-primary disabled:opacity-50 text-white rounded font-mono"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "总 Token", value: formatTokens(data?.summary.totalTokens || 0) },
          { label: "Prompt", value: formatTokens(data?.summary.promptTokens || 0) },
          { label: "Completion", value: formatTokens(data?.summary.completionTokens || 0) },
          { label: "调用次数", value: String(data?.summary.calls || 0) },
          {
            label: "估算占比",
            value:
              data?.summary.calls
                ? Math.round(((data.summary.estimatedCalls || 0) / data.summary.calls) * 100) + "%"
                : "0%",
          },
        ].map((c) => (
          <div
            key={c.label}
            className="px-4 py-3 border border-border rounded-lg bg-card"
          >
            <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
              {c.label}
            </div>
            <div className="text-lg text-primary font-mono mt-1">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* By agent */}
        <section className="border border-border rounded-lg bg-card overflow-hidden">
          <h3 className="px-4 py-2.5 text-xs text-muted-foreground font-mono uppercase tracking-widest border-b border-border">
            按 Agent
          </h3>
          <div className="max-h-80 overflow-y-auto custom-scrollbar">
            <table className="w-full text-xs font-mono">
              <thead className="sticky top-0 bg-secondary text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-normal">Agent</th>
                  <th className="text-right px-3 py-2 font-normal">Calls</th>
                  <th className="text-right px-3 py-2 font-normal">Tokens</th>
                  <th className="px-3 py-2 w-24" />
                </tr>
              </thead>
              <tbody>
                {(data?.byAgent || []).map((r) => (
                  <tr key={r.key} className="border-t border-border/80 hover:bg-neutral-900/40">
                    <td className="px-3 py-2 text-foreground/90 truncate max-w-[140px]" title={r.key}>
                      {r.key}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{r.calls}</td>
                    <td className="px-3 py-2 text-right text-primary/90">
                      {formatTokens(r.totalTokens)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="h-1.5 rounded bg-secondary overflow-hidden">
                        <div
                          className="h-full bg-primary/70"
                          style={{ width: `${(r.totalTokens / maxAgent) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {!data?.byAgent?.length && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-fog">
                      暂无数据（有 LLM 调用后自动记录）
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* By user */}
        <section className="border border-border rounded-lg bg-card overflow-hidden">
          <h3 className="px-4 py-2.5 text-xs text-muted-foreground font-mono uppercase tracking-widest border-b border-border">
            按用户
          </h3>
          <div className="max-h-80 overflow-y-auto custom-scrollbar">
            <table className="w-full text-xs font-mono">
              <thead className="sticky top-0 bg-secondary text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-normal">User</th>
                  <th className="text-right px-3 py-2 font-normal">Calls</th>
                  <th className="text-right px-3 py-2 font-normal">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {(data?.byUser || []).map((r) => (
                  <tr key={r.key} className="border-t border-border/80 hover:bg-neutral-900/40">
                    <td className="px-3 py-2 text-foreground/90 truncate max-w-[200px]" title={r.key}>
                      {r.label || r.key}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{r.calls}</td>
                    <td className="px-3 py-2 text-right text-primary/90">
                      {formatTokens(r.totalTokens)}
                    </td>
                  </tr>
                ))}
                {!data?.byUser?.length && (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-fog">
                      暂无数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* By branch */}
        <section className="border border-border rounded-lg bg-card overflow-hidden">
          <h3 className="px-4 py-2.5 text-xs text-muted-foreground font-mono uppercase tracking-widest border-b border-border">
            按分支
          </h3>
          <div className="max-h-64 overflow-y-auto custom-scrollbar">
            <table className="w-full text-xs font-mono">
              <thead className="sticky top-0 bg-secondary text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-normal">Branch</th>
                  <th className="text-right px-3 py-2 font-normal">Calls</th>
                  <th className="text-right px-3 py-2 font-normal">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {(data?.byBranch || []).map((r) => (
                  <tr key={r.key} className="border-t border-border/80 hover:bg-neutral-900/40">
                    <td className="px-3 py-2 text-foreground/90">{r.key}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{r.calls}</td>
                    <td className="px-3 py-2 text-right text-primary/90">
                      {formatTokens(r.totalTokens)}
                    </td>
                  </tr>
                ))}
                {!data?.byBranch?.length && (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-fog">
                      暂无数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* By day */}
        <section className="border border-border rounded-lg bg-card overflow-hidden">
          <h3 className="px-4 py-2.5 text-xs text-muted-foreground font-mono uppercase tracking-widest border-b border-border">
            按日
          </h3>
          <div className="max-h-64 overflow-y-auto custom-scrollbar">
            <table className="w-full text-xs font-mono">
              <thead className="sticky top-0 bg-secondary text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-normal">Day</th>
                  <th className="text-right px-3 py-2 font-normal">Calls</th>
                  <th className="text-right px-3 py-2 font-normal">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {[...(data?.byDay || [])]
                  .sort((a, b) => b.key.localeCompare(a.key))
                  .map((r) => (
                    <tr key={r.key} className="border-t border-border/80 hover:bg-neutral-900/40">
                      <td className="px-3 py-2 text-foreground/90">{r.key}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{r.calls}</td>
                      <td className="px-3 py-2 text-right text-primary/90">
                        {formatTokens(r.totalTokens)}
                      </td>
                    </tr>
                  ))}
                {!data?.byDay?.length && (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-fog">
                      暂无数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Recent calls */}
      <section className="border border-border rounded-lg bg-card overflow-hidden">
        <h3 className="px-4 py-2.5 text-xs text-muted-foreground font-mono uppercase tracking-widest border-b border-border">
          最近调用
        </h3>
        <div className="max-h-96 overflow-auto custom-scrollbar">
          <table className="w-full text-xs font-mono min-w-[900px]">
            <thead className="sticky top-0 bg-secondary text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-normal">时间</th>
                <th className="text-left px-3 py-2 font-normal">Agent</th>
                <th className="text-left px-3 py-2 font-normal">用户</th>
                <th className="text-left px-3 py-2 font-normal">Branch</th>
                <th className="text-left px-3 py-2 font-normal">Novel</th>
                <th className="text-right px-3 py-2 font-normal">In</th>
                <th className="text-right px-3 py-2 font-normal">Out</th>
                <th className="text-right px-3 py-2 font-normal">Total</th>
                <th className="text-left px-3 py-2 font-normal">Model</th>
                <th className="text-left px-3 py-2 font-normal">Op</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent || []).map((r) => (
                <tr key={r.id} className="border-t border-border/50 hover:bg-neutral-900/40">
                  <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                    {r.createdAt?.replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="px-3 py-1.5 text-foreground/90">{r.agentId || "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground max-w-[120px] truncate" title={r.userId}>
                    {r.userLabel || shortId(r.userId, 14)}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.branchId || "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground" title={r.novelId}>
                    {shortId(r.novelId, 8)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">
                    {formatTokens(r.promptTokens)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">
                    {formatTokens(r.completionTokens)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-primary/90">
                    {formatTokens(r.totalTokens)}
                    {r.estimated ? (
                      <span className="ml-1 text-xs text-yellow-600" title="估算值">
                        ~
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground max-w-[100px] truncate" title={r.model}>
                    {r.model || "—"}
                  </td>
                  <td className="px-3 py-1.5 text-fog max-w-[100px] truncate" title={r.operation}>
                    {r.operation}
                  </td>
                </tr>
              ))}
              {!data?.recent?.length && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-fog">
                    暂无调用记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>("prompts");
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
    if (tab === "prompts") fetchList();
  }, [fetchList, tab]);

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
    return <AdminAccessGate onUnlock={handleUnlock} />;
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
    <div className="h-screen flex flex-col bg-background text-foreground font-sans">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border/80 bg-card shrink-0">
        <div className="flex items-center gap-4">
          <a
            href="/"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground/90 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            返回主站
          </a>
          <span className="w-px h-4 bg-secondary" />
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-primary" />
            <h1 className="text-sm font-bold tracking-wider text-foreground/90 font-[family-name:var(--font-geist-mono)]">
              管理后台
            </h1>
          </div>
          <span className="w-px h-4 bg-secondary" />
          <div className="flex rounded border border-border overflow-hidden text-xs font-mono">
            <button
              onClick={() => setTab("prompts")}
              className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                tab === "prompts"
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground/90"
              }`}
            >
              <Filter className="w-3 h-3" />
              提示词
            </button>
            <button
              onClick={() => setTab("tokens")}
              className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors border-l border-border ${
                tab === "tokens"
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground/90"
              }`}
            >
              <BarChart3 className="w-3 h-3" />
              Token 统计
            </button>
            <button
              onClick={() => setTab("settings")}
              className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors border-l border-border ${
                tab === "settings"
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground/90"
              }`}
            >
              <Settings className="w-3 h-3" />
              运行配置
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-fog font-[family-name:var(--font-geist-mono)]">
          {tab === "prompts" ? (
            <>
              <span>{agents.length} agents</span>
              <span>|</span>
              <span>{agents.filter((a) => a.is_modified).length} modified</span>
            </>
          ) : tab === "tokens" ? (
            <span>按 agent / 用户 / 分支 归因</span>
          ) : (
            <span>扫名并发 · UNIT 打包</span>
          )}
        </div>
      </header>

      {tab === "tokens" ? (
        <div className="flex flex-1 overflow-hidden">
          <TokenStatsPanel adminToken={token} />
        </div>
      ) : tab === "settings" ? (
        <div className="flex flex-1 overflow-hidden">
          <RuntimeSettingsPanel adminToken={token} />
        </div>
      ) : (
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[270px] shrink-0 border-r border-border/80 bg-card flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-[family-name:var(--font-geist-mono)] uppercase tracking-widest">
              <Filter className="w-3 h-3" />
              Agents
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {Object.entries(grouped).map(([cat, list]) => (
              <div key={cat} className="mb-1">
                <div className="px-4 py-2 text-xs text-muted-foreground font-[family-name:var(--font-geist-mono)] uppercase tracking-widest">
                  {CATEGORY_ICONS[cat]}{" "}
                  {CATEGORY_LABELS[cat]}
                </div>
                {list.map((agent) => (
                  <button
                    key={agent.agent_id}
                    onClick={() => setSelectedId(agent.agent_id)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors border-l-2 ${
                      selectedId === agent.agent_id
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-transparent hover:bg-panel-elevated text-muted-foreground hover:text-foreground/90"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate">{agent.name}</span>
                      {agent.is_modified ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" title="已修改" />
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {/* Editor */}
        <main className="flex-1 flex flex-col overflow-hidden bg-background">
          {selectedMeta ? (
            <>
              {/* Editor header */}
              <div className="px-6 py-3 border-b border-border/60 bg-card flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-sm font-semibold text-foreground/90 font-[family-name:var(--font-geist-mono)]">
                    {selectedMeta.name}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {selectedMeta.description}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex rounded border border-border overflow-hidden text-xs font-[family-name:var(--font-geist-mono)]">
                    {(["zh", "en"] as const).map((l) => (
                      <button
                        key={l}
                        onClick={() => setSelectedLang(l)}
                        className={`px-2.5 py-1 transition-colors ${
                          selectedLang === l
                            ? "bg-neutral-700 text-foreground"
                            : "bg-transparent text-muted-foreground hover:text-foreground/90"
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
                  <label className="block text-xs text-muted-foreground font-[family-name:var(--font-geist-mono)] uppercase tracking-widest mb-2">
                    System Prompt
                  </label>
                  <div className="relative">
                    <textarea
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      className="w-full min-h-[420px] px-4 py-3 bg-secondary border border-border rounded font-[family-name:var(--font-geist-mono)] text-sm text-foreground/90 leading-relaxed resize-y focus:outline-none focus:border-primary/50 transition-colors placeholder-neutral-700"
                      placeholder="未修改 — 使用硬编码默认提示词"
                      spellCheck={false}
                    />
                  </div>
                  {currentPrompt?.is_modified ? (
                    <p className="text-xs text-primary/70 mt-1.5 font-[family-name:var(--font-geist-mono)] flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      已自定义 — 将覆盖默认提示词
                    </p>
                  ) : null}
                </section>

                {/* Variables reference */}
                <section className="border border-border/80 rounded bg-card p-4 mt-6">
                  <h3 className="text-xs text-muted-foreground font-[family-name:var(--font-geist-mono)] uppercase tracking-widest mb-2">
                    可用变量
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    <code className="px-2 py-0.5 bg-[#1a1a1a] border border-border/50 rounded text-xs text-primary/80 font-[family-name:var(--font-geist-mono)]">
                      {"{{" + "变量名" + "}}"}
                    </code>
                    <span className="text-xs text-fog self-center">
                      — 使用双花括号包裹变量名
                    </span>
                  </div>
                </section>
              </div>

              {/* Editor footer */}
              <div className="px-6 py-3 border-t border-border/60 bg-card flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 text-xs text-fog font-[family-name:var(--font-geist-mono)]">
                  <span>
                    agent_id: <code className="text-muted-foreground">{selectedMeta.agent_id}</code>
                  </span>
                  {selectedMeta.is_modified ? (
                    <span className="text-primary/60">
                      · modified {selectedMeta.updated_at}
                    </span>
                  ) : (
                    <span className="text-neutral-700">· default</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleReset}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-red-400 border border-border hover:border-red-500/30 rounded transition-colors font-[family-name:var(--font-geist-mono)]"
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
                        : "bg-primary hover:bg-primary text-white border border-primary"
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
      )}
    </div>
  );
}
