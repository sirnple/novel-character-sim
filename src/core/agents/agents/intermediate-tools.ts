import type { ToolDefinition } from "../types";
import {
  saveOutline, getOutline, saveProse, getProse,
  saveFindings, getFindings, clearFindings, formatFindingsReadable,
} from "../intermediate-store";
import {
  validateProseContent,
  SAVE_PROSE_OK_PREFIX,
  SAVE_PROSE_REJECT_PREFIX,
  looksLikeFindingsNotProse,
} from "../prose-guard";

/** Read-only intermediate tools — safe for sub-agents that should not write. */
export const intermediateReadTools: ToolDefinition[] = [
  {
    name: "get_outline",
    description: "获取已经存好的大纲正文。writer 写正文前必须先 get_outline 拿到轮廓。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const novelId = String((ctx as any).novelId || "");
      const branchId = String((ctx as any).branchId || "main");
      if (!novelId) {
        return { content: "大纲未生成（缺少 novelId）", messages: [] };
      }
      const o = getOutline(novelId, branchId);
      if (!o || (typeof o === "string" && o.trim().length < 20)) {
        console.warn(`[Store] get_outline miss ${novelId}/${branchId}`);
        return {
          content:
            "大纲未生成。请先调用 generate_outline；若刚生成过，确认 branchId 与写作页一致。",
          messages: [],
        };
      }
      return { content: typeof o === "string" ? o : JSON.stringify(o), messages: [] };
    },
  },
  {
    name: "get_prose",
    description: "获取要被审/改的当前小说正文（叙事文本，不是审查清单）。仅供 review_* 与修改模式 writer 使用。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      const p = getProse(novelId, branchId);
      if (!p) return { content: "正文未生成", messages: [] };
      return {
        content: `【当前正文 · 共 ${p.length} 字 · 以下为小说叙事】\n\n${p}`,
        messages: [],
      };
    },
  },
  {
    name: "get_findings",
    description: "获取审查问题清单（人类可读摘要，不是小说正文）。writer 修改模式用它对照要改的点。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      const findings = getFindings(novelId, branchId);
      return {
        content: `【审查问题清单 · 共 ${findings.length} 条 · 不是正文】\n\n${formatFindingsReadable(findings)}`,
        messages: [],
      };
    },
  },
];

/** Writer must call this; execute layer only verifies success. */
export const saveProseTool: ToolDefinition = {
  name: "save_prose",
  description:
    "保存完整小说正文到 store（供审查/后续修改读取）。创作或修改完成后必须调用一次。content 必须是完整叙事正文，不能是修改计划或审查清单。",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "完整小说正文（叙事文本全文，不要摘要、不要修改方向列表）",
      },
    },
    required: ["content"],
  },
  execute: async (args, ctx) => {
    const novelId = (ctx as any).novelId as string;
    const branchId = (ctx as any).branchId as string;
    const raw = String(args.content ?? "");
    const previous = getProse(novelId, branchId);
    // Only enforce relative length when overwriting existing valid prose (rewrite path)
    const previousProse =
      previous && previous.length > 500 && !looksLikeFindingsNotProse(previous)
        ? previous
        : undefined;

    const check = validateProseContent(raw, { previousProse });
    if (!check.ok) {
      return {
        content: `${SAVE_PROSE_REJECT_PREFIX}：${check.message}。请修正后再次 save_prose，content 必须是完整小说正文。`,
        messages: [],
      };
    }

    saveProse(novelId, branchId, check.prose);
    return {
      content: `${SAVE_PROSE_OK_PREFIX}（${check.prose.length} 字）。审查 agent 可用 get_prose 读取。`,
      messages: [],
    };
  },
};

export const intermediateTools: ToolDefinition[] = [
  {
    name: "save_outline",
    description: "把生成好的大纲正文存起来供后续 write_prose 获取。生成大纲后必须调用一次，content 参数为大纲全文。",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "大纲正文（结构化文本）" },
      },
      required: ["content"],
    },
    execute: async (args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      saveOutline(novelId, branchId, args.content as string);
      return { content: `大纲已存（${(args.content as string).length} 字）。后续 writer 可用 get_outline 获取。`, messages: [] };
    },
  },
  ...intermediateReadTools.filter(t => t.name === "get_outline"),
  saveProseTool,
  ...intermediateReadTools.filter(t => t.name === "get_prose" || t.name === "get_findings"),
  {
    name: "save_findings",
    description: "把审查发现存起来。一般由执行层自动调用；子 agent 不必主动调。",
    parameters: {
      type: "object",
      properties: {
        dimension: { type: "string", description: "审查维度名（如 character / continuity）" },
        findings: { type: "string", description: "JSON 数组字符串：[{severity,description,suggestion}, ...]" },
      },
      required: ["dimension", "findings"],
    },
    execute: async (args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      let parsed: any[] = [];
      try { parsed = JSON.parse((args.findings as string) || "[]"); } catch { /* keep empty */ }
      saveFindings(novelId, branchId, parsed.map(f => ({
        dimension: args.dimension as string,
        severity: String(f.severity || "minor"),
        description: String(f.description || ""),
        suggestion: String(f.suggestion || ""),
      })));
      return { content: `${args.dimension}: ${parsed.length} findings 已存。`, messages: [] };
    },
  },
  {
    name: "clear_findings",
    description: "清空已存 findings。修改完成下次重审前可调一次。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      clearFindings(novelId, branchId);
      return { content: "已清空 findings。", messages: [] };
    },
  },
];
