import type { TrailMessage } from "../types";
import { defineAgent } from "../agent-registry";
import {
  resolveAgentPrompt,
  resolveAgentToolSchemas,
} from "@/core/prompts/resolve-agent-prompt";
import { writeTargetUserPrompt } from "../write-target";
import { runSubAgentToolLoop } from "../tool-loop";
import { getChapterTitle, getProse } from "../intermediate-store";
import { SAVE_CHAPTER_TITLE_OK } from "./intermediate-tools";
import { toolSaveSucceeded } from "../save-verify";
import { getNovelForm, getBranchChapterMeta } from "@/lib/db";
import { buildFormAgentContext } from "@/core/form/form-context";

/**
 * Generate chapter title from finished prose (not from outline).
 * Skips when book form has chaptering disabled.
 */
export const chapterTitleAgent = defineAgent(
  "chapter_title_generator.md",
  (config) => {
    const name = config.name;
    return async (ctx, llm, onChunk, onTrail) => {
      const form = getNovelForm(ctx.userId, ctx.novelId);
      const meta = getBranchChapterMeta(ctx.userId, ctx.novelId, ctx.branchId);
      const formCtx = buildFormAgentContext({
        form,
        chapterMeta: meta,
        novelId: ctx.novelId,
        branchId: ctx.branchId,
      });

      if (formCtx.forbidInventChapterTitles || !formCtx.chapteringEnabled) {
        return {
          content:
            "本书弱分章/不分章：跳过章名生成（accept 不会写入标题行）。",
          messages: [],
        };
      }

      const prose = (getProse(ctx.novelId, ctx.branchId) || "").trim();
      if (prose.length < 50) {
        return {
          content:
            "章名生成失败：store 中无可用正文（请先 writer 并 save_prose）。",
          messages: [],
        };
      }

      const tools = resolveAgentToolSchemas(name);
      // User message = session binding only; how-to in system md
      const { system: sys } = resolveAgentPrompt(name, "zh", {
        novelId: ctx.novelId,
        branchId: ctx.branchId,
      });

      const samples = formCtx.chapterTitleSamples.slice(0, 6).join(" / ") || "（无）";
      const catalogTail = formCtx.catalogTail
        .slice(-6)
        .map((c) => c.title)
        .filter(Boolean)
        .join(" → ");

      // Store / form snapshots only (agent can still get_prose / get_novel_form)
      const inject =
        "\n\n## 上下文快照\n" +
        `- 分章：开启；样例：${samples}\n` +
        (formCtx.titlePattern ? `- titlePattern: ${formCtx.titlePattern}\n` : "") +
        (catalogTail ? `- 近章标题：${catalogTail}\n` : "") +
        `- 正文草稿：${prose.length} 字\n\n` +
        "### 正文节选（开头 2k + 结尾 2k）\n```\n" +
        (prose.length <= 4500
          ? prose
          : prose.slice(0, 2000) +
            "\n…\n" +
            prose.slice(-2000)) +
        "\n```\n";

      const uc = writeTargetUserPrompt(ctx.novelId, ctx.branchId) + inject;

      const run = (user: string) =>
        runSubAgentToolLoop(llm, sys, user, tools, ctx, onChunk, onTrail, {
          maxTokens: 4096,
          temperature: 0.4,
          maxSteps: 8,
          stopOnToolSuccess: {
            toolName: "save_chapter_title",
            okMarker: SAVE_CHAPTER_TITLE_OK,
          },
        });

      let loop = await run(uc);
      if (loop.askUser) {
        return {
          content: loop.finalText || "关键数据缺失，已询问用户。",
          messages: loop.trail,
          askUser: loop.askUser,
        };
      }
      let { trail } = loop;
      let saved = toolSaveSucceeded(
        trail,
        "save_chapter_title",
        SAVE_CHAPTER_TITLE_OK,
      );

      if (!saved.ok) {
        const retryUc =
          uc +
          "\n\n## 系统纠错\n请立刻 save_chapter_title，参数 final_title 为完整标题行。";
        const second = await run(retryUc);
        trail = trail.concat(
          {
            role: "assistant",
            content: "（系统：请 save_chapter_title）",
          } as TrailMessage,
          ...second.trail.filter((m) => m.role !== "system"),
        );
        saved = toolSaveSucceeded(
          trail,
          "save_chapter_title",
          SAVE_CHAPTER_TITLE_OK,
        );
      }

      const draft = getChapterTitle(ctx.novelId, ctx.branchId);
      if (!saved.ok || !draft?.final_title) {
        return {
          content: `章名生成失败：未成功 save_chapter_title（${saved.detail || "未调用"}）。`,
          messages: trail,
        };
      }

      return {
        content:
          `章名已生成并 save_chapter_title：${draft.final_title}` +
          (draft.alternatives?.length
            ? `（候选 ${draft.alternatives.length}）`
            : "") +
          "。主 agent 可 accept；程序会把标题行写入新开章草稿。",
        messages: trail,
      };
    };
  },
);
