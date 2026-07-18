"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ShareOverviewView from "@/components/share-overview-view";
import type { ShareOverviewPayload } from "@/lib/share-payload";

type State =
  | { kind: "loading" }
  | { kind: "ok"; payload: ShareOverviewPayload }
  | { kind: "not_found" }
  | { kind: "auth_required" };

export default function SharePage() {
  const params = useParams();
  const token = typeof params.token === "string" ? params.token : "";
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(() => {
    if (!token) {
      setState({ kind: "not_found" });
      return;
    }
    setState({ kind: "loading" });
    fetch(`/api/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.status === 404) {
          setState({ kind: "not_found" });
          return;
        }
        if (res.status === 401) {
          setState({ kind: "auth_required" });
          return;
        }
        if (!res.ok) {
          setState({ kind: "not_found" });
          return;
        }
        const data = await res.json();
        setState({ kind: "ok", payload: data.payload });
      })
      .catch(() => setState({ kind: "not_found" }));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // After login in another tab/window, retry when page regains focus
  useEffect(() => {
    if (state.kind !== "auth_required") return;
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [state.kind, load]);

  if (state.kind === "loading") {
    return (
      <div className="flex-1 overflow-y-auto p-8 text-center text-fog text-sm">
        加载中…
      </div>
    );
  }
  if (state.kind === "not_found") {
    return (
      <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center justify-center gap-3">
        <p className="text-foreground font-medium">链接不存在或已失效</p>
        <Link href="/" className="text-sm text-primary">
          返回首页
        </Link>
      </div>
    );
  }
  if (state.kind === "auth_required") {
    return (
      <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center justify-center gap-3">
        <p className="text-foreground font-medium">需要登录后查看</p>
        <p className="text-sm text-fog">
          请使用右上角登录；登录成功后回到本页或刷新
        </p>
        <button
          type="button"
          className="text-sm text-primary"
          onClick={() => load()}
        >
          我已登录，重试
        </button>
        <Link href="/" className="text-sm text-fog">
          返回首页
        </Link>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-background">
      <ShareOverviewView payload={state.payload} />
    </div>
  );
}
