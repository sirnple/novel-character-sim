"use client";

/**
 * Character relationship map:
 * force-directed graph + type filter + fullscreen + manual edit → SQLite via /api/characters
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { CharacterProfile, Relationship } from "@/types";
import {
  GitBranch,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Users,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  Trash2,
  Save,
  X,
  Loader2,
} from "lucide-react";

/* ── relationship type palette ─────────────────────────────────────────── */

const REL_TYPES = [
  { value: "家人", color: "#f43f5e", label: "家人" },
  { value: "朋友", color: "#38bdf8", label: "朋友" },
  { value: "恋人", color: "#f472b6", label: "恋人" },
  { value: "敌人", color: "#ef4444", label: "敌人", dash: "6 4" },
  { value: "对手", color: "#fb923c", label: "对手", dash: "4 3" },
  { value: "同僚", color: "#a78bfa", label: "同僚" },
  { value: "师徒", color: "#2dd4bf", label: "师徒" },
  { value: "相识", color: "#94a3b8", label: "相识" },
  { value: "其他", color: "#a8a29e", label: "其他" },
] as const;

const REL_META: Record<string, { color: string; label: string; dash?: string }> = {
  family: { color: "#f43f5e", label: "家人" },
  家人: { color: "#f43f5e", label: "家人" },
  friend: { color: "#38bdf8", label: "朋友" },
  朋友: { color: "#38bdf8", label: "朋友" },
  lover: { color: "#f472b6", label: "恋人" },
  恋人: { color: "#f472b6", label: "恋人" },
  enemy: { color: "#ef4444", label: "敌人", dash: "6 4" },
  敌人: { color: "#ef4444", label: "敌人", dash: "6 4" },
  rival: { color: "#fb923c", label: "对手", dash: "4 3" },
  对手: { color: "#fb923c", label: "对手", dash: "4 3" },
  colleague: { color: "#a78bfa", label: "同僚" },
  同僚: { color: "#a78bfa", label: "同僚" },
  "mentor-student": { color: "#2dd4bf", label: "师徒" },
  师徒: { color: "#2dd4bf", label: "师徒" },
  acquaintance: { color: "#94a3b8", label: "相识" },
  相识: { color: "#94a3b8", label: "相识" },
  other: { color: "#a8a29e", label: "其他" },
  其他: { color: "#a8a29e", label: "其他" },
};

function relMeta(type: string) {
  return REL_META[type] || { color: "#a8a29e", label: type || "关系" };
}

function normalizeType(type: string): string {
  const m = relMeta(type);
  return m.label || type || "其他";
}

/* ── layout helpers ────────────────────────────────────────────────────── */

interface SimNode {
  id: string;
  name: string;
  char: CharacterProfile;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

interface SimEdge {
  source: string;
  target: string;
  type: string;
  label: string;
  color: string;
  dash?: string;
  description: string;
  history: string;
  dynamics: string;
  fromName: string;
  toName: string;
  /** owner character id that holds the Relationship row we edit */
  ownerId: string;
  relIndex: number;
}

function charKey(c: CharacterProfile) {
  return c.id || c.name;
}

function resolveTarget(
  rel: Relationship,
  byId: Map<string, CharacterProfile>,
  byName: Map<string, CharacterProfile>,
): CharacterProfile | undefined {
  return (
    byId.get(rel.characterId) ||
    byName.get(rel.characterName) ||
    byName.get(rel.characterId) ||
    byId.get(rel.characterName)
  );
}

function buildGraph(characters: CharacterProfile[]): {
  nodes: SimNode[];
  edges: SimEdge[];
} {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const byName = new Map(characters.map((c) => [c.name, c]));
  const degree = new Map<string, number>();
  characters.forEach((c) => degree.set(charKey(c), 0));

  const edgeMap = new Map<string, SimEdge>();
  for (const c of characters) {
    const rels = c.relationships || [];
    rels.forEach((rel, relIndex) => {
      const other = resolveTarget(rel, byId, byName);
      if (!other || charKey(other) === charKey(c)) return;
      const a = charKey(c);
      const b = charKey(other);
      const pair = [a, b].sort().join("\0");
      if (edgeMap.has(pair)) return;
      const meta = relMeta(rel.type);
      edgeMap.set(pair, {
        source: a,
        target: b,
        type: rel.type,
        label: meta.label,
        color: meta.color,
        dash: meta.dash,
        description: rel.description || "",
        history: rel.history || "",
        dynamics: rel.dynamics || "",
        fromName: c.name,
        toName: other.name,
        ownerId: a,
        relIndex,
      });
      degree.set(a, (degree.get(a) || 0) + 1);
      degree.set(b, (degree.get(b) || 0) + 1);
    });
  }

  const n = characters.length;
  const nodes: SimNode[] = characters.map((c, i) => {
    const angle = (2 * Math.PI * i) / Math.max(n, 1) - Math.PI / 2;
    const r = 40 + Math.min(n, 12) * 14;
    return {
      id: charKey(c),
      name: c.name,
      char: c,
      x: Math.cos(angle) * r + (Math.random() - 0.5) * 20,
      y: Math.sin(angle) * r + (Math.random() - 0.5) * 20,
      vx: 0,
      vy: 0,
      degree: degree.get(charKey(c)) || 0,
    };
  });

  return { nodes, edges: Array.from(edgeMap.values()) };
}

function runForce(
  nodes: SimNode[],
  edges: SimEdge[],
  width: number,
  height: number,
  ticks = 180,
) {
  const cx = width / 2;
  const cy = height / 2;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const n = nodes.length;
  if (n === 0) return;
  if (n === 1) {
    nodes[0].x = cx;
    nodes[0].y = cy;
    return;
  }

  const idealLen = Math.max(
    90,
    Math.min(160, Math.min(width, height) / (1.2 + Math.sqrt(n))),
  );
  const charge = 2800 + n * 120;

  for (let t = 0; t < ticks; t++) {
    const alpha = 1 - t / ticks;
    const cool = 0.08 * alpha + 0.01;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist2 = dx * dx + dy * dy || 1;
        const dist = Math.sqrt(dist2);
        const force = (charge * alpha) / dist2;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (const e of edges) {
      const a = nodeMap.get(e.source);
      const b = nodeMap.get(e.target);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const diff = dist - idealLen;
      const force = diff * 0.06 * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const node of nodes) {
      node.vx += (cx - node.x) * 0.012 * alpha;
      node.vy += (cy - node.y) * 0.012 * alpha;
      node.vx *= 0.85;
      node.vy *= 0.85;
      node.x += node.vx * cool * 12;
      node.y += node.vy * cool * 12;
    }
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }
  const pad = 56;
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  const scale = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh, 1.4);
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  for (const node of nodes) {
    node.x = cx + (node.x - mx) * scale;
    node.y = cy + (node.y - my) * scale;
  }
}

function nodeRadius(degree: number, maxDegree: number) {
  const t = maxDegree > 0 ? degree / maxDegree : 0;
  return 18 + t * 10;
}

function initialHue(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function cloneChars(list: CharacterProfile[]): CharacterProfile[] {
  return JSON.parse(JSON.stringify(list)) as CharacterProfile[];
}

/** Remove all links between two character keys from both sides. */
function stripPairRels(
  chars: CharacterProfile[],
  idA: string,
  idB: string,
): CharacterProfile[] {
  const names = new Map(chars.map((c) => [charKey(c), c.name]));
  const nameA = names.get(idA);
  const nameB = names.get(idB);
  return chars.map((c) => {
    const k = charKey(c);
    if (k !== idA && k !== idB) return c;
    const otherId = k === idA ? idB : idA;
    const otherName = k === idA ? nameB : nameA;
    return {
      ...c,
      relationships: (c.relationships || []).filter((r) => {
        const tid = r.characterId || r.characterName;
        return tid !== otherId && r.characterName !== otherName && r.characterId !== otherName;
      }),
    };
  });
}

function upsertPairRel(
  chars: CharacterProfile[],
  fromId: string,
  toId: string,
  type: string,
  description: string,
  history: string,
  dynamics: string,
  mirror = true,
): CharacterProfile[] {
  let next = stripPairRels(chars, fromId, toId);
  const byKey = new Map(next.map((c) => [charKey(c), c]));
  const from = byKey.get(fromId);
  const to = byKey.get(toId);
  if (!from || !to) return chars;

  const rel: Relationship = {
    characterId: to.id || toId,
    characterName: to.name,
    type: normalizeType(type),
    description: description || "",
    history: history || "",
    dynamics: dynamics || "",
  };
  next = next.map((c) => {
    if (charKey(c) !== fromId) return c;
    return { ...c, relationships: [...(c.relationships || []), rel] };
  });

  if (mirror) {
    const back: Relationship = {
      characterId: from.id || fromId,
      characterName: from.name,
      type: normalizeType(type),
      description: description || "",
      history: history || "",
      dynamics: dynamics || "",
    };
    next = next.map((c) => {
      if (charKey(c) !== toId) return c;
      return { ...c, relationships: [...(c.relationships || []), back] };
    });
  }
  return next;
}

/* ── component ─────────────────────────────────────────────────────────── */

export interface RelationshipGraphProps {
  characters: CharacterProfile[];
  novelId?: string;
  height?: number;
  className?: string;
  /** Called after successful DB save */
  onCharactersChange?: (characters: CharacterProfile[]) => void;
  /** Hide edit/save; no mutations (e.g. public share page) */
  readOnly?: boolean;
}

interface DraftRel {
  fromId: string;
  toId: string;
  type: string;
  description: string;
  history: string;
  dynamics: string;
  /** existing edge key when editing */
  edgeKey?: string;
}

export default function RelationshipGraph({
  characters: charactersProp,
  novelId,
  height = 420,
  className = "",
  onCharactersChange,
  readOnly = false,
}: RelationshipGraphProps) {
  const [localChars, setLocalChars] = useState<CharacterProfile[]>(() =>
    cloneChars(charactersProp),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null); // null = all
  const [draft, setDraft] = useState<DraftRel | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: height });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const dragRef = useRef<{ mode: "pan" | null; lastX: number; lastY: number }>({
    mode: null,
    lastX: 0,
    lastY: 0,
  });

  // Sync from parent when not dirty
  useEffect(() => {
    if (dirty) return;
    setLocalChars(cloneChars(charactersProp));
  }, [charactersProp, dirty]);

  // Never enter edit mode on public share surfaces
  useEffect(() => {
    if (!readOnly) return;
    setEditing(false);
    setDraft(null);
    setDirty(false);
  }, [readOnly]);

  const { nodes: seedNodes, edges: allEdges } = useMemo(
    () => buildGraph(localChars),
    [localChars],
  );

  const edgeMatchesFilter = useCallback(
    (e: SimEdge) =>
      !typeFilter ||
      e.label === typeFilter ||
      normalizeType(e.type) === typeFilter,
    [typeFilter],
  );

  const matchedEdges = useMemo(
    () => allEdges.filter(edgeMatchesFilter),
    [allEdges, edgeMatchesFilter],
  );

  const filterTypes = useMemo(() => {
    const seen = new Map<string, { color: string; label: string; count: number }>();
    for (const e of allEdges) {
      const label = e.label || normalizeType(e.type);
      const prev = seen.get(label);
      if (prev) prev.count++;
      else seen.set(label, { color: e.color, label, count: 1 });
    }
    return Array.from(seen.values()).sort((a, b) => b.count - a.count);
  }, [allEdges]);

  // Layout uses full graph; filter only changes emphasis (dim), not topology
  const layoutKey = useMemo(
    () =>
      localChars.map((c) => charKey(c)).join("|") +
      ":" +
      allEdges.map((e) => e.source + e.target + e.type).join(",") +
      ":" +
      (fullscreen ? "fs" : "in"),
    [localChars, allEdges, fullscreen],
  );

  const [nodes, setNodes] = useState<SimNode[]>([]);
  const graphH = fullscreen ? Math.max(480, (typeof window !== "undefined" ? window.innerHeight : 800) - 200) : height;

  // Measure canvas; retry a few frames if width not ready yet
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf = 0;
    let tries = 0;
    const apply = () => {
      const rawW = el.clientWidth;
      const w = rawW >= 40 ? rawW : 640;
      const h = fullscreen
        ? Math.max(el.clientHeight, 360)
        : Math.max(height, 360);
      setSize((prev) =>
        prev.w === w && prev.h === h ? prev : { w, h },
      );
      if (rawW < 40 && tries < 8) {
        tries += 1;
        raf = requestAnimationFrame(apply);
      }
    };
    apply();
    const ro = new ResizeObserver(() => {
      tries = 0;
      apply();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [height, fullscreen, graphH, editing, draft]);

  useEffect(() => {
    if (seedNodes.length === 0 || size.w < 40 || size.h < 40) {
      setNodes([]);
      return;
    }
    const copy: SimNode[] = seedNodes.map((n) => ({ ...n }));
    runForce(copy, allEdges, size.w, size.h);
    setNodes(copy);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, size.w, size.h]);

  const maxDegree = useMemo(
    () => Math.max(0, ...nodes.map((n) => n.degree)),
    [nodes],
  );

  const nodesInFilter = useMemo(() => {
    if (!typeFilter) return null;
    const s = new Set<string>();
    for (const e of matchedEdges) {
      s.add(e.source);
      s.add(e.target);
    }
    return s;
  }, [typeFilter, matchedEdges]);

  const selected = nodes.find((n) => n.id === selectedId) || null;
  const selectedEdges = useMemo(() => {
    if (!selected) return [];
    // Prefer matching type first, then others (for side panel)
    const linked = allEdges.filter(
      (e) => e.source === selected.id || e.target === selected.id,
    );
    if (!typeFilter) return linked;
    return [
      ...linked.filter(edgeMatchesFilter),
      ...linked.filter((e) => !edgeMatchesFilter(e)),
    ];
  }, [selected, allEdges, typeFilter, edgeMatchesFilter]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (draft) setDraft(null);
        else setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen, draft]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-node],[data-ui]")) return;
    dragRef.current = { mode: "pan", lastX: e.clientX, lastY: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragRef.current.mode !== "pan") return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  };
  const onPointerUp = () => {
    dragRef.current.mode = null;
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.35, Math.min(2.5, z * delta)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fullscreen]);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedId(null);
  };

  const openEditEdge = (e: SimEdge) => {
    setEditing(true);
    setDraft({
      fromId: e.ownerId || e.source,
      toId: e.ownerId === e.source ? e.target : e.source,
      type: normalizeType(e.type),
      description: e.description,
      history: e.history,
      dynamics: e.dynamics,
      edgeKey: `${e.source}-${e.target}`,
    });
  };

  const openNewRel = () => {
    const a = localChars[0] ? charKey(localChars[0]) : "";
    const b = localChars[1] ? charKey(localChars[1]) : "";
    setEditing(true);
    setDraft({
      fromId: a,
      toId: b,
      type: "朋友",
      description: "",
      history: "",
      dynamics: "",
    });
  };

  const applyDraft = () => {
    if (!draft || !draft.fromId || !draft.toId || draft.fromId === draft.toId) return;
    setLocalChars((prev) =>
      upsertPairRel(
        prev,
        draft.fromId,
        draft.toId,
        draft.type,
        draft.description,
        draft.history,
        draft.dynamics,
        true,
      ),
    );
    setDirty(true);
    setDraft(null);
    setSaveMsg("");
  };

  const deleteEdge = (e: SimEdge) => {
    setLocalChars((prev) => stripPairRels(prev, e.source, e.target));
    setDirty(true);
    setDraft(null);
    setSaveMsg("");
  };

  const saveToDb = useCallback(async () => {
    if (!novelId) {
      setSaveMsg("缺少 novelId，无法写入数据库");
      return;
    }
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("/api/characters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novelId, characters: localChars }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      const saved = (data.characters || localChars) as CharacterProfile[];
      setLocalChars(cloneChars(saved));
      setDirty(false);
      setSaveMsg("已保存到数据库");
      onCharactersChange?.(saved);
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [novelId, localChars, onCharactersChange]);

  const discardLocal = () => {
    setLocalChars(cloneChars(charactersProp));
    setDirty(false);
    setDraft(null);
    setSaveMsg("");
  };

  if (charactersProp.length === 0 && localChars.length === 0) return null;

  const edgeKey = (e: SimEdge) => `${e.source}-${e.target}`;

  const toolbar = (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="ov-section-label">
        <span className="w-8 h-8 rounded-lg bg-ember-soft flex items-center justify-center">
          <GitBranch className="w-4 h-4 text-primary" />
        </span>
        角色关系网
        <span className="text-xs text-fog font-normal">
          {localChars.length} 人
          {allEdges.length > 0 ? ` · ${allEdges.length} 条` : ""}
          {typeFilter
            ? ` · 高亮「${typeFilter}」${matchedEdges.length} 条`
            : ""}
          {dirty ? " · 未保存" : ""}
        </span>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {!readOnly && editing && (
          <button
            type="button"
            data-ui
            onClick={openNewRel}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-secondary border border-border/50 text-foreground hover:bg-panel-elevated"
          >
            <Plus className="w-3.5 h-3.5" />
            添加关系
          </button>
        )}
        {!readOnly && (
          <button
            type="button"
            data-ui
            onClick={() => {
              setEditing((v) => !v);
              if (editing) setDraft(null);
            }}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
              editing
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-secondary border-border/50 text-muted-foreground hover:text-foreground"
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            {editing ? "编辑中" : "编辑"}
          </button>
        )}
        {!readOnly && dirty && (
          <>
            <button
              type="button"
              data-ui
              onClick={discardLocal}
              className="text-xs px-2.5 py-1.5 rounded-lg text-fog hover:text-foreground"
            >
              放弃
            </button>
            <button
              type="button"
              data-ui
              disabled={saving || !novelId}
              onClick={saveToDb}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              保存
            </button>
          </>
        )}
        <div className="flex items-center gap-0.5 rounded-xl bg-secondary/60 border border-border/40 p-0.5">
          <button
            type="button"
            data-ui
            className="p-2 hover:bg-panel-elevated rounded-lg text-muted-foreground hover:text-foreground"
            onClick={() => setZoom((z) => Math.min(2.5, z * 1.15))}
            aria-label="放大"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-ui
            className="p-2 hover:bg-panel-elevated rounded-lg text-muted-foreground hover:text-foreground"
            onClick={() => setZoom((z) => Math.max(0.35, z * 0.87))}
            aria-label="缩小"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-ui
            className="p-2 hover:bg-panel-elevated rounded-lg text-muted-foreground hover:text-foreground"
            onClick={resetView}
            aria-label="重置"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-ui
            className="p-2 hover:bg-panel-elevated rounded-lg text-muted-foreground hover:text-foreground"
            onClick={() => setFullscreen((f) => !f)}
            aria-label={fullscreen ? "退出全屏" : "全屏"}
          >
            {fullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );

  const filterBar = (
    <div className="flex flex-wrap gap-1.5" data-ui>
      <button
        type="button"
        onClick={() => setTypeFilter(null)}
        className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
          !typeFilter
            ? "bg-primary/15 border-primary/40 text-primary"
            : "bg-secondary/50 border-border/40 text-muted-foreground hover:text-foreground"
        }`}
      >
        全部 {allEdges.length}
      </button>
      {filterTypes.map((t) => (
        <button
          key={t.label}
          type="button"
          onClick={() =>
            setTypeFilter((cur) => (cur === t.label ? null : t.label))
          }
          className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
            typeFilter === t.label
              ? "bg-primary/15 border-primary/40 text-primary"
              : "bg-secondary/50 border-border/40 text-muted-foreground hover:text-foreground"
          }`}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: t.color }}
          />
          {t.label}
          <span className="opacity-60">{t.count}</span>
        </button>
      ))}
      {filterTypes.length === 0 && (
        <span className="text-[11px] text-fog py-1">暂无关系类型</span>
      )}
    </div>
  );

  const graphCanvas = (
    <div
      ref={wrapRef}
      className={
        fullscreen
          ? "relative rounded-2xl overflow-hidden border border-border/50 select-none flex-1 min-h-[360px] w-full"
          : "relative rounded-2xl overflow-hidden border border-border/50 select-none w-full shrink-0"
      }
      style={{
        // Inline mode: fixed height (do NOT use flex-1 — parent is auto-height and flex-1 collapses to 0)
        height: fullscreen ? undefined : `${Math.max(height, 360)}px`,
        minHeight: fullscreen ? 360 : Math.max(height, 360),
        background:
          "radial-gradient(ellipse 80% 70% at 50% 45%, hsl(24 14% 13%) 0%, hsl(24 12% 8%) 100%)",
        boxShadow: "inset 0 1px 0 hsl(var(--border) / 0.35)",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {allEdges.length === 0 && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 px-6 text-center pointer-events-none">
          <Users className="w-8 h-8 text-fog/60" />
          <p className="text-sm text-fog">角色之间尚未解析出互链关系</p>
          <p className="text-xs text-fog/70 max-w-xs pointer-events-auto">
            {editing
              ? "可点「添加关系」手工录入，保存后写入数据库。"
              : "可开启编辑添加，或强制重跑角色分析。"}
          </p>
        </div>
      )}
      {allEdges.length > 0 && typeFilter && matchedEdges.length === 0 && (
        <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 pointer-events-none">
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-card/90 border border-border/50 text-fog shadow">
            无「{typeFilter}」关系 · 其余已置灰
          </span>
        </div>
      )}

      <svg
        width={Math.max(size.w, 1)}
        height={Math.max(size.h, 1)}
        className="block w-full h-full touch-none cursor-grab active:cursor-grabbing"
        style={{ minHeight: fullscreen ? undefined : Math.max(height, 360) }}
      >
        <g
          transform={`translate(${pan.x + size.w / 2},${pan.y + size.h / 2}) scale(${zoom}) translate(${-size.w / 2},${-size.h / 2})`}
        >
          {allEdges.map((e) => {
            const a = nodes.find((n) => n.id === e.source);
            const b = nodes.find((n) => n.id === e.target);
            if (!a || !b) return null;
            const typeDim = typeFilter ? !edgeMatchesFilter(e) : false;
            const selDim =
              !!selectedId &&
              e.source !== selectedId &&
              e.target !== selectedId;
            const dim = typeDim || selDim;
            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const ox = (-dy / len) * 18;
            const oy = (dx / len) * 18;
            const cpx = midX + ox;
            const cpy = midY + oy;
            const k = edgeKey(e);
            const stroke = dim ? "#6b6560" : e.color;
            const labelColor = dim ? "#8a847c" : e.color;

            return (
              <g
                key={k}
                opacity={dim ? 0.22 : 1}
                onMouseEnter={() => setHoverEdge(k)}
                onMouseLeave={() => setHoverEdge(null)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (editing) openEditEdge(e);
                }}
                className={editing ? "cursor-pointer" : "cursor-default"}
              >
                <path
                  d={`M ${a.x} ${a.y} Q ${cpx} ${cpy} ${b.x} ${b.y}`}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={
                    !dim && hoverEdge === k ? 2.5 : dim ? 1.25 : 1.75
                  }
                  strokeDasharray={e.dash}
                  strokeOpacity={dim ? 0.55 : 0.9}
                />
                <path
                  d={`M ${a.x} ${a.y} Q ${cpx} ${cpy} ${b.x} ${b.y}`}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                />
                <g transform={`translate(${cpx}, ${cpy})`}>
                  <rect
                    x={-18}
                    y={-9}
                    width={36}
                    height={16}
                    rx={8}
                    fill="hsl(24 12% 11%)"
                    stroke={labelColor}
                    strokeOpacity={dim ? 0.25 : 0.45}
                    strokeWidth={1}
                  />
                  <text
                    textAnchor="middle"
                    y={3}
                    fill={labelColor}
                    fontSize={9}
                    fontWeight={600}
                    style={{ pointerEvents: "none" }}
                  >
                    {e.label.length > 3 ? e.label.slice(0, 3) : e.label}
                  </text>
                </g>
              </g>
            );
          })}

          {nodes.map((n) => {
            const r = nodeRadius(n.degree, maxDegree);
            const hue = initialHue(n.name);
            const isSel = selectedId === n.id;
            const typeDim =
              !!nodesInFilter && !nodesInFilter.has(n.id);
            const selDim =
              !!selectedId &&
              selectedId !== n.id &&
              !allEdges.some(
                (e) =>
                  (e.source === selectedId && e.target === n.id) ||
                  (e.target === selectedId && e.source === n.id),
              );
            const dim = typeDim || selDim;
            const initial = n.name.trim().charAt(0) || "?";
            const label =
              n.name.length > 6 ? n.name.slice(0, 6) + "…" : n.name;
            const tw = Math.min(80, 14 + label.length * 11);

            return (
              <g
                key={n.id}
                data-node
                transform={`translate(${n.x},${n.y})`}
                opacity={dim ? 0.22 : 1}
                className="cursor-pointer"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setSelectedId((id) => (id === n.id ? null : n.id));
                }}
              >
                <circle
                  r={r + 8}
                  fill={
                    dim
                      ? "hsla(30, 8%, 40%, 0.1)"
                      : `hsla(${hue}, 55%, 48%, ${isSel ? 0.28 : 0.12})`
                  }
                />
                <circle
                  r={r}
                  fill={dim ? "hsl(30, 8%, 32%)" : `hsl(${hue}, 42%, 38%)`}
                  stroke={
                    isSel
                      ? "hsl(var(--primary))"
                      : dim
                        ? "hsla(40, 10%, 60%, 0.2)"
                        : "hsla(40, 30%, 90%, 0.35)"
                  }
                  strokeWidth={isSel ? 2.5 : 1.25}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={dim ? "#9a948c" : "#faf6f1"}
                  fontSize={r > 22 ? 15 : 13}
                  fontWeight={700}
                  style={{ pointerEvents: "none" }}
                >
                  {initial}
                </text>
                <g transform={`translate(0, ${r + 14})`}>
                  <rect
                    x={-tw / 2}
                    y={-9}
                    width={tw}
                    height={18}
                    rx={6}
                    fill="hsla(24, 12%, 10%, 0.92)"
                    stroke={
                      isSel
                        ? "hsl(var(--primary) / 0.5)"
                        : "hsla(40, 20%, 80%, 0.12)"
                    }
                    strokeWidth={1}
                  />
                  <text
                    textAnchor="middle"
                    y={4}
                    fill={dim ? "hsla(40, 10%, 65%, 0.75)" : "hsla(40, 25%, 90%, 0.95)"}
                    fontSize={11}
                    fontWeight={600}
                    style={{ pointerEvents: "none" }}
                  >
                    {label}
                  </text>
                </g>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Selected detail */}
      {selected && !draft && (
        <div
          data-ui
          className="absolute right-3 top-3 bottom-3 z-10 w-[min(100%-1.5rem,16rem)] pointer-events-auto"
        >
          <div className="h-full rounded-xl border border-border/60 bg-card/95 backdrop-blur-md shadow-xl flex flex-col overflow-hidden">
            <div className="px-3.5 py-3 border-b border-border/50 shrink-0">
              <p className="text-[10px] uppercase tracking-wider text-fog mb-0.5">
                选中角色
              </p>
              <h3 className="text-sm font-semibold text-foreground truncate">
                {selected.name}
              </h3>
              <p className="text-[11px] text-fog mt-0.5">
                {typeFilter
                  ? `高亮 ${selectedEdges.filter(edgeMatchesFilter).length} / 共 ${selectedEdges.length} 条`
                  : `${selectedEdges.length} 条关系`}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 space-y-2 min-h-0">
              {selectedEdges.length === 0 ? (
                <p className="text-xs text-fog py-2">暂无连边</p>
              ) : (
                selectedEdges.map((e) => {
                  const other =
                    e.source === selected.id ? e.toName : e.fromName;
                  const muted = typeFilter ? !edgeMatchesFilter(e) : false;
                  return (
                    <div
                      key={edgeKey(e)}
                      className={`rounded-lg border px-2.5 py-2 ${
                        muted
                          ? "bg-secondary/20 border-border/30 opacity-50"
                          : "bg-secondary/40 border-border/40"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={{
                            color: muted ? "#8a847c" : e.color,
                            background: muted ? "#6b656022" : `${e.color}22`,
                          }}
                        >
                          {e.label}
                        </span>
                        <span
                          className={`text-xs font-medium truncate ${
                            muted ? "text-fog" : "text-foreground"
                          }`}
                        >
                          → {other}
                        </span>
                      </div>
                      {e.description && (
                        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">
                          {e.description}
                        </p>
                      )}
                      {editing && (
                        <div className="flex gap-2 mt-2">
                          <button
                            type="button"
                            className="text-[11px] text-primary hover:underline"
                            onClick={() => openEditEdge(e)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="text-[11px] text-red-400 hover:underline"
                            onClick={() => deleteEdge(e)}
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-fog hover:text-foreground py-2 border-t border-border/40"
              onClick={() => setSelectedId(null)}
            >
              取消选中
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const draftPanel = draft && (
    <div
      data-ui
      className="rounded-xl border border-border/60 bg-card p-4 space-y-3 shadow-lg"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {draft.edgeKey ? "编辑关系" : "添加关系"}
        </h3>
        <button
          type="button"
          className="p-1.5 rounded-lg text-fog hover:text-foreground hover:bg-secondary"
          onClick={() => setDraft(null)}
          aria-label="关闭"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-muted-foreground space-y-1">
          <span>从（视角）</span>
          <select
            className="w-full rounded-lg bg-secondary border border-border/50 px-2.5 py-2 text-sm text-foreground"
            value={draft.fromId}
            onChange={(e) =>
              setDraft((d) => d && { ...d, fromId: e.target.value })
            }
          >
            {localChars.map((c) => (
              <option key={charKey(c)} value={charKey(c)}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground space-y-1">
          <span>到</span>
          <select
            className="w-full rounded-lg bg-secondary border border-border/50 px-2.5 py-2 text-sm text-foreground"
            value={draft.toId}
            onChange={(e) =>
              setDraft((d) => d && { ...d, toId: e.target.value })
            }
          >
            {localChars.map((c) => (
              <option key={charKey(c)} value={charKey(c)}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground space-y-1 sm:col-span-2">
          <span>关系类型</span>
          <select
            className="w-full rounded-lg bg-secondary border border-border/50 px-2.5 py-2 text-sm text-foreground"
            value={draft.type}
            onChange={(e) =>
              setDraft((d) => d && { ...d, type: e.target.value })
            }
          >
            {REL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground space-y-1 sm:col-span-2">
          <span>描述</span>
          <textarea
            className="w-full rounded-lg bg-secondary border border-border/50 px-2.5 py-2 text-sm text-foreground min-h-[64px] resize-y"
            value={draft.description}
            onChange={(e) =>
              setDraft((d) => d && { ...d, description: e.target.value })
            }
            placeholder="从本角色视角看的关系"
          />
        </label>
        <label className="text-xs text-muted-foreground space-y-1">
          <span>认识 / 历史</span>
          <input
            className="w-full rounded-lg bg-secondary border border-border/50 px-2.5 py-2 text-sm text-foreground"
            value={draft.history}
            onChange={(e) =>
              setDraft((d) => d && { ...d, history: e.target.value })
            }
          />
        </label>
        <label className="text-xs text-muted-foreground space-y-1">
          <span>权力动态</span>
          <input
            className="w-full rounded-lg bg-secondary border border-border/50 px-2.5 py-2 text-sm text-foreground"
            value={draft.dynamics}
            onChange={(e) =>
              setDraft((d) => d && { ...d, dynamics: e.target.value })
            }
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2 justify-end">
        {draft.edgeKey && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10"
            onClick={() => {
              const e = allEdges.find(
                (x) => edgeKey(x) === draft.edgeKey,
              );
              if (e) deleteEdge(e);
              else setDraft(null);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            删除
          </button>
        )}
        <button
          type="button"
          className="text-xs px-3 py-2 rounded-lg text-fog hover:text-foreground"
          onClick={() => setDraft(null)}
        >
          取消
        </button>
        <button
          type="button"
          className="btn-primary text-xs px-4 py-2"
          onClick={applyDraft}
          disabled={!draft.fromId || !draft.toId || draft.fromId === draft.toId}
        >
          应用
        </button>
      </div>
    </div>
  );

  const body = (
    <div
      className={
        fullscreen
          ? "flex flex-col gap-3 h-full min-h-0"
          : "flex flex-col gap-3 w-full"
      }
    >
      <div className="shrink-0 space-y-3">
        {toolbar}
        {filterBar}
        {saveMsg && (
          <p
            className={`text-xs ${saveMsg.includes("已保存") ? "text-primary" : "text-red-400"}`}
          >
            {saveMsg}
          </p>
        )}
        {draftPanel}
      </div>
      {graphCanvas}
      {!fullscreen && (
        <p className="text-[11px] text-fog px-0.5 shrink-0">
          筛选关系类型 · 全屏浏览 · 编辑后点保存写入数据库
          {editing ? " · 点击连线可编辑" : ""}
        </p>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <>
        {/* Keep card height so overview layout does not collapse */}
        <div
          className={`rounded-2xl border border-dashed border-border/40 flex items-center justify-center text-sm text-fog ${className}`}
          style={{ height: `${height}px` }}
        >
          关系网全屏中…
        </div>
        <div className="fixed inset-0 z-[60] bg-background flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
            <span className="text-sm font-semibold text-foreground">关系网 · 全屏</span>
            <button
              type="button"
              data-ui
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-secondary border border-border/50 hover:bg-panel-elevated"
              onClick={() => setFullscreen(false)}
            >
              <Minimize2 className="w-4 h-4" />
              退出全屏
            </button>
          </div>
          <div className="flex-1 min-h-0 p-4 overflow-hidden flex flex-col">{body}</div>
        </div>
      </>
    );
  }

  return <div className={`space-y-3 ${className}`}>{body}</div>;
}
