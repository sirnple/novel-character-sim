import type { ToolDefinition } from "../types";
import { listIdeas, getIdea, listStyles, getStyle } from "@/lib/db";
import { getUsedIdeaIds, markIdeasPending } from "../intermediate-store";

/** Tools for outline/writer agents to read global style & idea libraries. */
export const libraryTools: ToolDefinition[] = [
  {
    name: "list_ideas",
    description:
      "列出可用点子。默认 **非本书**（排除本书提取），并排除本分支**已 accept 用过**的点子。" +
      "仅 get/大纲选用不算已用。续写灵感来自跨书/手工；本书用 get_branch_*。" +
      "scope=book|other|all。大纲最多 3 条。",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description:
            "other（默认，非本书）| book（仅本书）| all（全部）",
        },
        tag: {
          type: "string",
          description: "可选标签过滤：设定/剧情/角色/冲突/伏笔/氛围/对白",
        },
        include_used: {
          type: "boolean",
          description:
            "是否包含本分支已 accept 消耗的点子。默认 false。get/大纲暂用的不算已用。",
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const userId = ctx.userId || "guest";
      const novelId = String(ctx.novelId || "").trim();
      const branchId = String(ctx.branchId || "main").trim() || "main";
      // Default: other books / manual — not this novel's extracted restatements
      const scopeRaw = String(args.scope || "other").toLowerCase();
      const scope =
        scopeRaw === "book" || scopeRaw === "all" || scopeRaw === "other"
          ? scopeRaw
          : scopeRaw === "cross" || scopeRaw === "not_book"
            ? "other"
            : "other";
      const tag = args.tag ? String(args.tag) : "";
      const includeUsed = Boolean(args.include_used);

      let ideas = listIdeas(userId);
      if (scope === "book") {
        if (!novelId) {
          return {
            content: "点子库：缺少 novelId，无法按本书过滤。",
            messages: [],
          };
        }
        ideas = ideas.filter((i) => i.sourceNovelId === novelId);
      } else if (scope === "other") {
        // 非本书：其它书来源，或无来源的手工点子（可跨书复用）
        ideas = novelId
          ? ideas.filter((i) => !i.sourceNovelId || i.sourceNovelId !== novelId)
          : ideas;
      }
      // scope=all: keep full list

      if (tag) {
        ideas = ideas.filter((i) =>
          (i.tags || []).some((t) => t.includes(tag)),
        );
      }

      const used = new Set(getUsedIdeaIds(novelId, branchId));
      const usedCount = ideas.filter((i) => used.has(i.id)).length;
      if (!includeUsed && used.size > 0) {
        ideas = ideas.filter((i) => !used.has(i.id));
      }

      const lines = ideas.slice(0, 40).map((i, n) => {
        const fromBook =
          novelId && i.sourceNovelId === novelId
            ? "本书"
            : i.sourceNovelTitle
              ? `来自:${i.sourceNovelTitle}`
              : i.sourceNovelId
                ? `来自:${i.sourceNovelId}`
                : "手工/无来源";
        const usedMark = used.has(i.id) ? " 【已用】" : "";
        return `${n + 1}. [${i.id}]${usedMark} ${i.title}  (${fromBook})  tags=${(i.tags || []).join(",") || "-"}  ${i.content.slice(0, 80)}`;
      });

      const scopeLabel =
        scope === "book" ? "本书" : scope === "all" ? "全部" : "非本书";
      const head =
        `点子库·${scopeLabel}（未用 ${lines.length} 条` +
        (!includeUsed && usedCount ? `，已用隐藏 ${usedCount}` : "") +
        "，最多选 3）";

      return {
        content: lines.length
          ? `${head}\n${lines.join("\n")}`
          : usedCount > 0 && !includeUsed
            ? `${scopeLabel}可用点子已全部用过。` +
              `默认请**自行创作**续写灵感（接前文人物/冲突/伏笔），不要 scope=book 硬挖本书库。` +
              `若确需复用：include_used=true。`
            : scope === "other"
              ? "非本书点子库为空。" +
                "请**自行创作**本轮续写灵感（基于 get_branch_* 的人物/冲突/时间线/伏笔），" +
                "不要用 scope=book 复述原著已有内容。无库可用不是失败。"
              : "点子库为空。请自行创作续写灵感，或先在其它书分析「点子」/手工添加。",
        messages: [],
      };
    },
  },
  {
    name: "get_ideas",
    description:
      "按 id 获取点子详情。ids 逗号分隔，最多 3 个。" +
      "优先 list_ideas 的非本书未消耗 id。取详仅**暂存**本轮候选；" +
      "只有 accept_continuation 成功后才算真正使用。",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "string", description: "点子 id，逗号分隔，最多 3 个" },
      },
      required: ["ids"],
    },
    execute: async (args, ctx) => {
      const userId = ctx.userId || "guest";
      const novelId = String(ctx.novelId || "").trim();
      const branchId = String(ctx.branchId || "main").trim() || "main";
      const ids = String(args.ids || "")
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3);

      const items: {
        id: string;
        title: string;
        content: string;
        tags: string[];
        sourceNovelId: string;
        sourceNovelTitle: string;
        crossBook: boolean;
        alreadyUsed: boolean;
      }[] = [];

      const used = new Set(getUsedIdeaIds(novelId, branchId));
      for (const id of ids) {
        const i = getIdea(userId, id);
        if (!i) continue;
        const crossBook = !!(
          novelId &&
          i.sourceNovelId &&
          i.sourceNovelId !== novelId
        );
        items.push({
          id: i.id,
          title: i.title,
          content: i.content,
          tags: i.tags || [],
          sourceNovelId: i.sourceNovelId || "",
          sourceNovelTitle: i.sourceNovelTitle || "",
          crossBook,
          alreadyUsed: used.has(i.id),
        });
      }

      if (!items.length) {
        return { content: "未找到点子（检查 id 是否来自 list_ideas）。", messages: [] };
      }

      // Stage only — committed on accept_continuation
      markIdeasPending(
        novelId,
        branchId,
        items.map((i) => i.id),
      );

      return {
        content: items
          .map((i) => {
            const fromThisBook = !!(novelId && i.sourceNovelId === novelId);
            const src = fromThisBook
              ? "本书（易与原文重复，续写慎用）"
              : i.crossBook
                ? `非本书·${i.sourceNovelTitle || i.sourceNovelId}`
                : "手工/无来源（可跨书复用）";
            const flags = [
              i.alreadyUsed ? "此前已用" : "",
              fromThisBook ? "本书来源" : "",
            ]
              .filter(Boolean)
              .join("；");
            return (
              `### ${i.title}\n` +
              `id: ${i.id}\n` +
              `来源：${src}${flags ? `（${flags}）` : ""}\n` +
              `标签：${i.tags.join("、") || "无"}\n` +
              i.content
            );
          })
          .join("\n\n"),
        messages: [],
      };
    },
  },
  {
    name: "list_styles",
    description:
      "列出文笔库（可跨书嫁接的语言肌理，非形态章法）。默认本书来源；scope=all 看全部。" +
      "写作/风格审查前可先 list 再 get_style。若用户已选用风格，列表会标注【当前选用】。",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", description: "book 或 all" },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const scope = String(args.scope || "book");
      const novelId = String(ctx.novelId || "").trim();
      let styles =
        scope === "all" || !novelId
          ? listStyles(ctx.userId || "guest")
          : listStyles(ctx.userId || "guest", { sourceNovelId: novelId });
      // legacy: empty source manual styles only under scope=all
      if (scope !== "all" && novelId) {
        styles = styles.filter((s) => s.sourceNovelId === novelId);
      }
      const selected =
        (ctx as { selectedStyleId?: string | null }).selectedStyleId || "";
      const lines = styles.map((s, n) => {
        const mark = selected && s.id === selected ? " 【当前选用】" : "";
        const from =
          novelId && s.sourceNovelId === novelId
            ? "本书"
            : s.sourceNovelTitle || s.sourceNovelId || "无来源";
        return `${n + 1}. [${s.id}]${mark} ${s.name} (${from}) — ${(s.description || s.style?.styleDescription || "").slice(0, 60)}`;
      });
      const hint = selected
        ? `\n用户已选用 styleId=${selected}，请 get_style(id="${selected}") 取完整说明书。`
        : "\n未预选风格时：可 list 后选一条 get_style，或 scope=all 跨书选取。";
      return {
        content: lines.length
          ? `文笔库\n${lines.join("\n")}${hint}`
          : "文笔库为空。可分析「文笔」模块。",
        messages: [],
      };
    },
  },
  {
    name: "get_style",
    description:
      "获取一条文笔的完整说明书（句式/语气/节奏/范例）。" +
      "id 可省略或填 selected：使用用户当前选用的风格；也可传 list_styles 返回的 id。",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "风格 id；空 / selected / current = 用户当前选用",
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const rawId = String(args.id || "").trim();
      const selected =
        (ctx as { selectedStyleId?: string | null }).selectedStyleId || "";
      let id =
        !rawId ||
        rawId === "selected" ||
        rawId === "current" ||
        rawId === "选用"
          ? selected
          : rawId;
      if (!id) {
        const book = listStyles(ctx.userId || "guest").filter(
          (s) => s.sourceNovelId === ctx.novelId,
        );
        id =
          book[0]?.id || listStyles(ctx.userId || "guest")[0]?.id || "";
      }
      if (!id) {
        return {
          content:
            "未找到风格：用户未选用且文笔库为空。可 list_styles 查看，或先完成「文笔」分析。",
          messages: [],
        };
      }
      const s = getStyle(ctx.userId || "guest", id);
      if (!s) return { content: `风格不存在：${id}`, messages: [] };
      const st = s.style;
      return {
        content: [
          `# ${s.name}`,
          `id: ${s.id}`,
          selected && s.id === selected ? "（用户当前选用）" : "",
          s.description,
          `类型：${st.genre || ""}`,
          `文风：${st.styleDescription || ""}`,
          `基调：${st.tone || ""}`,
          `语言：${st.languageFeatures || ""}`,
          `节奏：${st.pacingDescription || ""}`,
          `手法：${(st.narrativeTechniques || []).join("、")}`,
          st.examplePassages?.length
            ? `范例：\n${st.examplePassages.map((p) => `【${p.aspect}】${(p.text || "").slice(0, 200)}`).join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        messages: [],
      };
    },
  },
];
