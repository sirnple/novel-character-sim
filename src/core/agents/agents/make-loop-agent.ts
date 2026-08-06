/**
 * Factory for analysis-style sub-agents:
 * system prompt = how to work + must store via tools;
 * user prompt = only novelId / branchId (no how-to);
 * after loop, require submit tool success (same idea as writer save_prose).
 */
import type { Agent, TrailMessage, ToolDefinition } from "../types";
import type { ToolSchema } from "@/types";
import { resolveAgentPrompt } from "@/core/prompts/resolve-agent-prompt";
import { requireAgentConfigBySystem } from "../agent-config";
import { runSubAgentToolLoop } from "../tool-loop";
import { toolSaveSucceeded } from "../save-verify";
import { agentLabel, toolLabel } from "@/lib/tool-labels";
import { writeTargetUserPrompt } from "../write-target";

export interface LoopAgentOptions {
  /**
   * System md filename (e.g. `form-system.md`).
   * Config + `name` are loaded from that file's frontmatter.
   */
  system: string;
  tools: ToolDefinition[];
  /** Tool name that must succeed (like save_prose) */
  submitTool: string;
  /** Substring in tool result for success */
  okMarker: string;
  maxSteps?: number;
  maxTokens?: number;
  temperature?: number;
  language?: "zh" | "en";
}

function toSchemas(tools: ToolDefinition[]): ToolSchema[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as Record<string, unknown>,
  }));
}

/** Minimal user message: analysis / write target only */
export function analysisTargetUserPrompt(novelId: string, branchId: string): string {
  return writeTargetUserPrompt(novelId, branchId);
}

/** Build an Agent from system md path + tool list. */
export function makeLoopAgent(opts: LoopAgentOptions): Agent {
  const config = requireAgentConfigBySystem(opts.system);
  const tools = toSchemas(opts.tools);
  const agentName = config.name;

  return {
    config,
    execute: async (ctx, llm, onChunk, onTrail) => {
      const lang = opts.language || "zh";
      const branchId = ctx.branchId || "main";

      const { system: sys, user: templateUser } = resolveAgentPrompt(
        agentName,
        lang,
        {
          novelId: ctx.novelId,
          branchId,
          // prompt intentionally not used for how-to; master may pass unused text
          prompt: "",
        },
      );

      // Prefer short md user template if present; never inject master how-to
      const uc =
        (templateUser && templateUser.trim()) ||
        analysisTargetUserPrompt(ctx.novelId, branchId);

      const zhName =
        (config.description && config.description.trim()) ||
        agentLabel(agentName);
      const zhTool = toolLabel(opts.submitTool);
      const system =
        sys ||
        `你是「${zhName}」。请分析小说，并用工具「${zhTool}」（${opts.submitTool}）落盘结果。`;

      const run = (user: string) =>
        runSubAgentToolLoop(llm, system, user, tools, ctx, onChunk, onTrail, {
          maxTokens: opts.maxTokens ?? 8192,
          temperature: opts.temperature ?? 0.3,
          maxSteps: opts.maxSteps ?? 20,
        });

      let loop = await run(uc);
      let trail = loop.trail;
      let saved = toolSaveSucceeded(trail, opts.submitTool, opts.okMarker);

      // Same pattern as writer missing save_prose: one forced retry
      if (!saved.ok) {
        const retryHint =
          opts.submitTool === "submit_character_entities"
            ? `（系统）你尚未成功「${zhTool}」。` +
              `若已扫名：禁止再 scan_character_mentions；` +
              `双挂/异名用 ops merge 或 resolve_cross_name_pair(distinct|uncertain)，再 submit。`
            : `（系统）你尚未成功调用「${zhTool}」（${opts.submitTool}）。请立即调用该工具存储结果。`;
        const retryUc = `${uc}\n\n${retryHint}`;
        const second = await run(retryUc);
        trail = trail.concat(
          {
            role: "assistant",
            content: `（系统：请调用「${zhTool}」）`,
          } as TrailMessage,
          ...second.trail.filter((m) => m.role !== "system"),
        );
        saved = toolSaveSucceeded(trail, opts.submitTool, opts.okMarker);
      }

      if (!saved.ok) {
        return {
          content: `「${zhName}」失败：未成功「${zhTool}」（${saved.detail || "未调用"}）`,
          messages: trail,
        };
      }
      return {
        content: `「${zhName}」完成：${saved.detail.slice(0, 200)}`,
        messages: trail,
      };
    },
  };
}

/** Register tool schemas only if tools already in global registry (execute via getTool). */
export function schemasFromRegistered(names: string[], all: ToolDefinition[]): ToolSchema[] {
  const set = new Set(names);
  return toSchemas(all.filter((t) => set.has(t.name)));
}
