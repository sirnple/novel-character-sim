/**
 * Factory for analysis-style sub-agents:
 * system prompt = how to work + must store via tools;
 * user prompt = only novelId / branchId (no how-to);
 * after loop, require submit tool success (same idea as writer save_prose).
 */
import type { AgentDef, TrailMessage, ToolDefinition } from "../types";
import type { ToolSchema } from "@/types";
import { resolveAgentPrompt } from "@/core/prompts/resolve-agent-prompt";
import { runSubAgentToolLoop } from "../tool-loop";
import { toolSaveSucceeded } from "../save-verify";

export interface LoopAgentOptions {
  /** resolveAgentPrompt agentId */
  agentId: string;
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

/** Minimal user message: analysis target only */
export function analysisTargetUserPrompt(novelId: string, branchId: string): string {
  return `novelId=${novelId}\nbranchId=${branchId || "main"}`;
}

export function makeLoopAgent(opts: LoopAgentOptions): AgentDef {
  const tools = toSchemas(opts.tools);
  return {
    execute: async (ctx, llm, onChunk, onTrail) => {
      const lang = opts.language || "zh";
      const branchId = ctx.branchId || "main";
      const { system: sys, user: templateUser } = resolveAgentPrompt(
        opts.agentId,
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

      const system =
        sys ||
        `You are ${opts.agentId}. Analyze the novel, then store results with tool ${opts.submitTool}.`;

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
            ? `（系统）你尚未成功 ${opts.submitTool}。` +
              `若已 scan 过：禁止再 scan_character_mentions；` +
              `按上次「未写入」：双挂/异名用 ops merge 或 resolve_cross_name_pair(distinct|uncertain)，再 submit。`
            : `（系统）你尚未成功调用 ${opts.submitTool}。请立即调用该工具存储结果。`;
        const retryUc = `${uc}\n\n${retryHint}`;
        const second = await run(retryUc);
        trail = trail.concat(
          {
            role: "assistant",
            content: `（系统：请调用 ${opts.submitTool}）`,
          } as TrailMessage,
          ...second.trail.filter((m) => m.role !== "system"),
        );
        saved = toolSaveSucceeded(trail, opts.submitTool, opts.okMarker);
      }

      if (!saved.ok) {
        return {
          content: `${opts.agentId} 失败：未成功 ${opts.submitTool}（${saved.detail || "未调用"}）`,
          messages: trail,
        };
      }
      return {
        content: `${opts.agentId} 完成：${saved.detail.slice(0, 200)}`,
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
