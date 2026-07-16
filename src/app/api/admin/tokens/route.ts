import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/core/prompts/admin-auth";
import {
  aggregateTokenUsage,
  getUserById,
  listTokenUsage,
  tokenUsageSummary,
  type TokenUsageFilters,
} from "@/lib/db";

export const dynamic = "force-dynamic";

const GROUP_BY = new Set([
  "agent_id",
  "user_id",
  "novel_id",
  "branch_id",
  "model",
  "day",
] as const);

type GroupBy = "agent_id" | "user_id" | "novel_id" | "branch_id" | "model" | "day";

function parseFilters(req: NextRequest): TokenUsageFilters {
  const sp = req.nextUrl.searchParams;
  return {
    userId: sp.get("userId") || undefined,
    novelId: sp.get("novelId") || undefined,
    branchId: sp.get("branchId") || undefined,
    agentId: sp.get("agentId") || undefined,
    since: sp.get("since") || undefined,
    until: sp.get("until") || undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  };
}

function labelUser(userId: string): string {
  if (!userId || userId === "(empty)") return "(未归因)";
  if (userId.startsWith("guest_")) return userId;
  const u = getUserById(userId);
  if (u?.email) return `${u.email} (${userId.slice(0, 8)})`;
  return userId;
}

/**
 * GET /api/admin/tokens
 * Query:
 *  - groupBy: agent_id | user_id | novel_id | branch_id | model | day
 *  - userId, novelId, branchId, agentId, since, until, limit
 *  - includeRecent=1 to attach recent rows
 */
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const filters = parseFilters(req);
  const groupByRaw = req.nextUrl.searchParams.get("groupBy") || "agent_id";
  const groupBy = (GROUP_BY.has(groupByRaw as GroupBy) ? groupByRaw : "agent_id") as GroupBy;
  const includeRecent = req.nextUrl.searchParams.get("includeRecent") === "1";

  const summary = tokenUsageSummary(filters);
  const byGroup = aggregateTokenUsage(groupBy, filters).map((row) => ({
    ...row,
    label:
      groupBy === "user_id"
        ? labelUser(row.key)
        : row.key,
  }));

  // Secondary dimensions for optimization dashboard
  const byAgent = aggregateTokenUsage("agent_id", filters);
  const byUser = aggregateTokenUsage("user_id", filters).map((row) => ({
    ...row,
    label: labelUser(row.key),
  }));
  const byBranch = aggregateTokenUsage("branch_id", filters);
  const byDay = aggregateTokenUsage("day", filters);

  const recent = includeRecent
    ? listTokenUsage({ ...filters, limit: filters.limit || 100 }).map((r) => ({
        ...r,
        userLabel: labelUser(r.userId || "(empty)"),
      }))
    : undefined;

  return NextResponse.json({
    summary,
    groupBy,
    byGroup,
    byAgent,
    byUser,
    byBranch,
    byDay,
    recent,
    filters,
  });
}
