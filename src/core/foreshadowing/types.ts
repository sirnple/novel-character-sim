/** Branch-level foreshadowing ledger (persistent + session plan/realization). */

export type ForeshadowStatus = "pending" | "advancing" | "revealed" | "abandoned";
export type ForeshadowType =
  | "plot"
  | "character"
  | "world"
  | "relationship"
  | "mystery"
  | "theme";
export type ForeshadowImportance = "must" | "should" | "optional";

export interface ForeshadowAnchor {
  note: string;
  excerpt?: string;
  charOffsetApprox?: number;
}

export interface ForeshadowEntityRef {
  kind: "character" | "item" | "location" | "other";
  name: string;
}

export interface ForeshadowingItem {
  id: string;
  description: string;
  type: ForeshadowType;
  status: ForeshadowStatus;
  importance: ForeshadowImportance;
  mustResolve: boolean;
  suggestedRevealWindow: string;
  plantedAt: string;
  plantedAnchor: ForeshadowAnchor;
  related: ForeshadowEntityRef[];
  lastAdvancedAt?: string;
  revealedAt?: string;
  revealAnchor?: ForeshadowAnchor;
  abandonedReason?: string;
  notes?: string;
}

export interface ForeshadowingLedger {
  userId: string;
  novelId: string;
  branchId: string;
  version: number;
  active: ForeshadowingItem[];
  history: ForeshadowingItem[];
  updatedAt: string;
}

export interface ForeshadowingPlan {
  novelId: string;
  branchId: string;
  createdAt: string;
  source: "outline";
  plant: Array<{
    tempId?: string;
    description: string;
    type?: ForeshadowType;
    importance?: ForeshadowImportance;
    mustResolve?: boolean;
    suggestedRevealWindow?: string;
    related?: ForeshadowEntityRef[];
  }>;
  advance: Array<{ id: string; how: string }>;
  reveal: Array<{ id: string; how: string }>;
  abandon: Array<{ id: string; reason: string }>;
  rationale?: string;
}

export interface ForeshadowingRealization {
  novelId: string;
  branchId: string;
  reviewedAt: string;
  proseFingerprint?: string;
  pass: boolean;
  findings: Array<{
    severity: "critical" | "major" | "minor";
    code?: string;
    description: string;
    suggestion?: string;
  }>;
  realized: {
    planted: Array<{
      tempId?: string;
      description: string;
      type?: ForeshadowType;
      importance?: ForeshadowImportance;
      mustResolve?: boolean;
      suggestedRevealWindow?: string;
      related?: ForeshadowEntityRef[];
      anchor?: ForeshadowAnchor;
    }>;
    advanced: Array<{ id: string; how: string; anchor?: ForeshadowAnchor }>;
    revealed: Array<{ id: string; how: string; anchor?: ForeshadowAnchor }>;
    abandoned: Array<{ id: string; reason: string }>;
  };
  gaps: {
    planNotRealized: Array<{ kind: string; ref: string; note: string }>;
    realizedNotInPlan: Array<{ kind: string; note: string }>;
  };
}

export function emptyLedger(
  userId: string,
  novelId: string,
  branchId: string,
): ForeshadowingLedger {
  return {
    userId,
    novelId,
    branchId,
    version: 1,
    active: [],
    history: [],
    updatedAt: new Date().toISOString(),
  };
}

export function formatLedgerForPrompt(ledger: ForeshadowingLedger, max = 25): string {
  const active = ledger.active.slice(0, max);
  if (active.length === 0) {
    return "（当前分支无活跃伏笔）";
  }
  return active
    .map((f, i) => {
      const must = f.mustResolve || f.importance === "must" ? "【必收】" : "";
      return (
        `${i + 1}. ${must}id=${f.id} [${f.status}/${f.type}] ${f.description}` +
        (f.suggestedRevealWindow ? ` | 窗口: ${f.suggestedRevealWindow}` : "")
      );
    })
    .join("\n");
}
