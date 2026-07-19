"use client";

/**
 * Character relationship map:
 * force-directed graph + type filter + fullscreen + manual edit → SQLite via /api/characters
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type {
  CharacterProfile,
  Relationship,
  RelationshipSymmetry,
} from "@/types";
import {
  RELATIONSHIP_TYPE_DEFS,
  relationshipTypeMeta,
  relationshipTypeZh,
} from "@/core/extractor/relationship-types";
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

/* ── relationship type palette (shared with extractor catalog) ─────────── */

const REL_TYPES = RELATIONSHIP_TYPE_DEFS.map((d) => ({
  value: d.zh,
  color: d.color,
  label: d.zh,
  dash: d.dash,
}));

function relMeta(type: string) {
  return relationshipTypeMeta(type);
}

function normalizeType(type: string): string {
  return relationshipTypeZh(type);
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
  /**
   * Final symmetry used for rendering (after dyad resolve).
   * RelationshipSymmetry: unidirectional | bidirectional | asymmetric
   */
  symmetry: RelationshipSymmetry;
  /**
   * Symmetry as declared on the stored relationship row (null if legacy / missing).
   * Used only while collapsing dyads.
   */
  declaredSymmetry?: RelationshipSymmetry | null;
  reverseType?: string;
  /** reverse-direction display label when asymmetric */
  reverseLabel?: string;
  valence?: string;
  visibility?: string;
  description: string;
  history: string;
  dynamics: string;
  fromName: string;
  toName: string;
  /** owner character id that holds the Relationship row we edit */
  ownerId: string;
  relIndex: number;
  /** true when A→B and B→A were merged into one visual dyad */
  paired?: boolean;
}

function charKey(c: CharacterProfile) {
  return c.id || c.name;
}

function nameKey(s: string) {
  return String(s || "").replace(/\s+/g, "").trim();
}

function resolveTarget(
  rel: Relationship,
  byId: Map<string, CharacterProfile>,
  byName: Map<string, CharacterProfile>,
  byNameKey: Map<string, CharacterProfile>,
): CharacterProfile | undefined {
  if (rel.characterId && byId.has(rel.characterId)) return byId.get(rel.characterId);
  if (rel.characterName && byName.has(rel.characterName))
    return byName.get(rel.characterName);
  const nk = nameKey(rel.characterName || rel.characterId || "");
  if (nk && byNameKey.has(nk)) return byNameKey.get(nk);
  if (rel.characterId && byName.has(rel.characterId))
    return byName.get(rel.characterId);
  if (rel.characterName && byId.has(rel.characterName))
    return byId.get(rel.characterName);
  return undefined;
}

function typeId(raw: string) {
  return normalizeType(raw);
}

/** Parse stored symmetry; returns null if missing / unknown (legacy rows). */
function parseSymmetry(raw: unknown): RelationshipSymmetry | null {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (
    s === "unidirectional" ||
    s === "单向" ||
    s === "one-way" ||
    s === "oneway"
  ) {
    return "unidirectional";
  }
  if (s === "asymmetric" || s === "不对称" || s === "非对称") {
    return "asymmetric";
  }
  if (
    s === "bidirectional" ||
    s === "双向" ||
    s === "mutual" ||
    s === "对称"
  ) {
    return "bidirectional";
  }
  return null;
}

/**
 * Resolve dyad symmetry for **rendering** (not social type like 家人/敌人).
 *
 * Model (see RelationshipSymmetry):
 * - unidirectional: only from→to is evidenced
 * - bidirectional: mutual same-kind bond
 * - asymmetric: both directions matter with different types (type + reverseType)
 *
 * Legacy rows often omit `symmetry` and mirror both sides — infer from topology.
 */
function resolveDyadSymmetry(
  forward: SimEdge,
  reverse: SimEdge | undefined,
): RelationshipSymmetry {
  const sF =
    forward.declaredSymmetry !== undefined
      ? forward.declaredSymmetry
      : parseSymmetry(forward.symmetry);
  const sR = reverse
    ? reverse.declaredSymmetry !== undefined
      ? reverse.declaredSymmetry
      : parseSymmetry(reverse.symmetry)
    : null;

  // Explicit asymmetric wins (either side)
  if (sF === "asymmetric" || sR === "asymmetric") return "asymmetric";
  if (
    forward.reverseType &&
    typeId(forward.reverseType) !== typeId(forward.type)
  ) {
    return "asymmetric";
  }

  if (!reverse) {
    // Single stored directed row
    if (sF === "bidirectional") return "bidirectional";
    if (sF === "unidirectional") return "unidirectional";
    // No symmetry field + no reverse row → one-way (do NOT default bi)
    return "unidirectional";
  }

  // Both directions present in data
  const sameType = typeId(forward.type) === typeId(reverse.type);
  if (!sameType) return "asymmetric";

  // Same structural type both ways → mutual bond
  if (sF === "unidirectional" && sR === "unidirectional") {
    return "bidirectional";
  }
  if (sF === "bidirectional" || sR === "bidirectional" || sF == null) {
    return "bidirectional";
  }
  return sF;
}

/**
 * Collapse A→B (+ optional B→A) into one visual dyad edge.
 * Geometry / arrows are driven by **symmetry**, not by 亲人/敌人 labels.
 */
function collapseDirectedDyads(directed: SimEdge[]): SimEdge[] {
  const byDir = new Map(directed.map((e) => [`${e.source}\0>\0${e.target}`, e]));
  const used = new Set<string>();
  const out: SimEdge[] = [];

  for (const e of directed) {
    const dir = `${e.source}\0>\0${e.target}`;
    if (used.has(dir)) continue;
    const revKey = `${e.target}\0>\0${e.source}`;
    const rev = byDir.get(revKey);

    if (!rev) {
      used.add(dir);
      const symmetry = resolveDyadSymmetry(e, undefined);
      const meta = relMeta(e.type);
      const revMeta = e.reverseType ? relMeta(e.reverseType) : null;
      out.push({
        ...e,
        label: meta.label,
        color: meta.color,
        dash: meta.dash,
        symmetry,
        reverseType:
          symmetry === "asymmetric"
            ? e.reverseType
            : symmetry === "bidirectional"
              ? e.type
              : undefined,
        reverseLabel:
          symmetry === "asymmetric" && revMeta ? revMeta.label : undefined,
        paired: false,
      });
      continue;
    }

    used.add(dir);
    used.add(revKey);

    const symmetry = resolveDyadSymmetry(e, rev);
    const metaA = relMeta(e.type);
    const metaB = relMeta(rev.type);

    if (symmetry === "bidirectional") {
      out.push({
        ...e,
        type: e.type,
        label: metaA.label,
        color: metaA.color,
        dash: metaA.dash,
        symmetry: "bidirectional",
        reverseType: e.type,
        reverseLabel: undefined,
        paired: true,
        description: e.description || rev.description,
        history: e.history || rev.history,
        dynamics: e.dynamics || rev.dynamics,
      });
    } else if (symmetry === "asymmetric") {
      out.push({
        ...e,
        label: metaA.label,
        reverseType: rev.type,
        reverseLabel: metaB.label,
        color: metaA.color,
        dash: metaA.dash || metaB.dash,
        symmetry: "asymmetric",
        paired: true,
        description: e.description || rev.description,
        history: e.history || rev.history,
        dynamics: e.dynamics || rev.dynamics,
      });
    } else {
      // unidirectional but reverse row also exists (data noise): keep forward only as uni
      out.push({
        ...e,
        label: metaA.label,
        color: metaA.color,
        dash: metaA.dash,
        symmetry: "unidirectional",
        reverseType: undefined,
        reverseLabel: undefined,
        paired: true,
        description: e.description || "",
        history: e.history || "",
        dynamics: e.dynamics || "",
      });
    }
  }

  return out;
}

/** Visual style for each RelationshipSymmetry (arrows / curve / label). */
function symmetryVisual(sym: RelationshipSymmetry): {
  bow: number;
  markerStart: boolean;
  markerEnd: boolean;
  /** extra stroke dash for symmetry (on top of structural type dash) */
  symmetryDash?: string;
  strokeWidthMul: number;
  labelKind: "uni" | "bi" | "asym";
} {
  switch (sym) {
    case "unidirectional":
      return {
        bow: 18,
        markerStart: false,
        markerEnd: true,
        strokeWidthMul: 1,
        labelKind: "uni",
      };
    case "asymmetric":
      return {
        bow: 20,
        markerStart: true,
        markerEnd: true,
        symmetryDash: "5 3",
        strokeWidthMul: 1.05,
        labelKind: "asym",
      };
    case "bidirectional":
    default:
      return {
        bow: 6,
        markerStart: false,
        markerEnd: false,
        strokeWidthMul: 1.2,
        labelKind: "bi",
      };
  }
}

function symmetryLabelZh(sym: RelationshipSymmetry): string {
  if (sym === "unidirectional") return "单向";
  if (sym === "asymmetric") return "不对称";
  return "双向";
}

function buildGraph(characters: CharacterProfile[]): {
  nodes: SimNode[];
  edges: SimEdge[];
} {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const byName = new Map(characters.map((c) => [c.name, c]));
  const byNameKey = new Map(characters.map((c) => [nameKey(c.name), c]));
  for (const c of characters) {
    for (const al of c.aliases || []) {
      const k = nameKey(al);
      if (k && !byNameKey.has(k)) byNameKey.set(k, c);
    }
  }

  // Collect raw directed rows first
  const edgeMap = new Map<string, SimEdge>();
  for (const c of characters) {
    const rels = c.relationships || [];
    rels.forEach((rel, relIndex) => {
      const other = resolveTarget(rel, byId, byName, byNameKey);
      if (!other || charKey(other) === charKey(c)) return;
      const a = charKey(c);
      const b = charKey(other);
      const dir = `${a}\0>\0${b}`;
      if (edgeMap.has(dir)) return;
      const meta = relMeta(rel.type);
      const declared = parseSymmetry(rel.symmetry);
      edgeMap.set(dir, {
        source: a,
        target: b,
        type: rel.type,
        label: meta.label,
        color: meta.color,
        dash: meta.dash,
        // provisional; collapseDirectedDyads sets final symmetry for paint
        symmetry: declared || "unidirectional",
        declaredSymmetry: declared,
        reverseType: rel.reverseType,
        valence: rel.valence,
        visibility: rel.visibility,
        description: rel.description || "",
        history: rel.history || "",
        dynamics: rel.dynamics || "",
        fromName: c.name,
        toName: other.name,
        ownerId: a,
        relIndex,
      });
    });
  }

  const edges = collapseDirectedDyads(Array.from(edgeMap.values()));

  // Degree = unique neighbors (undirected), so size reflects connectivity not mirrored rows
  const degree = new Map<string, number>();
  characters.forEach((c) => degree.set(charKey(c), 0));
  const seenPair = new Set<string>();
  for (const e of edges) {
    const pk =
      e.source < e.target
        ? `${e.source}\0${e.target}`
        : `${e.target}\0${e.source}`;
    if (seenPair.has(pk)) continue;
    seenPair.add(pk);
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }

  const n = characters.length;
  // Deterministic ring seed (no Math.random — stable layouts)
  const ringR = Math.max(80, Math.min(220, 28 * Math.sqrt(Math.max(n, 1))));
  const nodes: SimNode[] = characters.map((c, i) => {
    const angle = (2 * Math.PI * i) / Math.max(n, 1) - Math.PI / 2;
    return {
      id: charKey(c),
      name: c.name,
      char: c,
      x: Math.cos(angle) * ringR,
      y: Math.sin(angle) * ringR,
      vx: 0,
      vy: 0,
      degree: degree.get(charKey(c)) || 0,
    };
  });

  return { nodes, edges };
}

/**
 * Force layout tuned to canvas pixel space so we do not need a crushing fit-scale.
 * Linked pairs stay closer than non-linked; min gap keeps edges out from under nodes.
 */
function runForce(
  nodes: SimNode[],
  edges: SimEdge[],
  width: number,
  height: number,
  ticks = 280,
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

  // Target spacing from area (Fruchterman–Reingold style)
  const area = Math.max(width * height, 1);
  const k = Math.sqrt(area / n);
  const idealLen = Math.max(72, Math.min(k * 1.15, Math.min(width, height) * 0.28));
  const charge = k * k * 1.35;
  const maxDeg = Math.max(1, ...nodes.map((nd) => nd.degree));

  // Place ring into canvas center with room to expand
  for (const node of nodes) {
    node.x += cx;
    node.y += cy;
  }

  for (let t = 0; t < ticks; t++) {
    const alpha = Math.pow(1 - t / ticks, 0.85);
    const cool = 0.1 * alpha + 0.008;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist2 = dx * dx + dy * dy || 1;
        const dist = Math.sqrt(dist2);
        // Soft min-distance ≈ sum of radii so nodes don't sit on top of each other
        const ra = 14 + (a.degree / maxDeg) * 8;
        const rb = 14 + (b.degree / maxDeg) * 8;
        const minD = ra + rb + 28;
        const force = (charge * alpha) / dist2;
        let fx = (dx / dist) * force;
        let fy = (dy / dist) * force;
        if (dist < minD) {
          const push = ((minD - dist) / dist) * 0.45 * alpha;
          fx += dx * push;
          fy += dy * push;
        }
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
      // Stronger springs → clusters by actual bonds, not a random cloud
      const diff = dist - idealLen;
      const force = diff * 0.14 * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const node of nodes) {
      // Weak centering — enough to keep graph on canvas, not a tight ball
      node.vx += (cx - node.x) * 0.005 * alpha;
      node.vy += (cy - node.y) * 0.005 * alpha;
      node.vx *= 0.82;
      node.vy *= 0.82;
      node.x += node.vx * cool * 14;
      node.y += node.vy * cool * 14;
    }
  }

  // Center + mild fit: never crush below a floor that would hide edges under nodes
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
  const pad = 48;
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  // Prefer fitting inside view, but floor scale so min span stays readable
  const fit = Math.min((width - pad * 2) / bw, (height - pad * 2) / bh);
  const minSpan = Math.max(idealLen * Math.sqrt(n) * 0.55, 220);
  const floor = Math.min(1, minSpan / Math.max(bw, bh));
  // If graph is huge, allow scale < 1 (user can zoom); if tiny, expand a bit
  const scale = Math.min(Math.max(fit, floor), 1.25);
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  for (const node of nodes) {
    node.x = cx + (node.x - mx) * scale;
    node.y = cy + (node.y - my) * scale;
  }
}

function nodeRadius(degree: number, maxDegree: number, nodeCount: number) {
  const t = maxDegree > 0 ? degree / maxDegree : 0;
  // Shrink nodes when cast is large so edges stay visible
  const base = nodeCount > 40 ? 11 : nodeCount > 22 ? 13 : 16;
  const span = nodeCount > 40 ? 6 : 9;
  return base + t * span;
}

/** Point on segment from center toward other, on circle of radius r */
function edgeEndpoint(
  x: number,
  y: number,
  ox: number,
  oy: number,
  r: number,
): { x: number; y: number } {
  const dx = ox - x;
  const dy = oy - y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: x + (dx / len) * r, y: y + (dy / len) * r };
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
  const [layoutTick, setLayoutTick] = useState(0);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const sizeRef = useRef(size);
  zoomRef.current = zoom;
  panRef.current = pan;
  sizeRef.current = size;

  const dragRef = useRef<{
    mode: "pan" | "node" | null;
    nodeId?: string;
    lastX: number;
    lastY: number;
    moved: boolean;
  }>({ mode: null, lastX: 0, lastY: 0, moved: false });

  // Sync from parent when not dirty
  useEffect(() => {
    if (dirty) return;
    setLocalChars(cloneChars(charactersProp));
  }, [charactersProp, dirty]);

  const { nodes: seedNodes, edges: allEdges } = useMemo(
    () => buildGraph(localChars),
    [localChars],
  );

  const edgeMatchesFilter = useCallback(
    (e: SimEdge) => {
      if (!typeFilter) return true;
      if (e.label === typeFilter || e.reverseLabel === typeFilter) return true;
      if (normalizeType(e.type) === typeFilter) return true;
      if (e.reverseType && normalizeType(e.reverseType) === typeFilter)
        return true;
      return false;
    },
    [typeFilter],
  );

  const matchedEdges = useMemo(
    () => allEdges.filter(edgeMatchesFilter),
    [allEdges, edgeMatchesFilter],
  );

  const filterTypes = useMemo(() => {
    const seen = new Map<string, { color: string; label: string; count: number }>();
    const bump = (label: string, color: string) => {
      const prev = seen.get(label);
      if (prev) prev.count++;
      else seen.set(label, { color, label, count: 1 });
    };
    for (const e of allEdges) {
      bump(e.label || normalizeType(e.type), e.color);
      if (e.symmetry === "asymmetric" && e.reverseLabel) {
        bump(e.reverseLabel, relMeta(e.reverseType || e.type).color);
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.count - a.count);
  }, [allEdges]);

  // Layout uses full graph; filter only changes emphasis (dim), not topology
  const layoutKey = useMemo(
    () =>
      localChars.map((c) => charKey(c)).join("|") +
      ":" +
      allEdges.map((e) => e.source + e.target + e.type + (e.reverseType || "")).join(",") +
      ":" +
      (fullscreen ? "fs" : "in") +
      ":" +
      layoutTick,
    [localChars, allEdges, fullscreen, layoutTick],
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

  // Zoom LOD: overview vs detail — visuals change as you zoom
  const showEdgeLabels = zoom >= 0.75;
  const showFullNames = zoom >= 0.55;
  const showNodeInitials = zoom >= 0.4;
  // Keep strokes ~constant on screen so lines stay readable when zoomed out
  const strokeScale = 1 / Math.max(zoom, 0.35);

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

  const applyZoomAt = useCallback((factor: number, screenX: number, screenY: number) => {
    const z = zoomRef.current;
    const p = panRef.current;
    const { w, h } = sizeRef.current;
    const nz = Math.max(0.25, Math.min(4, z * factor));
    if (nz === z) return;
    const cx = w / 2;
    const cy = h / 2;
    // world under cursor before zoom
    const wx = (screenX - p.x - cx) / z + cx;
    const wy = (screenY - p.y - cy) / z + cy;
    // pan so same world point stays under cursor
    const nx = screenX - cx - (wx - cx) * nz;
    const ny = screenY - cy - (wy - cy) * nz;
    setZoom(nz);
    setPan({ x: nx, y: ny });
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-ui]")) return;
    const nodeEl = (e.target as HTMLElement).closest("[data-node]");
    if (nodeEl) {
      const id = nodeEl.getAttribute("data-node-id");
      if (id) {
        dragRef.current = {
          mode: "node",
          nodeId: id,
          lastX: e.clientX,
          lastY: e.clientY,
          moved: false,
        };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }
    }
    dragRef.current = {
      mode: "pan",
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.mode) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (d.mode === "pan") {
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }
    if (d.mode === "node" && d.nodeId) {
      const z = zoomRef.current;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === d.nodeId
            ? { ...n, x: n.x + dx / z, y: n.y + dy / z, vx: 0, vy: 0 }
            : n,
        ),
      );
    }
  };
  const onPointerUp = () => {
    dragRef.current.mode = null;
    dragRef.current.nodeId = undefined;
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      applyZoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fullscreen, applyZoomAt]);

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedId(null);
  };

  const relayout = () => {
    setLayoutTick((t) => t + 1);
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
      edgeKey: `${e.source}→${e.target}`,
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

  const symmetryCounts = useMemo(() => {
    const c = { unidirectional: 0, bidirectional: 0, asymmetric: 0 };
    for (const e of allEdges) {
      c[e.symmetry] = (c[e.symmetry] || 0) + 1;
    }
    return c;
  }, [allEdges]);

  if (charactersProp.length === 0 && localChars.length === 0) return null;

  const edgeKey = (e: SimEdge) => `${e.source}→${e.target}`;

  const toolbar = (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="ov-section-label">
        <span className="w-8 h-8 rounded-lg bg-ember-soft flex items-center justify-center">
          <GitBranch className="w-4 h-4 text-primary" />
        </span>
        角色关系网
        <span className="text-xs text-fog font-normal">
          {localChars.length} 人
          {allEdges.length > 0 ? ` · ${allEdges.length} 对关系` : ""}
          {typeFilter
            ? ` · 高亮「${typeFilter}」${matchedEdges.length}`
            : ""}
          {dirty ? " · 未保存" : ""}
          <span className="ml-1 opacity-70">· {Math.round(zoom * 100)}%</span>
        </span>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {editing && (
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
        {dirty && (
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
            title="重新排布"
            onClick={relayout}
            aria-label="重新排布"
          >
            <Users className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-ui
            className="p-2 hover:bg-panel-elevated rounded-lg text-muted-foreground hover:text-foreground"
            onClick={() =>
              applyZoomAt(1.15, size.w / 2, size.h / 2)
            }
            aria-label="放大"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-ui
            className="p-2 hover:bg-panel-elevated rounded-lg text-muted-foreground hover:text-foreground"
            onClick={() =>
              applyZoomAt(0.87, size.w / 2, size.h / 2)
            }
            aria-label="缩小"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-ui
            className="p-2 hover:bg-panel-elevated rounded-lg text-muted-foreground hover:text-foreground"
            onClick={resetView}
            aria-label="重置视图"
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
    <div className="space-y-2" data-ui>
      {/* Symmetry legend — how edges are drawn (not 亲人/敌人) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="text-fog shrink-0">方向：</span>
        <span className="inline-flex items-center gap-1.5" title="只成立 A→B">
          <svg width="28" height="10" className="opacity-90" aria-hidden>
            <defs>
              <marker
                id="leg-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto"
              >
                <path d="M0 0 L10 5 L0 10z" fill="currentColor" />
              </marker>
            </defs>
            <line
              x1="2"
              y1="5"
              x2="24"
              y2="5"
              stroke="currentColor"
              strokeWidth="1.5"
              markerEnd="url(#leg-arrow)"
            />
          </svg>
          单向
          <span className="opacity-50">{symmetryCounts.unidirectional}</span>
        </span>
        <span className="inline-flex items-center gap-1.5" title="双方同类互向">
          <svg width="28" height="10" className="opacity-90" aria-hidden>
            <line
              x1="2"
              y1="5"
              x2="24"
              y2="5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="14" cy="5" r="2" fill="currentColor" />
          </svg>
          双向
          <span className="opacity-50">{symmetryCounts.bidirectional}</span>
        </span>
        <span
          className="inline-flex items-center gap-1.5"
          title="双方都重要但类型不同"
        >
          <svg width="28" height="10" className="opacity-90" aria-hidden>
            <line
              x1="2"
              y1="5"
              x2="24"
              y2="5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
          </svg>
          不对称 ⇄
          <span className="opacity-50">{symmetryCounts.asymmetric}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
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
        <defs>
          {/* End arrow: points toward target (for unidirectional / asymmetric) */}
          <marker
            id="rel-arrow-end"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth={Math.max(4, 6 * strokeScale)}
            markerHeight={Math.max(4, 6 * strokeScale)}
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#c4b5a5" />
          </marker>
          {/* Start arrow: points back toward source (asymmetric reverse) */}
          <marker
            id="rel-arrow-start"
            viewBox="0 0 10 10"
            refX="1"
            refY="5"
            markerWidth={Math.max(4, 6 * strokeScale)}
            markerHeight={Math.max(4, 6 * strokeScale)}
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 10 0 L 0 5 L 10 10 z" fill="#c4b5a5" />
          </marker>
        </defs>
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
            const ra = nodeRadius(a.degree, maxDegree, nodes.length);
            const rb = nodeRadius(b.degree, maxDegree, nodes.length);
            const p0 = edgeEndpoint(a.x, a.y, b.x, b.y, ra + 2);
            const p1 = edgeEndpoint(b.x, b.y, a.x, a.y, rb + 2);
            const dx = p1.x - p0.x;
            const dy = p1.y - p0.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const vis = symmetryVisual(e.symmetry);
            const ox = (-dy / len) * vis.bow;
            const oy = (dx / len) * vis.bow;
            const midX = (p0.x + p1.x) / 2;
            const midY = (p0.y + p1.y) / 2;
            const cpx = midX + ox;
            const cpy = midY + oy;
            const k = edgeKey(e);
            const stroke = dim ? "#6b6560" : e.color;
            const labelColor = dim ? "#8a847c" : e.color;
            const baseW =
              (!dim && hoverEdge === k ? 2.4 : dim ? 1.1 : 1.65) *
              vis.strokeWidthMul;
            // Structural dash (enemy etc.) OR symmetry dash (asymmetric); structural wins if set
            const dash =
              e.dash ||
              (vis.symmetryDash && e.symmetry === "asymmetric"
                ? vis.symmetryDash
                : undefined);
            // Labels: social type text + symmetry glyph
            const labelText =
              vis.labelKind === "uni"
                ? `${e.label}→`
                : vis.labelKind === "asym"
                  ? `${e.label}⇄${e.reverseLabel || "?"}`
                  : `${e.label}`;
            const labelMax = zoom >= 1.2 ? 12 : zoom >= 0.9 ? 8 : 5;
            const displayLabel =
              labelText.length > labelMax
                ? labelText.slice(0, labelMax)
                : labelText;
            const lw = Math.max(28, displayLabel.length * 8.5 + 14);
            const pathD = `M ${p0.x} ${p0.y} Q ${cpx} ${cpy} ${p1.x} ${p1.y}`;

            return (
              <g
                key={k}
                opacity={dim ? 0.18 : 1}
                onMouseEnter={() => setHoverEdge(k)}
                onMouseLeave={() => setHoverEdge(null)}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (editing) openEditEdge(e);
                }}
                className={editing ? "cursor-pointer" : "cursor-default"}
              >
                <title>
                  {e.fromName} {symmetryLabelZh(e.symmetry)} {e.toName}
                  {e.symmetry === "asymmetric"
                    ? ` · ${e.label}⇄${e.reverseLabel || ""}`
                    : ` · ${e.label}`}
                </title>
                <path
                  d={pathD}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={baseW * strokeScale}
                  strokeDasharray={dash}
                  strokeOpacity={dim ? 0.5 : 0.92}
                  strokeLinecap="round"
                  markerStart={
                    vis.markerStart ? "url(#rel-arrow-start)" : undefined
                  }
                  markerEnd={vis.markerEnd ? "url(#rel-arrow-end)" : undefined}
                />
                {/* Bidirectional: small mid-caps to show mutual without direction */}
                {e.symmetry === "bidirectional" && !dim && (
                  <circle
                    cx={cpx}
                    cy={cpy}
                    r={2.2 * strokeScale}
                    fill={stroke}
                    opacity={0.85}
                  />
                )}
                <path
                  d={pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14 * strokeScale}
                />
                {showEdgeLabels && (
                  <g
                    transform={`translate(${cpx}, ${cpy}) scale(${strokeScale})`}
                  >
                    <rect
                      x={-lw / 2}
                      y={e.symmetry === "bidirectional" ? -18 : -9}
                      width={lw}
                      height={16}
                      rx={8}
                      fill="hsl(24 12% 11%)"
                      stroke={labelColor}
                      strokeOpacity={dim ? 0.25 : 0.45}
                      strokeWidth={1}
                    />
                    <text
                      textAnchor="middle"
                      y={e.symmetry === "bidirectional" ? -6 : 3}
                      fill={labelColor}
                      fontSize={9}
                      fontWeight={600}
                      style={{ pointerEvents: "none" }}
                    >
                      {displayLabel}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {nodes.map((n) => {
            const r = nodeRadius(n.degree, maxDegree, nodes.length);
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
            const maxName = showFullNames
              ? zoom >= 1.3
                ? 12
                : 8
              : 4;
            const label =
              n.name.length > maxName
                ? n.name.slice(0, maxName) + "…"
                : n.name;
            const tw = Math.min(100, 14 + label.length * 10);

            return (
              <g
                key={n.id}
                data-node
                data-node-id={n.id}
                transform={`translate(${n.x},${n.y})`}
                opacity={dim ? 0.22 : 1}
                className="cursor-grab active:cursor-grabbing"
                onClick={(ev) => {
                  ev.stopPropagation();
                  // ignore click if we just dragged the node
                  if (dragRef.current.moved) return;
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
                  strokeWidth={(isSel ? 2.5 : 1.25) * strokeScale}
                />
                {showNodeInitials && (
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={dim ? "#9a948c" : "#faf6f1"}
                    fontSize={r > 16 ? 13 : 11}
                    fontWeight={700}
                    style={{ pointerEvents: "none" }}
                  >
                    {initial}
                  </text>
                )}
                {showFullNames && (
                  <g transform={`translate(0, ${r + 12}) scale(${strokeScale})`}>
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
                      fill={
                        dim
                          ? "hsla(40, 10%, 65%, 0.75)"
                          : "hsla(40, 25%, 90%, 0.95)"
                      }
                      fontSize={11}
                      fontWeight={600}
                      style={{ pointerEvents: "none" }}
                    >
                      {label}
                    </text>
                  </g>
                )}
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
                  const fromHere = e.source === selected.id;
                  const typeBadge =
                    e.symmetry === "asymmetric" && e.reverseLabel
                      ? fromHere
                        ? `${e.label}→ / ←${e.reverseLabel}`
                        : `${e.reverseLabel}→ / ←${e.label}`
                      : e.label;
                  const arrow =
                    e.symmetry === "bidirectional"
                      ? "↔"
                      : fromHere
                        ? "→"
                        : "←";
                  const symZh = symmetryLabelZh(e.symmetry);
                  return (
                    <div
                      key={edgeKey(e)}
                      className={`rounded-lg border px-2.5 py-2 ${
                        muted
                          ? "bg-secondary/20 border-border/30 opacity-50"
                          : "bg-secondary/40 border-border/40"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-border/40 text-fog">
                          {symZh}
                        </span>
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={{
                            color: muted ? "#8a847c" : e.color,
                            background: muted ? "#6b656022" : `${e.color}22`,
                          }}
                        >
                          {typeBadge}
                        </span>
                        <span
                          className={`text-xs font-medium truncate ${
                            muted ? "text-fog" : "text-foreground"
                          }`}
                        >
                          {arrow} {other}
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
