"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
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

  // After login in another tab, retry when this tab regains focus
  useEffect(() => {
    if (state.kind !== "auth_required") return;
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [state.kind, load]);

  if (state.kind === "loading") {
    return (
      <div className="min-h-full p-8 text-center text-fog text-sm">加载中…</div>
    );
  }
  if (state.kind === "not_found") {
    return (
      <div className="min-h-full p-8 flex flex-col items-center justify-center gap-2">
        <p className="text-foreground font-medium">链接不存在或已失效</p>
      </div>
    );
  }
  if (state.kind === "auth_required") {
    return (
      <div className="min-h-full p-8 flex flex-col items-center justify-center gap-3">
        <p className="text-foreground font-medium">此链接仅登录用户可查看</p>
        <p className="text-sm text-fog text-center max-w-sm">
          请先在其他标签页登录本站账号，再回到此页刷新。
        </p>
        <button
          type="button"
          className="text-sm text-primary hover:underline"
          onClick={() => load()}
        >
          刷新重试
        </button>
      </div>
    );
  }
  return <ShareOverviewView payload={state.payload} />;
}
