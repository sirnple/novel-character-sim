"use client";

import { useCallback, useEffect, useState } from "react";
import type { ShareVisibility } from "@/lib/share-payload";
import { X, Copy, Check, Link2, Trash2 } from "lucide-react";

interface ShareItem {
  token: string;
  visibility: ShareVisibility;
  createdAt: string;
  revokedAt: string | null;
  url: string;
}

export default function ShareDialog({
  open,
  onClose,
  novelId,
}: {
  open: boolean;
  onClose: () => void;
  novelId: string;
}) {
  const [visibility, setVisibility] = useState<ShareVisibility>("public");
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!novelId) return;
    try {
      const res = await fetch(`/api/share?novelId=${encodeURIComponent(novelId)}`);
      if (!res.ok) {
        setError("加载分享列表失败");
        return;
      }
      const data = await res.json();
      setShares(data.shares || []);
    } catch {
      setError("加载分享列表失败");
    }
  }, [novelId]);

  useEffect(() => {
    if (open) {
      setError("");
      refresh();
    }
  }, [open, refresh]);

  const absoluteUrl = (path: string) =>
    typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

  const copy = async (path: string) => {
    const full = absoluteUrl(path);
    try {
      await navigator.clipboard.writeText(full);
      setCopied(path);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("复制失败，请手动复制");
    }
  };

  const create = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novelId, visibility }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || "生成失败");
        return;
      }
      await copy(data.url);
      await refresh();
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const revoke = async (token: string) => {
    setError("");
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        let message = "撤销失败";
        try {
          const data = await res.json();
          message = data.message || data.error || message;
        } catch {
          /* ignore parse errors */
        }
        setError(message);
      }
      await refresh();
    } catch {
      setError("撤销失败");
      await refresh();
    }
  };

  const toggleVis = async (item: ShareItem) => {
    setError("");
    const next: ShareVisibility = item.visibility === "public" ? "auth" : "public";
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(item.token)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!res.ok) {
        let message = "更改可见性失败";
        try {
          const data = await res.json();
          message = data.message || data.error || message;
        } catch {
          /* ignore parse errors */
        }
        setError(message);
        return;
      }
      await refresh();
    } catch {
      setError("更改可见性失败");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="关闭" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" />
            分享概览
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 mb-4">
          <p className="text-xs text-fog">生成当前故事与角色的只读快照链接（不含正文）。</p>
          <div className="flex gap-2">
            <label className="flex-1 text-sm flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="vis"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
              />
              公开链接
            </label>
            <label className="flex-1 text-sm flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="vis"
                checked={visibility === "auth"}
                onChange={() => setVisibility("auth")}
              />
              仅登录可见
            </label>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={create}
            className="w-full rounded-xl bg-primary text-primary-foreground text-sm font-medium py-2.5 disabled:opacity-50"
          >
            {loading ? "生成中…" : "生成并复制链接"}
          </button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium text-fog mb-2">已生成的链接</p>
          {shares.length === 0 ? (
            <p className="text-xs text-fog">暂无</p>
          ) : (
            <ul className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
              {shares.map((s) => (
                <li
                  key={s.token}
                  className="rounded-xl border border-border/60 px-3 py-2 text-xs flex flex-col gap-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="ov-chip-muted">
                      {s.visibility === "public" ? "公开" : "登录"}
                    </span>
                    <span className="text-fog truncate flex-1">{s.token.slice(0, 10)}…</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary"
                      onClick={() => copy(s.url)}
                    >
                      {copied === s.url ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      复制
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1 rounded-lg bg-secondary"
                      onClick={() => toggleVis(s)}
                    >
                      改为{s.visibility === "public" ? "登录" : "公开"}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary text-destructive"
                      onClick={() => revoke(s.token)}
                    >
                      <Trash2 className="w-3 h-3" />
                      撤销
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
