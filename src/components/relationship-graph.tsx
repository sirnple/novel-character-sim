"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { CharacterProfile } from "@/types";
import { GitBranch, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

export default function RelationshipGraph({ characters }: { characters: CharacterProfile[] }) {
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
    const h = 450;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  }, [characters.length]); // re-size only when characters first load

  // draw accepts explicit pan/zoom so it can use refs during drag
  const draw = useCallback((p: { x: number; y: number }, z: number) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || characters.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = 450;

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

    // Edges
    const drawnPairs = new Set<string>();
    for (const pos of positions) {
      for (const rel of pos.char.relationships) {
        const other = positions.find((p) => p.char.id === rel.characterId);
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

    // Nodes
    for (const pos of positions) {
      const r = 22 / z;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = "#f97316";
      ctx.fill();
      ctx.strokeStyle = "#ea580c";
      ctx.lineWidth = 2 / z;
      ctx.stroke();

      ctx.fillStyle = "#fff";
      ctx.font = `bold ${13 / z}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pos.char.name.charAt(0), pos.x, pos.y);

      ctx.fillStyle = "#333";
      ctx.font = `${10 / z}px sans-serif`;
      ctx.fillText(pos.char.name, pos.x, pos.y + (30 / z));
    }

    ctx.restore();
  }, [characters]);

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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-muted-foreground">角色关系图</h3>
        </div>
        <div className="flex items-center gap-1">
          <button className="p-1 hover:bg-secondary rounded" onClick={() => setZoom((z) => Math.min(3, z * 1.2))}>
            <ZoomIn className="w-4 h-4" />
          </button>
          <button className="p-1 hover:bg-secondary rounded" onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))}>
            <ZoomOut className="w-4 h-4" />
          </button>
          <button className="p-1 hover:bg-secondary rounded" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="border rounded-lg bg-card select-none relative"
        style={{ height: "450px", overflow: "hidden" }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
        {/* Transparent overlay captures drag events, canvas does rendering */}
        <div
          className="absolute inset-0 cursor-grab z-10"
          onMouseDown={handleMouseDown}
        />
      </div>
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
