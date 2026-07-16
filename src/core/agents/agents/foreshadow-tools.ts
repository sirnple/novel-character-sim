import type { ToolDefinition } from "../types";
import {
  getForeshadowPlan,
  getForeshadowRealization,
  saveForeshadowPlan,
  saveForeshadowRealization,
  saveFindings,
  formatFindingsReadable,
} from "../intermediate-store";
import { getForeshadowingLedger } from "@/lib/db";
import { formatLedgerForPrompt, type ForeshadowingPlan, type ForeshadowingRealization } from "@/core/foreshadowing/types";

export const SAVE_FS_PLAN_OK = "伏笔 plan 已存";
export const SAVE_FS_REALIZATION_OK = "realization 已存";

export const foreshadowTools: ToolDefinition[] = [
  {
    name: "get_foreshadowing_ledger",
    description: "获取当前分支持久伏笔账本（活跃列表）。大纲/写手/伏笔审查应先读。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const userId = ctx.userId || "guest";
      const novelId = ctx.novelId;
      const branchId = ctx.branchId;
      const ledger = getForeshadowingLedger(userId, novelId, branchId);
      return {
        content:
          `【活跃伏笔 ${ledger.active.length} 条 · version ${ledger.version}】\n` +
          formatLedgerForPrompt(ledger),
        messages: [],
      };
    },
  },
  {
    name: "get_foreshadowing_plan",
    description: "获取本轮大纲的伏笔计划（意图，未落库）。写手/审查用。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const plan = getForeshadowPlan(ctx.novelId, ctx.branchId);
      if (!plan) return { content: "本轮尚无伏笔 plan", messages: [] };
      return { content: JSON.stringify(plan, null, 2), messages: [] };
    },
  },
  {
    name: "save_foreshadowing_plan",
    description:
      "大纲专用：保存本轮伏笔 plan（唯一真相，会话 store）。必须调用。不写持久账本。",
    parameters: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description: "JSON：{ plant, advance, reveal, abandon, rationale }",
        },
      },
      required: ["plan"],
    },
    execute: async (args, ctx) => {
      let raw = args.plan;
      let body: any;
      try {
        body = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        return { content: "plan JSON 解析失败，请重试 save_foreshadowing_plan", messages: [] };
      }
      const plan: ForeshadowingPlan = {
        novelId: ctx.novelId,
        branchId: ctx.branchId,
        createdAt: new Date().toISOString(),
        source: "outline",
        plant: Array.isArray(body.plant) ? body.plant : [],
        advance: Array.isArray(body.advance) ? body.advance : [],
        reveal: Array.isArray(body.reveal) ? body.reveal : [],
        abandon: Array.isArray(body.abandon) ? body.abandon : [],
        rationale: body.rationale || "",
      };
      saveForeshadowPlan(ctx.novelId, ctx.branchId, plan);
      const lines = [
        `${SAVE_FS_PLAN_OK}（未写持久账本）`,
        `- 拟新埋 plant: ${plan.plant.length}`,
        `- 拟推进 advance: ${plan.advance.length}`,
        `- 拟回收 reveal: ${plan.reveal.length}`,
        `- 拟废弃 abandon: ${plan.abandon.length}`,
      ];
      if (plan.plant[0]?.description) {
        lines.push(`- 例：${String(plan.plant[0].description).slice(0, 80)}`);
      }
      return { content: lines.join("\n"), messages: [] };
    },
  },
  {
    name: "get_foreshadowing_realization",
    description: "获取最近一次伏笔审查的 realized 结算单。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const r = getForeshadowRealization(ctx.novelId, ctx.branchId);
      if (!r) return { content: "尚无伏笔 realization", messages: [] };
      return { content: JSON.stringify(r, null, 2), messages: [] };
    },
  },
  {
    name: "save_foreshadowing_realization",
    description:
      "伏笔审查专用：保存 realized 结算（唯一真相）。必须调用。不写持久账本；Accept 时 commit。",
    parameters: {
      type: "object",
      properties: {
        realization: {
          type: "string",
          description: "JSON：{ pass, findings, realized, gaps }",
        },
      },
      required: ["realization"],
    },
    execute: async (args, ctx) => {
      let body: any;
      try {
        body =
          typeof args.realization === "string"
            ? JSON.parse(args.realization)
            : args.realization;
      } catch {
        return { content: "realization JSON 解析失败，请重试", messages: [] };
      }
      const findingsRaw = Array.isArray(body.findings) ? body.findings : [];
      const realization: ForeshadowingRealization = {
        novelId: ctx.novelId,
        branchId: ctx.branchId,
        reviewedAt: new Date().toISOString(),
        pass: !!body.pass,
        findings: findingsRaw.map((f: any) => ({
          severity: f.severity || "minor",
          code: f.code,
          description: String(f.description || ""),
          suggestion: f.suggestion ? String(f.suggestion) : undefined,
        })),
        realized: body.realized || {
          planted: [],
          advanced: [],
          revealed: [],
          abandoned: [],
        },
        gaps: body.gaps || { planNotRealized: [], realizedNotInPlan: [] },
      };
      saveForeshadowRealization(ctx.novelId, ctx.branchId, realization);
      const findings = realization.findings
        .filter((f) => f.description)
        .map((f) => ({
          dimension: "foreshadowing",
          severity: String(f.severity || "minor"),
          description: f.description,
          suggestion: f.suggestion || "",
        }));
      saveFindings(ctx.novelId, ctx.branchId, findings);
      const r = realization.realized;
      const lines = [
        `${SAVE_FS_REALIZATION_OK} pass=${realization.pass}（未写持久账本；Accept 后落定）`,
        `- findings: ${findings.length}`,
        `- realized plant/advance/reveal: ${r.planted?.length || 0}/${r.advanced?.length || 0}/${r.revealed?.length || 0}`,
        `- gaps plan未落实: ${realization.gaps.planNotRealized?.length || 0}`,
      ];
      if (findings.length) {
        lines.push("", formatFindingsReadable(findings));
      }
      return { content: lines.join("\n"), messages: [] };
    },
  },
];
