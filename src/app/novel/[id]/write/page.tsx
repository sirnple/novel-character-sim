"use client";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Link from "next/link";
import { useNovel } from "@/lib/novel-context";
import { GitBranch, BookOpen, Download, ListTree, Sparkles } from "lucide-react";
import ScrollEdgeButtons from "@/components/scroll-edge-buttons";
import {
  TextFindBar,
  renderHighlightedText,
  useFindShortcut,
  useScrollToMatch,
  useTextFindSegments,
} from "@/components/text-find";
import { downloadBranchAsTxt } from "@/lib/download-branch-txt";
import VirtualNovelBody, {
  absoluteOffsetFromClick,
  type VirtualChunk,
} from "@/components/virtual-novel-body";
import ReaderTimelineRail, {
  catalogToRailUnits,
  useApproxScrollOffset,
  type RailUnit,
} from "@/components/reader-timeline-rail";
import type { ChapterCatalogEntry } from "@/types";

/** Branch list metadata (no full text). */
interface BranchInfo {
  id: string;
  name: string;
  parent_offset: number;
  updated_at: string;
  char_count?: number;
}

export default function WritePage() {
  const {
    novelId, novelTitle, novelLength, setNovel, generatedProse, setActiveBranchId, setNovelText,
    timeline, characters, storyInfo,
  } = useNovel();
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [activeBranchId, setLocalBranchId] = useState<string | null>(null);
  const [freeMode, setFreeMode] = useState(false);
  /** null = still checking this novel; boolean = gate result for current novelId only */
  const [analysisReady, setAnalysisReady] = useState<boolean | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const [newBranchName, setNewBranchName] = useState("");
  // Click-to-fork state — offsets are absolute in full branch body
  const [forkPoint, setForkPoint] = useState<{ offset: number; label: string; context: string } | null>(null);
  const [showForkDialog, setShowForkDialog] = useState(false);

  /** Full resolved body of the selected branch (virtual scroll mounts only viewport). */
  const [fullBody, setFullBody] = useState("");
  const [bodyLoading, setBodyLoading] = useState(false);

  /** Timeline / chapter rail (from form catalog + async job) */
  const [catalog, setCatalog] = useState<ChapterCatalogEntry[]>([]);
  const [jobUnits, setJobUnits] = useState<RailUnit[] | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [latestJobId, setLatestJobId] = useState<string | null>(null);
  const [retryingUnitId, setRetryingUnitId] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const [timelineOpen, setTimelineOpen] = useState(false);

  const activeBranch = branches.find(b => b.id === activeBranchId);
  const hasSelection = freeMode || activeBranchId === "main" || !!activeBranch;
  // Always full novel text — VirtualNovelBody handles long-scroll DOM cost
  const bodyText = fullBody;
  const proseText = generatedProse || "";
  const find = useTextFindSegments([bodyText, proseText]);
  useFindShortcut(find.searchInputRef, hasSelection);
  useScrollToMatch(readerRef, find.currentIndex, find.matchCount, [find.debouncedQuery, bodyText, proseText]);
  const scrollOffset = useApproxScrollOffset(readerRef, bodyText.length);

  const railUnits: RailUnit[] = useMemo(() => {
    if (jobUnits && jobUnits.length > 0) return jobUnits;
    if (catalog.length > 0) return catalogToRailUnits(catalog);
    const chs = timeline?.chapters || [];
    if (!chs.length) return [];
    return chs.map((c, i) => ({
      id: `tl_${c.chapterNumber}_${i}`,
      label: c.title ? `第${c.chapterNumber}章 ${c.title}` : `第${c.chapterNumber}章`,
      startOffset: 0,
      summary: c.events?.[0]?.description?.slice(0, 80),
      status: "ready" as const,
    }));
  }, [jobUnits, catalog, timeline]);

  const [queryOffset, setQueryOffset] = useState<string | null>(null);
  const [queryLabel, setQueryLabel] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQueryOffset(params.get("offset"));
    setQueryLabel(params.get("label"));
    // Overview (or deep links) may pass ?branch= to open a specific branch
    const branch = params.get("branch")?.trim();
    if (branch) {
      setLocalBranchId(branch);
      setFreeMode(false);
    }
  }, []);

  // Metadata list only
  useEffect(() => {
    if (!novelId) return;
    fetch(`/api/branches?novelId=${encodeURIComponent(novelId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.branches) setBranches(d.branches);
      })
      .catch(() => {});
  }, [novelId]);

  // Gate: readiness from APIs for THIS novelId only (don't trust stale context from another book)
  useEffect(() => {
    if (!novelId) return;
    let cancelled = false;
    setAnalysisReady(null);
    Promise.all([
      fetch(
        `/api/chapter-meta?novelId=${encodeURIComponent(novelId)}&branchId=main`,
      ).then((r) => r.json()),
      fetch(
        `/api/novels?id=${encodeURIComponent(novelId)}&meta=1`,
      ).then((r) => r.json()),
    ])
      .then(([meta, novel]) => {
        if (cancelled) return;
        const hasForm = !!meta?.form;
        const chars = Array.isArray(novel?.characters) ? novel.characters.length : 0;
        const hasStory = !!(novel?.storyInfo?.plotSummary);
        setAnalysisReady(hasForm && chars > 0 && hasStory);
        // Refresh context for this book if shell had stale data
        if (novel?.title) {
          setNovel({
            novelId,
            novelTitle: novel.title,
            novelLength: novel.totalLength || 0,
            characters: novel.characters || [],
            storyInfo: novel.storyInfo || null,
            timeline: novel.timeline || null,
            lastChapterStates: novel.lastChapterStates || [],
          });
        }
      })
      .catch(() => {
        if (!cancelled) setAnalysisReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [novelId, setNovel]);

  // Chapter catalog for current branch
  useEffect(() => {
    if (!novelId || freeMode) return;
    const bid = activeBranchId || "main";
    fetch(
      `/api/chapter-meta?novelId=${encodeURIComponent(novelId)}&branchId=${encodeURIComponent(bid)}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.meta?.chapters) setCatalog(d.meta.chapters);
        else setCatalog([]);
      })
      .catch(() => setCatalog([]));
  }, [novelId, activeBranchId, freeMode]);

  // Poll timeline job for branch
  useEffect(() => {
    if (!novelId || freeMode) return;
    const bid = activeBranchId || "main";
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/timeline/job?novelId=${encodeURIComponent(novelId)}&branchId=${encodeURIComponent(bid)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        const job = data.latest;
        if (!job || cancelled) return;
        setLatestJobId(job.id || null);
        setJobStatus(
          job.status === "running" || job.status === "queued"
            ? `${job.completed}/${job.total}`
            : job.status,
        );
        if (Array.isArray(job.units)) {
          const anyActive = job.units.some(
            (u: { status?: string }) => u.status === "running" || u.status === "pending",
          );
          if (!anyActive) setRetryingUnitId(null);
          setJobUnits(
            job.units.map((u: {
              unitId: string;
              label: string;
              startOffset?: number;
              endOffset?: number;
              summary?: string;
              error?: string;
              status?: string;
            }) => ({
              id: u.unitId,
              label: u.label,
              startOffset: u.startOffset ?? 0,
              endOffset: u.endOffset,
              summary: u.summary,
              error: u.error,
              status:
                u.status === "done"
                  ? "ready"
                  : u.status === "error"
                    ? "error"
                    : u.status === "running" || u.status === "pending"
                      ? "pending"
                      : "ready",
            })),
          );
        }
        const keepPolling =
          job.status === "running" ||
          job.status === "queued" ||
          (Array.isArray(job.units) &&
            job.units.some(
              (u: { status?: string }) =>
                u.status === "running" || u.status === "pending",
            ));
        if (keepPolling) timer = setTimeout(poll, 2500);
      } catch {
        /* ignore */
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [novelId, activeBranchId, freeMode, pollTick]);

  const applyBody = useCallback((text: string) => {
    setFullBody(text || "");
  }, []);

  const loadBranchBody = useCallback(
    async (branchId: string) => {
      if (!novelId || !branchId) return;
      setBodyLoading(true);
      try {
        const res = await fetch(
          `/api/branches?novelId=${encodeURIComponent(novelId)}&branchId=${encodeURIComponent(branchId)}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "load failed");
        const text = String(data.branch?.text || "");
        applyBody(text);
        setBranches((prev) =>
          prev.map((b) =>
            b.id === branchId
              ? { ...b, char_count: text.length, name: data.branch?.name || b.name }
              : b,
          ),
        );
        if (branchId === "main") {
          setNovelText(text);
          setNovel({ novelLength: text.length });
        }
      } catch {
        applyBody("");
      } finally {
        setBodyLoading(false);
      }
    },
    [novelId, applyBody, setNovel, setNovelText],
  );

  // Load body when selection changes
  useEffect(() => {
    if (freeMode) {
      loadBranchBody("main");
      return;
    }
    if (activeBranchId) {
      loadBranchBody(activeBranchId);
    } else {
      applyBody("");
    }
  }, [activeBranchId, freeMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Accept 续写：refetch body (do not trust multi-MB event payloads)
  useEffect(() => {
    const onBranchUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as {
        novelId?: string;
        branchId?: string;
        text?: string;
        totalLength?: number;
      };
      if (!detail || detail.novelId !== novelId || !detail.branchId) return;
      const bid = detail.branchId;
      if (typeof detail.totalLength === "number") {
        setBranches((prev) =>
          prev.map((b) => (b.id === bid ? { ...b, char_count: detail.totalLength! } : b)),
        );
      }
      // Prefer full text if small payload sent; else refetch
      if (detail.text != null && detail.text.length > 0 && detail.text.length <= 200_000) {
        if (activeBranchId === bid || (freeMode && bid === "main")) {
          applyBody(detail.text);
        }
        if (bid === "main") setNovelText(detail.text);
      } else if (activeBranchId === bid || (freeMode && bid === "main") || bid === activeBranchId) {
        loadBranchBody(bid);
      } else {
        // inactive branch: just refresh meta length via list
        fetch(`/api/branches?novelId=${encodeURIComponent(novelId)}`)
          .then((r) => r.json())
          .then((d) => {
            if (d.branches) setBranches(d.branches);
          })
          .catch(() => {});
      }
    };
    window.addEventListener("ncs:branch-updated", onBranchUpdated);
    return () => window.removeEventListener("ncs:branch-updated", onBranchUpdated);
  }, [novelId, activeBranchId, freeMode, applyBody, loadBranchBody, setNovelText]);

  // Sync writing target to context — ids/offset only (no full sessionNovelText)
  useEffect(() => {
    const total = fullBody.length;
    if (activeBranchId && activeBranch && !freeMode) {
      setNovel({
        sessionContinueOffset: total,
        sessionContinueLabel: `分支: ${activeBranch.name}`,
      });
      setActiveBranchId(activeBranchId);
    } else if (activeBranchId === "main" && !freeMode) {
      setNovel({
        sessionContinueOffset: total || novelLength,
        sessionContinueLabel: "主线",
      });
      setActiveBranchId("main");
    } else if (freeMode) {
      setNovel({
        sessionContinueOffset: undefined,
        sessionContinueLabel: "自由创作",
      });
      setActiveBranchId("main");
    } else if (queryOffset) {
      setLocalBranchId("main");
      setFreeMode(false);
      setNovel({
        sessionContinueOffset: parseInt(queryOffset, 10),
        sessionContinueLabel: queryLabel || "续写点",
      });
      setActiveBranchId("main");
    } else {
      setNovel({
        sessionContinueOffset: undefined,
        sessionContinueLabel: undefined,
      });
      setActiveBranchId(undefined);
    }
  }, [activeBranchId, activeBranch?.name, freeMode, fullBody.length, novelLength, queryOffset, queryLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownloadBranch = async (branchId: string, name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!novelId || !branchId) return;
    const err = await downloadBranchAsTxt(
      novelId,
      branchId,
      branchId === "main" ? `${novelTitle || "主线"}_主线` : name,
    );
    if (err) alert(err);
  };

  const createBranch = async () => {
    if (!newBranchName.trim()) return;
    // CoW fork: only parentOffset + parentBranchId; server stores empty suffix
    const sourceText = fullBody || "";
    const offset = Math.min(
      Math.max(0, forkPoint?.offset ?? sourceText.length),
      sourceText.length,
    );
    const parentBranchId =
      freeMode || !activeBranchId || activeBranchId === "main" ? "main" : activeBranchId;
    const res = await fetch("/api/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        novelId,
        name: newBranchName,
        parentOffset: offset,
        parentBranchId,
      }),
    });
    const data = await res.json();
    if (data.branch) {
      const b = data.branch;
      const meta: BranchInfo = {
        id: b.id,
        name: b.name || newBranchName,
        parent_offset: b.parent_offset ?? offset,
        updated_at: b.updated_at || new Date().toISOString(),
        char_count: typeof b.char_count === "number" ? b.char_count : offset,
      };
      setBranches((prev) => [meta, ...prev.filter((x) => x.id !== meta.id)]);
      setLocalBranchId(meta.id);
      // Resolved full text from API (parent prefix + empty suffix)
      applyBody(String(b.text || sourceText.slice(0, offset)));
      setShowForkDialog(false);
      setNewBranchName("");
      setForkPoint(null);
    }
  };

  // Click handler for fork — absolute offset in full novel body
  const handleEditorClick = (e: React.MouseEvent) => {
    if (!bodyText || freeMode) return;
    const el = readerRef.current;
    if (!el) return;
    const abs = absoluteOffsetFromClick(
      el,
      e.clientX,
      e.clientY,
      bodyText.length,
    );
    if (abs == null) return;
    const ctxStart = Math.max(0, abs - 100);
    const ctxEnd = Math.min(fullBody.length, abs + 100);
    setForkPoint({
      offset: abs,
      label: `偏移 ${abs.toLocaleString()} 字`,
      context: fullBody.slice(ctxStart, ctxEnd),
    });
  };

  const selectMain = () => {
    setLocalBranchId("main");
    setFreeMode(false);
  };
  const selectBranch = (id: string) => {
    setLocalBranchId(id);
    setFreeMode(false);
  };
  const selectFree = () => {
    setFreeMode(true);
    setLocalBranchId(null);
  };

  const onBranchSelectChange = (value: string) => {
    if (value === "__free__") selectFree();
    else if (value === "main") selectMain();
    else selectBranch(value);
  };

  const branchSelectValue = freeMode
    ? "__free__"
    : activeBranchId || "";

  const jumpToOffset = useCallback(
    (startOffset: number) => {
      const el = readerRef.current;
      if (!el || !bodyText.length) return;
      const max = el.scrollHeight - el.clientHeight;
      const ratio = Math.min(1, Math.max(0, startOffset / bodyText.length));
      el.scrollTo({ top: max * ratio, behavior: "smooth" });
      setTimelineOpen(false);
    },
    [bodyText.length],
  );

  const handleRetryUnit = useCallback(
    async (unitId: string) => {
      if (!latestJobId || !unitId) return;
      setRetryingUnitId(unitId);
      try {
        const res = await fetch("/api/timeline/job", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "retry_unit",
            jobId: latestJobId,
            unitId,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert((data as { error?: string }).error || "重试失败");
          setRetryingUnitId(null);
          return;
        }
        setPollTick((t) => t + 1);
      } catch {
        alert("重试失败");
        setRetryingUnitId(null);
      }
    },
    [latestJobId],
  );

  const railTitle =
    jobStatus &&
    (jobStatus.includes("/") || jobStatus === "running" || jobStatus === "queued")
      ? `时间线 ${jobStatus}`
      : catalog.length || jobUnits?.length
        ? "目录 / 时间线"
        : "时间线";

  const localMatches = useCallback(
    (global: number[], base: number, len: number) => {
      const out: number[] = [];
      for (const m of global) {
        if (m >= base && m < base + len) out.push(m - base);
      }
      return out;
    },
    [],
  );

  const renderBodyChunk = useCallback(
    (chunk: VirtualChunk) => {
      const matches = localMatches(
        find.segmentMatches[0] || [],
        chunk.baseOffset,
        chunk.text.length,
      );
      let cont: number | null = null;
      let node: React.ReactNode = null;
      if (forkPoint && !freeMode) {
        const abs = forkPoint.offset;
        if (
          abs >= chunk.baseOffset &&
          abs <= chunk.baseOffset + chunk.text.length
        ) {
          cont = abs - chunk.baseOffset;
          node = (
            <span key="fork" className="inline-flex items-center gap-1.5 mx-1 align-middle">
              <span className="inline-block w-1.5 h-5 bg-primary animate-pulse rounded-sm" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowForkDialog(true);
                  setNewBranchName("");
                }}
                className="text-xs font-medium bg-primary hover:brightness-110 text-primary-foreground px-2.5 py-1 rounded-md"
              >
                分叉
              </button>
            </span>
          );
        }
      }
      return (
        <div className="reader-frame py-2 sm:py-3">
          <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-4 sm:py-6">
            <div className="prose-novel text-paper-foreground whitespace-pre-wrap">
              {renderHighlightedText({
                text: chunk.text,
                matches,
                queryLen: find.queryLen,
                currentIndex: find.currentIndex,
                matchIndexBase: find.matchIndexBase(0),
                continueOffset: cont,
                continueNode: node,
              })}
            </div>
          </div>
        </div>
      );
    },
    // find object identity changes each render; primitive fields listed via usage inside
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable enough: match arrays + query
    [
      find.segmentMatches,
      find.queryLen,
      find.currentIndex,
      forkPoint,
      freeMode,
      localMatches,
    ],
  );

  const proseHighlighted = useMemo(
    () =>
      proseText
        ? renderHighlightedText({
            text: proseText,
            matches: find.segmentMatches[1] || [],
            queryLen: find.queryLen,
            currentIndex: find.currentIndex,
            matchIndexBase: find.matchIndexBase(1),
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proseText, find.segmentMatches, find.queryLen, find.currentIndex],
  );

  const charLabel = (b: BranchInfo) =>
    (typeof b.char_count === "number" ? b.char_count : 0).toLocaleString();

  const timelineRail = (
    <ReaderTimelineRail
      title={railTitle}
      units={railUnits}
      scrollOffset={scrollOffset}
      onJump={jumpToOffset}
      onRetryUnit={latestJobId ? handleRetryUnit : undefined}
      retryingUnitId={retryingUnitId}
    />
  );

  if (analysisReady === null) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-0 text-sm text-fog">
        检查本书分析状态…
      </div>
    );
  }

  if (analysisReady === false) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-0 p-6">
        <div className="max-w-sm text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-ember-soft flex items-center justify-center">
            <Sparkles className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">本书尚未完成分析</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            仅限制<strong className="text-foreground/90 font-medium">当前这本书</strong>
            。其他已分析的书可从侧栏打开继续写作。请回到概览，点右下角
            <span className="text-primary font-medium"> 分析 </span>
            （可关闭面板，分析在后台进行）。
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <Link href={`/novel/${novelId}`} className="btn-primary inline-flex">
              返回概览分析
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm text-foreground hover:bg-panel-elevated"
            >
              打开其他书籍
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      {/* Desktop: timeline rail (left) */}
      {!freeMode && hasSelection && (
        <div className="hidden md:flex flex-col shrink-0 border-r border-border/60 bg-card/40">
          {timelineRail}
          <p className="px-2 pb-2 text-[10px] text-fog leading-snug max-w-[180px]">
            跳转按字数比例估算
          </p>
        </div>
      )}

      {/* Mobile timeline drawer */}
      {timelineOpen && !freeMode && (
        <div className="md:hidden fixed inset-0 z-30 flex safe-drawer-pad">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="关闭时间线"
            onClick={() => setTimelineOpen(false)}
          />
          <div className="relative z-10 h-full max-w-[85vw] w-[220px] bg-card border-r border-border shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-2 py-2 border-b border-border/60">
              <span className="text-xs font-semibold text-muted-foreground">{railTitle}</span>
              <button
                type="button"
                className="text-xs text-fog px-2 py-1"
                onClick={() => setTimelineOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ReaderTimelineRail
                className="w-full h-full border-0"
                title=""
                units={railUnits}
                scrollOffset={scrollOffset}
                onJump={jumpToOffset}
                onRetryUnit={latestJobId ? handleRetryUnit : undefined}
                retryingUnitId={retryingUnitId}
              />
            </div>
          </div>
        </div>
      )}

      {/* Center: Editor */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-border/60 bg-card shrink-0">
          <GitBranch className="w-4 h-4 text-primary shrink-0" />
          <select
            value={branchSelectValue}
            onChange={(e) => onBranchSelectChange(e.target.value)}
            className="min-w-0 max-w-[min(100%,16rem)] sm:max-w-xs flex-1 sm:flex-none bg-secondary border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary/50"
            aria-label="选择分支"
          >
            <option value="" disabled>
              选择分支…
            </option>
            {(branches.length === 0
              ? [{ id: "main", name: "主线", parent_offset: 0, updated_at: "", char_count: novelLength || 0 }]
              : branches
            ).map((b) => (
              <option key={b.id} value={b.id}>
                {b.id === "main" ? "主线" : b.name || b.id}
                {" · "}
                {charLabel(b)}字
              </option>
            ))}
            <option value="__free__">✦ 自由创作</option>
          </select>

          {hasSelection && (
            <span className="text-fog shrink-0 hidden sm:inline text-xs tabular-nums">
              {(fullBody.length || novelLength || 0).toLocaleString()} 字
              {bodyLoading ? " · 加载中" : ""}
            </span>
          )}

          <div className="flex items-center gap-1.5 min-w-0 ml-auto shrink">
            {!freeMode && hasSelection && (
              <button
                type="button"
                onClick={() => setTimelineOpen(true)}
                className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10"
                title="时间线"
                aria-label="打开时间线"
              >
                <ListTree className="w-4 h-4" />
              </button>
            )}
            {hasSelection && (
              <TextFindBar
                compact
                query={find.query}
                onQueryChange={find.setQuery}
                matchCount={find.matchCount}
                currentIndex={find.currentIndex}
                counterLabel={find.counterLabel}
                onPrev={find.goPrev}
                onNext={find.goNext}
                onClear={find.clearSearch}
                inputRef={find.searchInputRef}
              />
            )}
            {hasSelection && !freeMode && activeBranchId && (
              <button
                type="button"
                title="下载当前分支为 TXT"
                onClick={() =>
                  handleDownloadBranch(
                    activeBranchId,
                    activeBranchId === "main"
                      ? `${novelTitle || "主线"}_主线`
                      : (activeBranch?.name || activeBranchId),
                  )
                }
                className="text-sm text-muted-foreground hover:text-primary shrink-0 px-1.5 py-1 rounded-lg hover:bg-panel-elevated inline-flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">下载</span>
              </button>
            )}
          </div>
        </div>

        {!hasSelection ? (
          <div className="flex-1 flex items-center justify-center min-h-0">
            <div className="text-center px-6 max-w-sm">
              <GitBranch className="w-10 h-10 mx-auto mb-3 text-fog" />
              <p className="text-sm text-muted-foreground mb-1">请先选择写作分支</p>
              <p className="text-sm text-fog leading-relaxed mb-4">
                使用顶部下拉选择「主线」、分支或「自由创作」。
              </p>
              <select
                value=""
                onChange={(e) => onBranchSelectChange(e.target.value)}
                className="bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              >
                <option value="" disabled>
                  选择分支…
                </option>
                <option value="main">主线</option>
                {branches.filter((b) => b.id !== "main").map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name || b.id}
                  </option>
                ))}
                <option value="__free__">✦ 自由创作</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 relative">
            {bodyText || freeMode ? (
              <div className="flex-1 flex flex-col min-h-0">
                <VirtualNovelBody
                  text={bodyText}
                  scrollerRef={readerRef}
                  onBodyClick={handleEditorClick}
                  renderChunk={renderBodyChunk}
                />
                {proseHighlighted && (
                  <div className="reader-frame pb-8 shrink-0">
                    <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-4">
                      <div className="prose-novel text-primary/80 whitespace-pre-wrap">
                        {proseHighlighted}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : proseHighlighted ? (
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="reader-frame py-4">
                  <div className="surface-paper px-5 sm:px-8 lg:px-12 xl:px-16 py-8">
                    <div className="prose-novel text-primary/90 whitespace-pre-wrap">
                      {proseHighlighted}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-fog text-sm">
                <div className="text-center py-12">
                  <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  这个分支还没有内容。在助手面板里说&ldquo;从这里续写&rdquo;开始创作。
                </div>
              </div>
            )}
            {forkPoint && !freeMode && (
              <div className="shrink-0 px-4 py-2 flex items-center gap-2 text-xs text-primary border-t border-border/40">
                <span>{forkPoint.label}</span>
                <button
                  type="button"
                  onClick={() => {
                    setForkPoint(null);
                    setShowForkDialog(false);
                  }}
                  className="text-fog hover:text-muted-foreground"
                >
                  取消
                </button>
              </div>
            )}
            <ScrollEdgeButtons scrollRef={readerRef} />
          </div>
        )}
      </div>

      {/* Fork dialog */}
      {showForkDialog && forkPoint && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowForkDialog(false)}
        >
          <div className="w-full max-w-sm bg-card border border-border rounded-xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground mb-4">新建分支</h3>
            <div className="space-y-3">
              <div>
                <div className="text-sm text-muted-foreground mb-0.5">分叉点</div>
                <div className="text-sm text-muted-foreground">{forkPoint.label}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">上下文</div>
                <div className="bg-secondary/50 rounded-lg p-2 text-xs text-muted-foreground max-h-16 overflow-y-auto whitespace-pre-wrap">
                  ...{forkPoint.context.slice(0, 80)}...
                  <span className="text-primary font-bold mx-0.5">|</span>
                  {forkPoint.context.slice(80)}...
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">分支名称</div>
                <input
                  value={newBranchName}
                  onChange={e => setNewBranchName(e.target.value)}
                  placeholder="IF线名称"
                  onKeyDown={e => e.key === "Enter" && createBranch()}
                  className="w-full px-3 py-2.5 bg-secondary border border-border rounded-lg text-sm text-foreground outline-none focus:border-primary/50"
                  autoFocus
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowForkDialog(false); setForkPoint(null); }}
                  className="flex-1 py-2.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={createBranch}
                  disabled={!newBranchName.trim()}
                  className="flex-1 py-2.5 bg-primary hover:brightness-110 disabled:bg-secondary disabled:text-fog text-primary-foreground text-sm rounded-lg"
                >
                  创建分支
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
