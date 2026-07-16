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

  const inputClass =
    "w-full px-3 py-2.5 bg-secondary border border-border rounded-lg text-sm text-foreground outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

  if (me?.kind === "user" && me.user) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => copyId(me.userId)}
          className="hidden sm:inline text-sm text-muted-foreground max-w-[140px] truncate hover:text-foreground px-2 py-1.5 rounded-lg"
          title={`${me.user.email}\nID: ${me.userId}\n点击复制 ID`}
        >
          {me.user.displayName || me.user.email}
        </button>
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2.5 py-2 rounded-lg hover:bg-panel-elevated"
          title="退出登录"
        >
          <LogOut className="w-4 h-4" />
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
            className="text-xs text-fog hover:text-primary px-1.5 py-1.5 max-w-[9.5rem] sm:max-w-[12rem] truncate rounded-lg"
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
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2.5 py-2 rounded-lg hover:bg-panel-elevated"
          title="登录 / 注册"
        >
          <LogIn className="w-4 h-4" />
          <span className="hidden sm:inline">登录</span>
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm bg-card border border-border rounded-t-xl sm:rounded-xl p-5 sm:p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                {mode === "login" ? "登录" : "注册"}
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-panel-elevated">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              未登录时以游客身份使用（浏览器 Cookie 标记，换网络不丢数据）。
              登录后数据按账号隔离。
            </p>
            {me?.userId && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-secondary border border-border">
                <div className="text-xs text-fog mb-1">当前游客 ID</div>
                <button
                  type="button"
                  onClick={() => copyId(me.userId)}
                  className="text-xs text-primary break-all text-left hover:brightness-110 w-full font-mono"
                  title="点击复制"
                >
                  {me.userId}
                </button>
              </div>
            )}

            <form onSubmit={submit} className="space-y-3.5">
              {mode === "register" && (
                <div>
                  <label className="block text-sm text-muted-foreground mb-1.5">昵称（可选）</label>
                  <input
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className={inputClass}
                    placeholder="怎么称呼你"
                    autoComplete="nickname"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">邮箱</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1.5">密码</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder={mode === "register" ? "至少 8 位" : "••••••••"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full"
              >
                {loading ? "提交中…" : mode === "login" ? "登录" : "注册并登录"}
              </button>
            </form>

            <button
              type="button"
              className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground"
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
