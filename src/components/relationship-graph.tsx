"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { CharacterProfile } from "@/types";
import { GitBranch, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

export default function RelationshipGraph({
  characters,
  height = 450,
  className = "",
}: {
  characters: CharacterProfile[];
  height?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Use refs for drag to avoid re-render overhead during drag
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Set canvas size ONCE on mount — never touch width/height again
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  }, [characters.length, height]); // re-size when characters first load or height changes

  // draw accepts explicit pan/zoom so it can use refs during drag
  const draw = useCallback((p: { x: number; y: number }, z: number) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || characters.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = height;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(p.x + w / 2, p.y + h / 2);
    ctx.scale(z, z);

    const nodeCount = characters.length;
    const radius = Math.min(w, h) / 2 - 50;

    const positions: { x: number; y: number; char: CharacterProfile }[] = [];
    characters.forEach((char, i) => {
      const angle = (2 * Math.PI * i) / nodeCount - Math.PI / 2;
      positions.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle), char });
    });

    // Edges — match by id or name (extractors may only fill one)
    const drawnPairs = new Set<string>();
    for (const pos of positions) {
      for (const rel of pos.char.relationships || []) {
        const other = positions.find(
          (p) =>
            p.char.id === rel.characterId ||
            p.char.name === rel.characterName ||
            p.char.name === rel.characterId,
        );
        if (!other) continue;
        const pairKey = [pos.char.id, other.char.id].sort().join("-");
        if (drawnPairs.has(pairKey)) continue;
        drawnPairs.add(pairKey);

        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.lineTo(other.x, other.y);
        const style = getRelStyle(rel.type);
        ctx.strokeStyle = style.color;
        ctx.lineWidth = 1.5 / z;
        ctx.stroke();

        const mx = (pos.x + other.x) / 2;
        const my = (pos.y + other.y) / 2;
        ctx.fillStyle = style.color;
        ctx.font = `${10 / z}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(style.label, mx, my - 6 / z);
      }
    }

    // Nodes — ember study palette (dark UI)
    for (const pos of positions) {
      const r = 24 / z;
      // soft glow
      const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, r * 1.6);
      grad.addColorStop(0, "rgba(212, 119, 74, 0.35)");
      grad.addColorStop(1, "rgba(212, 119, 74, 0)");
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r * 1.6, 0, 2 * Math.PI);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = "#d4774a";
      ctx.fill();
      ctx.strokeStyle = "rgba(245, 240, 232, 0.35)";
      ctx.lineWidth = 1.5 / z;
      ctx.stroke();

      ctx.fillStyle = "#faf6f1";
      ctx.font = `bold ${13 / z}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pos.char.name.charAt(0), pos.x, pos.y);

      ctx.fillStyle = "rgba(200, 190, 178, 0.95)";
      ctx.font = `${11 / z}px sans-serif`;
      ctx.fillText(pos.char.name, pos.x, pos.y + (32 / z));
    }

    ctx.restore();
  }, [characters, height]);

  // Redraw when state changes (zoom buttons, wheel, initial load)
  useEffect(() => {
    draw(pan, zoom);
  }, [draw, pan, zoom]);

  // Wheel → native (must be non-passive to block page scroll)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) => Math.max(0.2, Math.min(3, z * delta)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [characters.length]);

  // Pan: mouse drag with RAF to avoid per-pixel React re-renders
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  useEffect(() => {
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      panRef.current = {
        x: panRef.current.x + e.clientX - lastPos.current.x,
        y: panRef.current.y + e.clientY - lastPos.current.y,
      };
      lastPos.current = { x: e.clientX, y: e.clientY };
      // Draw immediately with refs — no React re-render needed
      draw(panRef.current, zoomRef.current);
      // Sync React state at ~30fps (every other frame)
      if (!raf) {
        raf = requestAnimationFrame(() => {
          setPan(panRef.current);
          raf = 0;
        });
      }
    };
    const onUp = () => {
      dragging.current = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      setPan(panRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [draw]);

  if (characters.length === 0) return null;

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between px-0.5">
        <div className="ov-section-label">
          <span className="w-8 h-8 rounded-lg bg-ember-soft flex items-center justify-center">
            <GitBranch className="w-4 h-4 text-primary" />
          </span>
          角色关系图
        </div>
        <div className="flex items-center gap-0.5 rounded-xl bg-secondary/60 border border-border/40 p-0.5">
          <button type="button" className="p-2 hover:bg-panel-elevated rounded-lg text-muted-foreground hover:text-foreground transition-colors" onClick={() => setZoom((z) => Math.min(3, z * 1.2))}>
            <ZoomIn className="w-4 h-4" />
          </button>
          <button type="button" className="p-2 hover:bg-panel-elevated rounded-lg text-muted-foreground hover:text-foreground transition-colors" onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))}>
            <ZoomOut className="w-4 h-4" />
          </button>
          <button type="button" className="p-2 hover:bg-panel-elevated rounded-lg text-muted-foreground hover:text-foreground transition-colors" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="select-none relative rounded-2xl overflow-hidden border border-border/50"
        style={{
          height: `${height}px`,
          background:
            "radial-gradient(ellipse at 50% 40%, hsl(24 12% 14%) 0%, hsl(24 12% 9%) 70%)",
          boxShadow: "inset 0 1px 0 hsl(var(--border) / 0.35)",
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
        <div
          className="absolute inset-0 cursor-grab active:cursor-grabbing z-10"
          onMouseDown={handleMouseDown}
        />
      </div>
      <p className="text-[11px] text-fog px-0.5">拖拽平移 · 滚轮缩放</p>
    </div>
  );
}

const REL_LABELS: Record<string, { color: string; label: string }> = {
  family: { color: "#e11d48", label: "家人" },
  friend: { color: "#2563eb", label: "朋友" },
  enemy: { color: "#dc2626", label: "敌人" },
  rival: { color: "#f97316", label: "对手" },
  lover: { color: "#ec4899", label: "恋人" },
  colleague: { color: "#8b5cf6", label: "同僚" },
  "mentor-student": { color: "#06b6d4", label: "师徒" },
  acquaintance: { color: "#9ca3af", label: "相识" },
  other: { color: "#d4d4d4", label: "其他" },
  // Chinese labels from extraction
  家人: { color: "#e11d48", label: "家人" },
  朋友: { color: "#2563eb", label: "朋友" },
  敌人: { color: "#dc2626", label: "敌人" },
  对手: { color: "#f97316", label: "对手" },
  恋人: { color: "#ec4899", label: "恋人" },
  同僚: { color: "#8b5cf6", label: "同僚" },
  师徒: { color: "#06b6d4", label: "师徒" },
  相识: { color: "#9ca3af", label: "相识" },
  其他: { color: "#d4d4d4", label: "其他" },
};

function getRelStyle(type: string): { color: string; label: string } {
  return REL_LABELS[type] || { color: "#d4d4d4", label: type };
}
