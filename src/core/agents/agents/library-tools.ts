import type { ToolDefinition } from "../types";
import { listIdeas, getIdea, listStyles, getStyle } from "@/lib/db";

/** Tools for outline/writer agents to read global style & idea libraries. */
export const libraryTools: ToolDefinition[] = [
  {
    name: "list_ideas",
    description:
      "列出点子库条目。默认只看本书来源；scope=all 时跨书全部。可选 tag 过滤。大纲阶段最多选用 3 条。",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", description: "book（默认，本书）或 all（全局）" },
        tag: { type: "string", description: "可选标签过滤：设定/剧情/角色/冲突/伏笔/氛围/对白" },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const scope = String(args.scope || "book");
      const tag = args.tag ? String(args.tag) : "";
      let ideas = listIdeas(ctx.userId || "guest");
      if (scope !== "all") {
        ideas = ideas.filter(i => i.sourceNovelId === ctx.novelId || !i.sourceNovelId);
      }
      if (tag) ideas = ideas.filter(i => (i.tags || []).some(t => t.includes(tag)));
      const lines = ideas.slice(0, 40).map(
        (i, n) =>
          `${n + 1}. [${i.id}] ${i.title}  tags=${(i.tags || []).join(",") || "-"}  ${i.content.slice(0, 80)}`,
      );
      return {
        content: lines.length
          ? `点子库（${lines.length} 条，最多选 3 条）\n${lines.join("\n")}`
          : "点子库为空。可先分析「点子」模块或人工添加。",
        messages: [],
      };
    },
  },
  {
    name: "get_ideas",
    description: "按 id 获取点子详情。ids 为逗号分隔，最多 3 个。",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "string", description: "点子 id，逗号分隔，最多 3 个" },
      },
      required: ["ids"],
    },
    execute: async (args, ctx) => {
      const ids = String(args.ids || "")
        .split(/[,，\s]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 3);
      const items = ids.map(id => getIdea(ctx.userId || "guest", id)).filter(Boolean);
      if (!items.length) return { content: "未找到点子", messages: [] };
      return {
        content: items
          .map(i => `### ${i!.title}\n标签：${(i!.tags || []).join("、") || "无"}\n${i!.content}`)
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
      let styles = listStyles(ctx.userId || "guest");
      if (scope !== "all") {
        styles = styles.filter(s => s.sourceNovelId === ctx.novelId || !s.sourceNovelId);
      }
      const selected = (ctx as { selectedStyleId?: string | null }).selectedStyleId || "";
      const lines = styles.map((s, n) => {
        const mark = selected && s.id === selected ? " 【当前选用】" : "";
        return `${n + 1}. [${s.id}]${mark} ${s.name} — ${(s.description || s.style?.styleDescription || "").slice(0, 60)}`;
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
      const selected = (ctx as { selectedStyleId?: string | null }).selectedStyleId || "";
      let id =
        !rawId || rawId === "selected" || rawId === "current" || rawId === "选用"
          ? selected
          : rawId;
      if (!id) {
        // Fallback: first style for this novel
        const book = listStyles(ctx.userId || "guest").filter(
          (s) => s.sourceNovelId === ctx.novelId,
        );
        id = book[0]?.id || listStyles(ctx.userId || "guest")[0]?.id || "";
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
