/**
 * Apply ForeshadowingRealization.realized onto a persistent ledger.
 * Never apply a bare plan — realized is the only commit source.
 */
import { randomUUID } from "node:crypto";
import type {
  ForeshadowingItem,
  ForeshadowingLedger,
  ForeshadowingRealization,
  ForeshadowType,
  ForeshadowImportance,
} from "./types";

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return "fs_" + randomUUID().replace(/-/g, "").slice(0, 12);
}

export function commitRealization(
  ledger: ForeshadowingLedger,
  realization: ForeshadowingRealization,
): ForeshadowingLedger {
  const next: ForeshadowingLedger = {
    ...ledger,
    active: [...ledger.active],
    history: [...ledger.history],
    version: ledger.version + 1,
    updatedAt: nowIso(),
  };

  const byId = new Map(next.active.map((x) => [x.id, x]));
  const r = realization.realized || {
    planted: [],
    advanced: [],
    revealed: [],
    abandoned: [],
  };

  for (const p of r.planted || []) {
    const desc = String(p.description || "").trim();
    if (!desc) continue;
    const item: ForeshadowingItem = {
      id: newId(),
      description: desc,
      type: (p.type as ForeshadowType) || "plot",
      status: "pending",
      importance: (p.importance as ForeshadowImportance) || "should",
      mustResolve: !!p.mustResolve || p.importance === "must",
      suggestedRevealWindow: p.suggestedRevealWindow || "",
      plantedAt: nowIso(),
      plantedAnchor: p.anchor || { note: "accept" },
      related: p.related || [],
    };
    next.active.push(item);
    byId.set(item.id, item);
  }

  for (const a of r.advanced || []) {
    const item = byId.get(a.id);
    if (!item) continue;
    item.status = "advancing";
    item.lastAdvancedAt = nowIso();
    if (a.how) item.notes = [item.notes, a.how].filter(Boolean).join(" | ");
  }

  for (const rev of r.revealed || []) {
    const idx = next.active.findIndex((x) => x.id === rev.id);
    if (idx < 0) continue;
    const item = { ...next.active[idx] };
    item.status = "revealed";
    item.revealedAt = nowIso();
    item.revealAnchor = rev.anchor || { note: rev.how || "revealed" };
    next.active.splice(idx, 1);
    byId.delete(rev.id);
    next.history.unshift(item);
  }

  for (const ab of r.abandoned || []) {
    const idx = next.active.findIndex((x) => x.id === ab.id);
    if (idx < 0) continue;
    const item = { ...next.active[idx] };
    item.status = "abandoned";
    item.abandonedReason = ab.reason || "";
    next.active.splice(idx, 1);
    byId.delete(ab.id);
    next.history.unshift(item);
  }

  // Cap history
  if (next.history.length > 80) {
    next.history = next.history.slice(0, 80);
  }

  return next;
}
