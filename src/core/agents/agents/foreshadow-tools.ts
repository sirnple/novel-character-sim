import type { ToolDefinition } from "../types";
import {
  getForeshadowPlan,
  getForeshadowRealization,
  saveForeshadowPlan,
  saveForeshadowRealization,
} from "../intermediate-store";
import { getForeshadowingLedger } from "@/lib/db";
import { formatLedgerForPrompt, type ForeshadowingPlan, type ForeshadowingRealization } from "@/core/foreshadowing/types";

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
    description: "大纲专用：保存本轮伏笔 plan（plant/advance/reveal/abandon）。不写持久账本。",
    parameters: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description: "JSON 字符串：{ plant, advance, reveal, abandon, rationale }",
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
        return { content: "plan JSON 解析失败", messages: [] };
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
      return {
        content: `伏笔 plan 已存 plant=${plan.plant.length} reveal=${plan.reveal.length}（未写持久账本）`,
        messages: [],
      };
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
      "伏笔审查专用：保存 realized 结算（pass、findings、realized、gaps）。不写持久账本；Accept 时才 commit。",
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
        return { content: "realization JSON 解析失败", messages: [] };
      }
      const realization: ForeshadowingRealization = {
        novelId: ctx.novelId,
        branchId: ctx.branchId,
        reviewedAt: new Date().toISOString(),
        pass: !!body.pass,
        findings: Array.isArray(body.findings) ? body.findings : [],
        realized: body.realized || {
          planted: [],
          advanced: [],
          revealed: [],
          abandoned: [],
        },
        gaps: body.gaps || { planNotRealized: [], realizedNotInPlan: [] },
      };
      saveForeshadowRealization(ctx.novelId, ctx.branchId, realization);
      return {
        content: `realization 已存 pass=${realization.pass}（未写持久账本；用户 Accept 后才落定）`,
        messages: [],
      };
    },
  },
];
