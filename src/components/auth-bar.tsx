"use client";

import { useCallback, useEffect, useState } from "react";
import { LogIn, LogOut, User, X } from "lucide-react";

interface MeResponse {
  userId: string;
  kind: "user" | "guest";
  user: { id: string; email: string; displayName: string } | null;
}

type Mode = "login" | "register";

export default function AuthBar() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) setMe(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login"
          ? { email, password }
          : { email, password, displayName: displayName || undefined };
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "失败");
        return;
      }
      setMe({
        userId: data.userId,
        kind: data.kind,
        user: data.user,
      });
      setOpen(false);
      setPassword("");
      // Reload libraries under new user id
      window.location.reload();
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
    window.location.reload();
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
    } catch { /* ignore */ }
  };

  const shortId = (id: string) => {
    if (id.length <= 14) return id;
    return `${id.slice(0, 10)}…${id.slice(-4)}`;
  };

  if (me?.kind === "user" && me.user) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => copyId(me.userId)}
          className="hidden sm:inline text-[10px] text-neutral-500 font-mono max-w-[120px] truncate hover:text-neutral-300"
          title={`${me.user.email}\nID: ${me.userId}\n点击复制 ID`}
        >
          {me.user.displayName || me.user.email}
        </button>
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 font-mono px-2 py-1.5"
          title="退出登录"
        >
          <LogOut className="w-3 h-3" />
          <span className="hidden sm:inline">退出</span>
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-1 shrink-0">
        {me?.userId && (
          <button
            type="button"
            onClick={() => copyId(me.userId)}
            className="text-[10px] text-neutral-600 hover:text-orange-400/90 font-mono px-1.5 py-1 max-w-[9.5rem] sm:max-w-[12rem] truncate"
            title={`${me.userId}\n（Cookie 游客 ID，点击复制）`}
          >
            游客 {shortId(me.userId)}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setMode("login");
            setError("");
          }}
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300 font-mono px-2 py-1.5"
          title="登录 / 注册"
        >
          <LogIn className="w-3 h-3" />
          <span className="hidden sm:inline">登录</span>
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-[#0e0e0e] border border-neutral-800 rounded-t-xl sm:rounded-lg p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-neutral-300 font-mono flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-orange-500" />
                {mode === "login" ? "登录" : "注册"}
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="p-1 text-neutral-500 hover:text-neutral-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[10px] text-neutral-600 font-mono mb-3 leading-relaxed">
              未登录时以游客身份使用（浏览器 Cookie 标记，换网络不丢数据）。
              登录后数据按账号隔离。
            </p>
            {me?.userId && (
              <div className="mb-3 px-2 py-1.5 rounded bg-neutral-900/80 border border-neutral-800">
                <div className="text-[9px] text-neutral-600 font-mono mb-0.5">当前游客 ID</div>
                <button
                  type="button"
                  onClick={() => copyId(me.userId)}
                  className="text-[10px] text-orange-400/90 font-mono break-all text-left hover:text-orange-300 w-full"
                  title="点击复制"
                >
                  {me.userId}
                </button>
              </div>
            )}

            <form onSubmit={submit} className="space-y-3">
              {mode === "register" && (
                <div>
                  <label className="block text-[10px] text-neutral-500 font-mono mb-1">昵称（可选）</label>
                  <input
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono outline-none focus:border-orange-600/50"
                    placeholder="怎么称呼你"
                    autoComplete="nickname"
                  />
                </div>
              )}
              <div>
                <label className="block text-[10px] text-neutral-500 font-mono mb-1">邮箱</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono outline-none focus:border-orange-600/50"
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="block text-[10px] text-neutral-500 font-mono mb-1">密码</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-[#111110] border border-neutral-800 rounded text-sm text-neutral-300 font-mono outline-none focus:border-orange-600/50"
                  placeholder={mode === "register" ? "至少 8 位" : "••••••••"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </div>
              {error && <p className="text-[11px] text-red-400 font-mono">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 rounded text-sm font-mono bg-orange-600 hover:bg-orange-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white"
              >
                {loading ? "提交中…" : mode === "login" ? "登录" : "注册并登录"}
              </button>
            </form>

            <button
              type="button"
              className="mt-3 w-full text-[11px] text-neutral-500 hover:text-neutral-300 font-mono"
              onClick={() => {
                setMode(m => (m === "login" ? "register" : "login"));
                setError("");
              }}
            >
              {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
