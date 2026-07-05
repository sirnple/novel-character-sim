"use client";

import { useState } from "react";
import { ShieldCheck, ShieldAlert, AlertTriangle, AlertCircle, Info, ChevronDown, ChevronRight, Loader2 } from "lucide-react";

interface ReviewIssue {
  severity: "critical" | "major" | "minor";
  category: "continuity" | "character" | "literary";
  location: string;
  description: string;
  suggestion: string;
  snippet?: string;
}

interface ReviewResult {
  pass: boolean;
  issues: ReviewIssue[];
  summary: string;
}

interface FullReviewResult {
  continuity: ReviewResult;
  character: ReviewResult;
  literary: ReviewResult;
  allPassed: boolean;
  totalIssues: number;
}

interface ReviewPanelProps {
  draft: string;
  timelineEvents: string;
  characterStates: string;
  writingStyle: string;
  sceneDesc?: string;
  onRevised?: (text: string) => void;
}

const CATEGORY_LABELS: Record<string, { icon: typeof ShieldCheck; label: string }> = {
  continuity: { icon: ShieldCheck, label: "连贯性审查" },
  character: { icon: ShieldCheck, label: "角色一致性" },
  literary: { icon: ShieldCheck, label: "文学品质" },
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  major: "bg-orange-100 text-orange-800 border-orange-300",
  minor: "bg-gray-100 text-gray-600 border-gray-300",
};

const SEVERITY_ICONS: Record<string, typeof AlertTriangle> = {
  critical: AlertTriangle,
  major: AlertCircle,
  minor: Info,
};

export default function ReviewPanel({ draft, timelineEvents, characterStates, writingStyle, sceneDesc, onRevised }: ReviewPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<FullReviewResult | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    continuity: true,
    character: true,
    literary: true,
  });
  const [hasRun, setHasRun] = useState(false);
  const [revising, setRevising] = useState(false);
  const [revisedText, setRevisedText] = useState<string | null>(null);
  const [reviseError, setReviseError] = useState("");
  const [reviseStream, setReviseStream] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifiedIssues, setVerifiedIssues] = useState<Record<number, { valid: boolean; reason: string }> | null>(null);

  const runVerify = async () => {
    setVerifying(true);
    try {
      const allIssues = [
        ...result!.continuity.issues,
        ...result!.character.issues,
        ...result!.literary.issues,
      ];
      if (allIssues.length === 0) { setVerifiedIssues({}); return; }
      const res = await fetch("/api/review/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          issues: allIssues,
          timelineEvents,
          characterStates,
        }),
      });
      const data = await res.json();
      if (res.ok && data.verified) {
        const map: Record<number, { valid: boolean; reason: string }> = {};
        for (const v of data.verified) {
          map[v.issueIndex] = { valid: v.valid, reason: v.reason };
        }
        setVerifiedIssues(map);
      }
    } catch (e) {
      console.error("Verify failed:", e);
    } finally {
      setVerifying(false);
    }
  };



  const runReview = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, timelineEvents, characterStates, writingStyle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Review failed");
      setResult(data);
      setHasRun(true);
      // 自动运行验证
      runVerify();

  const runRevise = async () => {
    if (!result) return;
    setRevising(true);
    setReviseError("");
    setRevisedText(null);
    setReviseStream("");
    try {
      const rawIssues = [
        ...result.continuity.issues,
        ...result.character.issues,
        ...result.literary.issues,
      ];
      // 只使用验证过的有效问题（未验证时全部视为有效）
      const allIssues = verifiedIssues
        ? rawIssues.filter((_: any, idx: number) => verifiedIssues[idx]?.valid !== false)
        : rawIssues;
      const res = await fetch("/api/review/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          reviewIssues: allIssues,
          sceneDesc: sceneDesc || "",
          writingStyle,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Revision failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === "revise_progress") setReviseStream((s) => s + evt.chunk);
              else if (evt.type === "revised") { setRevisedText(evt.text); onRevised?.(evt.text); }
              else if (evt.type === "error") setReviseError(evt.message);
            } catch {}
          }
        }
      }
    } catch (e) {
      setReviseError(e instanceof Error ? e.message : "修改失败");
    } finally {
      setRevising(false);
    }
  };

    } catch (e) {
      setError(e instanceof Error ? e.message : "审查失败");
    } finally {
      setLoading(false);
    }
  }

  const runRevise = async () => {
    if (!result) return;
    setRevising(true);
    setReviseError("");
    setRevisedText(null);
    setReviseStream("");
    try {
      const allIssues = [
        ...result.continuity.issues,
        ...result.character.issues,
        ...result.literary.issues,
      ];
      const res = await fetch("/api/review/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          reviewIssues: allIssues,
          sceneDesc: sceneDesc || "",
          writingStyle,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Revision failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === "revise_progress") setReviseStream((s) => s + evt.chunk);
              else if (evt.type === "revised") { setRevisedText(evt.text); onRevised?.(evt.text); }
              else if (evt.type === "error") setReviseError(evt.message);
            } catch {}
          }
        }
      }
    } catch (e) {
      setReviseError(e instanceof Error ? e.message : "修改失败");
    } finally {
      setRevising(false);
    }
  };
;

  const toggleSection = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (!hasRun) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <p className="text-sm text-muted-foreground">对生成的小说进行三层审查</p>
        <button
          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          onClick={runReview}
          disabled={loading}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> 审查中...
            </span>
          ) : (
            "🔍 开始审查"
          )}
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        <span className="text-sm text-muted-foreground">正在审查...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-red-500">{error}</p>
        <button className="mt-2 px-4 py-1.5 border rounded-md text-sm hover:bg-secondary" onClick={runReview}>
          重试
        </button>
      </div>
    );
  }

  if (!result) return null;

  if (reviseError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-red-500">{reviseError}</p>
        <button className="px-4 py-1.5 border rounded-md text-sm hover:bg-secondary" onClick={runRevise}>重试</button>
      </div>
    );
  }

  if (revisedText) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200">
          <ShieldCheck className="w-5 h-5 text-green-600" />
          <span className="text-sm font-medium">已根据审查意见修改完成</span>
        </div>
        <div className="bg-card border rounded-lg p-4 max-h-96 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
          {revisedText}
        </div>
        <button
          className="px-4 py-1.5 text-xs border rounded-md hover:bg-secondary"
          onClick={() => { setRevisedText(null); setHasRun(false); }}
        >
          ← 重新审查
        </button>
      </div>
    );
  }

  const sections: { key: string; data: ReviewResult }[] = [
    { key: "continuity", data: result.continuity },
    { key: "character", data: result.character },
    { key: "literary", data: result.literary },
  ];

  return (
    <div className="space-y-4">
      {/* Overall status */}
      <div className={`flex items-center justify-between p-3 rounded-lg ${result.allPassed ? "bg-green-50 border border-green-200" : "bg-orange-50 border border-orange-200"}`}>
        <div className="flex items-center gap-2">
          {result.allPassed ? (
            <ShieldCheck className="w-5 h-5 text-green-600" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-orange-600" />
          )}
          <span className="text-sm font-medium">
            {result.allPassed ? "✅ 全部通过" : `⚠️ 共 ${result.totalIssues} 个问题`}
          </span>
        </div>
        {result.totalIssues > 0 && onRevised && (
          <button
            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
            onClick={runRevise}
            disabled={revising}
          >
            {revising ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> 修改中...</>
            ) : (
              "🔧 应用修改"
            )}
          </button>
        )}
      </div>

      {/* Verification status */}
      {verifying && (
        <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" /> 正在逐条验证审查意见...
        </div>
      )}
      {verifiedIssues && !verifying && (
        <div className="flex items-center gap-2 p-2 text-xs">
          {Object.values(verifiedIssues).filter(v => v.valid).length} 条有效 / {Object.keys(verifiedIssues).length} 条已验证
          {Object.values(verifiedIssues).some(v => !v.valid) && (
            <span className="text-muted-foreground">（已排除 {Object.values(verifiedIssues).filter(v => !v.valid).length} 条误判）</span>
          )}
        </div>
      )}

      {/* Per-category sections */}
      {sections.map(({ key, data }) => {
        const cat = CATEGORY_LABELS[key];
        const isOpen = expanded[key];
        return (
          <div key={key} className="border rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 bg-secondary/20 hover:bg-secondary/30 transition-colors"
              onClick={() => toggleSection(key)}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {data.pass ? (
                  <ShieldCheck className="w-4 h-4 text-green-500" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-orange-500" />
                )}
                {cat.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  data.pass ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                }`}>
                  {data.issues.length === 0 ? "通过" : `${data.issues.length} 个问题`}
                </span>
              </span>
              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {isOpen && (
              <div className="px-4 py-3 space-y-3">
                <p className="text-xs text-muted-foreground">{data.summary}</p>
                {data.issues.length === 0 ? (
                  <p className="text-xs text-green-600">无问题</p>
                ) : (
                  data.issues.map((issue, i) => {
                    const Icon = SEVERITY_ICONS[issue.severity] || Info;
                    return (
                      <div
                        key={i}
                        className={`border rounded-md p-3 text-sm ${SEVERITY_STYLES[issue.severity]}`}
                      >
                        <div className="flex items-start gap-2">
                          <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono bg-white/50 px-1.5 py-0.5 rounded">
                                {issue.severity.toUpperCase()}
                              </span>
                              <span className="text-xs text-muted-foreground">{issue.location}</span>
                              {verifying && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                              {verifiedIssues && verifiedIssues[i] !== undefined && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full ${verifiedIssues[i].valid ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500 line-through"}`} title={verifiedIssues[i].reason}>
                                  {verifiedIssues[i].valid ? "✓ 有效" : "✗ 无效"}
                                </span>
                              )}
                            </div>
                            <p className="font-medium">{issue.description}</p>
                            <p className="text-xs">{issue.suggestion}</p>
                            {issue.snippet && (
                              <p className="text-xs italic bg-white/50 p-2 rounded mt-1">
                                &ldquo;{issue.snippet}&rdquo;
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
