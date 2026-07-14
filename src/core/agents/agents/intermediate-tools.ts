import type { ToolDefinition } from "../types";
import {
  saveOutline, getOutline, saveProse, getProse,
  saveFindings, getFindings, clearFindings,
} from "../intermediate-store";

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
  {
    name: "get_outline",
    description: "获取已经存好的大纲正文。writer 写正文前必须先 get_outline 拿到轮廓。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      const o = getOutline(novelId, branchId);
      return { content: o ? (o as string) : "大纲未生成", messages: [] };
    },
  },
  {
    name: "save_prose",
    description: "把当前正文存起来供审查员读取。写完或改完一段正文后必须调用一次。content 参数为完整正文。",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "完整 prose 正文" },
      },
      required: ["content"],
    },
    execute: async (args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      saveProse(novelId, branchId, args.content as string);
      return { content: `正文已存（${(args.content as string).length} 字）。`, messages: [] };
    },
  },
  {
    name: "get_prose",
    description: "获取要被审/改的当前正文。审查员 review_* 与修改模式 writer 必读。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      const p = getProse(novelId, branchId);
      return { content: p || "正文未生成", messages: [] };
    },
  },
  {
    name: "save_findings",
    description: "把审查发现存起来供 writer 修改时参考。每个 review_* 完成后必须调用一次。findings 参数为 JSON 数组字符串[{severity,description,suggestion},...]。",
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
    name: "get_findings",
    description: "获取所有审查维度的累积 findings。writer 修改模式必须先调它拿问题清单。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      return { content: JSON.stringify(getFindings(novelId, branchId), null, 2), messages: [] };
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
