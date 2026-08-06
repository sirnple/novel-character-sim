/**
 * Continuation character intro: introduce_character → save_character
 * (async relationship fill) → accept merges into novel character list.
 */
import type { ToolDefinition } from "../types";
import type { CharacterProfile, Relationship } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { extractJSON, generateId } from "@/lib/utils";
import { getCharacters, saveCharacters } from "@/lib/db";
import {
  applyRelationshipEdges,
  mergeCharacterProfiles,
  nameKey,
} from "../character-draft-utils";
import {
  getLastIntroducedCharacter,
  getPendingCharacters,
  savePendingCharacter,
  setLastIntroducedCharacter,
  setCharacterRelJob,
  updatePendingCharacter,
  resolveStoreIds,
} from "../intermediate-store";

export const SAVE_CHARACTER_OK = "角色已暂存";
export const INTRODUCE_CHARACTER_OK = "角色方案已生成";

function emptyProfile(name: string): CharacterProfile {
  return {
    id: `intro_${generateId()}`,
    name: name.trim(),
    aliases: [],
    appearance: { summary: "" },
    personality: {
      traits: [],
      description: "",
      decisionStyle: "",
      underPressure: "",
    },
    drive: {
      goal: "",
      motivation: "",
      fear: "",
      weakness: "",
      bottomLine: "",
      secret: "",
    },
    behavior: { patterns: [], habits: [], attitudeToAuthority: "" },
    worldview: "",
    values: [],
    speakingStyle: {
      description: "",
      catchphrases: [],
      sentenceStyle: "",
      vocabulary: "",
      emotionalExpression: "",
    },
    voice: { description: "" },
    background: { origin: "", keyEvents: [], description: "" },
    relationships: [],
  };
}

function castSummary(
  chars: CharacterProfile[],
  max = 24,
): string {
  return chars
    .slice(0, max)
    .map((c) => {
      const goal = c.drive?.goal || "";
      const pers = c.personality?.description || c.personality?.traits?.join("、") || "";
      return `- ${c.name}${goal ? `｜目标:${goal.slice(0, 40)}` : ""}${pers ? `｜${pers.slice(0, 50)}` : ""}`;
    })
    .join("\n");
}

function normalizeProfile(raw: any, fallbackName?: string): CharacterProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || fallbackName || "").trim();
  if (!name || name.length < 1) return null;
  const base = emptyProfile(name);
  const id = String(raw.id || "").trim() || base.id;
  const merged = mergeCharacterProfiles(base, {
    ...raw,
    id,
    name,
    aliases: Array.isArray(raw.aliases) ? raw.aliases.map(String) : base.aliases,
    relationships: Array.isArray(raw.relationships) ? raw.relationships : [],
  });
  return { ...merged, id, name };
}

function formatProfileReadable(
  p: CharacterProfile,
  meta?: Record<string, string>,
): string {
  const lines = [
    `### ${p.name}`,
    `id: ${p.id}`,
    p.appearance?.summary ? `外貌：${p.appearance.summary}` : "",
    p.personality?.description
      ? `性格：${p.personality.description}`
      : p.personality?.traits?.length
        ? `性格特质：${p.personality.traits.join("、")}`
        : "",
    p.drive?.goal ? `目标：${p.drive.goal}` : "",
    p.drive?.motivation ? `动机：${p.drive.motivation}` : "",
    p.background?.origin || p.background?.description
      ? `背景：${p.background.description || p.background.origin}`
      : "",
    p.speakingStyle?.description
      ? `说话：${p.speakingStyle.description}`
      : "",
  ];
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (v) lines.push(`${k}：${v}`);
    }
  }
  return lines.filter(Boolean).join("\n");
}

async function runRelationshipJob(opts: {
  userId: string;
  novelId: string;
  branchId: string;
  characterId: string;
}): Promise<void> {
  const { userId, novelId, branchId, characterId } = opts;
  try {
    const pending = getPendingCharacters(novelId, branchId);
    const target = pending.find((c) => c.id === characterId);
    if (!target) return;

    const existing = getCharacters(userId, novelId) || [];
    const others = [
      ...existing,
      ...pending.filter((c) => c.id !== characterId),
    ];
    if (!others.length) {
      console.log(
        `[save_character] skip rel job ${characterId}: no other cast`,
      );
      return;
    }

    const llm = createLLMProvider("analysis");
    const sys = `你是小说角色关系编辑。根据已有角色与新角色设定，给出有向关系边 JSON。
只输出 JSON：
{"edges":[{"from":"姓名","to":"姓名","type":"关系类型","symmetry":"unidirectional|bidirectional|asymmetric","description":"简述","history":"","dynamics":""}]}
要求：
- 至少包含新角色与其关键对象的双向或有向边
- 不要编造未出现的人名
- type 用简短中文（如 对立/盟友/上下级/暧昧/亲属）`;

    const user =
      `新角色：\n${formatProfileReadable(target)}\n\n` +
      `已有角色：\n${castSummary(others)}\n\n` +
      `请给出与新角色相关的关系边（优先与剧情功能相关的人）。`;

    const raw = await llm.chat(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      { temperature: 0.3, maxTokens: 2048 },
    );
    const parsed = extractJSON<{ edges?: any[] }>(
      typeof raw === "string" ? raw : String((raw as any)?.content || raw),
    );
    const edges = Array.isArray(parsed?.edges) ? parsed!.edges! : [];
    if (!edges.length) {
      console.warn(`[save_character] rel job empty edges for ${target.name}`);
      return;
    }

    // Refresh latest pending + apply edges onto a working cast copy
    const latestPending = getPendingCharacters(novelId, branchId);
    const latestTarget = latestPending.find((c) => c.id === characterId);
    if (!latestTarget) return;

    const working: CharacterProfile[] = [
      ...existing.map((c) => ({
        ...c,
        relationships: [...(c.relationships || [])],
      })),
      ...latestPending.map((c) => ({
        ...c,
        relationships: [...(c.relationships || [])],
      })),
    ];
    const { chars: updated, applied } = applyRelationshipEdges(working, edges);
    console.log(
      `[save_character] rel job ${target.name}: applied ${applied} edges`,
    );

    // Write back only pending characters (existing DB cast updates on accept)
    for (const p of latestPending) {
      const u = updated.find(
        (c) => nameKey(c.name) === nameKey(p.name) || c.id === p.id,
      );
      if (u) updatePendingCharacter(novelId, branchId, u);
    }

    // Stash edges that touch existing DB characters onto pending new char is enough;
    // on accept we re-apply edges from pending.relationships + reverse from pending to existing.
  } catch (e) {
    console.warn(
      `[save_character] rel job failed:`,
      (e as Error).message || e,
    );
  }
}

export const characterIntroTools: ToolDefinition[] = [
  {
    name: "introduce_character",
    description:
      "按大纲角色扩展需求生成新角色方案（未落库）。" +
      "参数含进入原因/剧情功能/冲突/关联角色等。返回可读方案；采用后须 save_character。",
    parameters: {
      type: "object",
      properties: {
        enter_reason: { type: "string", description: "进入原因" },
        plot_function: { type: "string", description: "剧情功能" },
        conflict: { type: "string", description: "服务的冲突" },
        related_character: {
          type: "string",
          description: "与哪个已有角色产生关系",
        },
        expected_duration: {
          type: "string",
          description: "预计存在时间（如 3章 / 本卷）",
        },
        is_long_term: {
          type: "boolean",
          description: "是否长期角色",
        },
        notes: {
          type: "string",
          description: "可选补充（名字倾向、禁忌等）",
        },
      },
      required: [
        "enter_reason",
        "plot_function",
        "conflict",
        "related_character",
      ],
    },
    execute: async (args, ctx, llm) => {
      const { novelId, branchId } = resolveStoreIds(args as any, ctx as any);
      const userId = ctx.userId || "guest";
      if (!novelId) {
        return { content: "introduce_character 失败：缺少 novelId", messages: [] };
      }

      const enter_reason = String(args.enter_reason || "").trim();
      const plot_function = String(args.plot_function || "").trim();
      const conflict = String(args.conflict || "").trim();
      const related_character = String(args.related_character || "").trim();
      const expected_duration = String(args.expected_duration || "").trim();
      const is_long_term = Boolean(args.is_long_term);
      const notes = String(args.notes || "").trim();

      if (!enter_reason || !plot_function || !conflict || !related_character) {
        return {
          content:
            "introduce_character 失败：需要 enter_reason / plot_function / conflict / related_character。",
          messages: [],
        };
      }

      const existing = getCharacters(userId, novelId) || [];
      const pending = getPendingCharacters(novelId, branchId);
      const cast = [...existing, ...pending];

      const provider = llm || createLLMProvider("write");
      const sys = `你是小说新角色设计师。根据续写需求设计**一个**新角色，贴合已有世界观与人物生态。
只输出 JSON（不要 markdown 围栏）：
{
  "name": "姓名",
  "aliases": [],
  "appearance": {"summary": "..."},
  "personality": {"traits": [], "description": "...", "decisionStyle": "...", "underPressure": "..."},
  "drive": {"goal": "...", "motivation": "...", "fear": "...", "weakness": "...", "bottomLine": "...", "secret": "..."},
  "behavior": {"patterns": [], "habits": [], "attitudeToAuthority": "..."},
  "worldview": "...",
  "values": [],
  "speakingStyle": {"description": "...", "catchphrases": [], "sentenceStyle": "...", "vocabulary": "...", "emotionalExpression": "..."},
  "background": {"origin": "...", "keyEvents": [], "description": "..."},
  "introMeta": {
    "enter_reason": "...",
    "plot_function": "...",
    "conflict": "...",
    "related_character": "...",
    "expected_duration": "...",
    "is_long_term": false
  }
}
禁止工具人：要有独立目标；与 related_character 有利益冲突；能影响后续多章。`;

      const user =
        `## 角色需求\n` +
        `- 进入原因：${enter_reason}\n` +
        `- 剧情功能：${plot_function}\n` +
        `- 服务的冲突：${conflict}\n` +
        `- 关联角色：${related_character}\n` +
        `- 预计存在：${expected_duration || "未指定"}\n` +
        `- 长期角色：${is_long_term ? "是" : "否"}\n` +
        (notes ? `- 补充：${notes}\n` : "") +
        `\n## 已有角色\n${castSummary(cast) || "（暂无）"}\n`;

      let rawText = "";
      try {
        const res = await provider.chat(
          [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          { temperature: 0.55, maxTokens: 4096 },
        );
        rawText =
          typeof res === "string"
            ? res
            : String((res as any)?.content ?? res ?? "");
      } catch (e) {
        return {
          content: `introduce_character 失败：LLM ${(e as Error).message}`,
          messages: [],
        };
      }

      let profile: CharacterProfile | null = null;
      try {
        const parsed = extractJSON<any>(rawText);
        profile = normalizeProfile(parsed);
      } catch {
        profile = null;
      }
      if (!profile) {
        return {
          content:
            "introduce_character 失败：无法解析角色 JSON。请重试或简化需求。",
          messages: [],
        };
      }

      // Stamp intro meta into background if empty
      if (!profile.background?.description) {
        profile.background = {
          ...profile.background,
          description: `进入原因：${enter_reason}；功能：${plot_function}；冲突：${conflict}`,
        };
      }

      setLastIntroducedCharacter(novelId, branchId, profile);

      const meta = {
        进入原因: enter_reason,
        剧情功能: plot_function,
        服务冲突: conflict,
        关联角色: related_character,
        预计存在: expected_duration || "—",
        长期: is_long_term ? "是" : "否",
      };

      return {
        content:
          `${INTRODUCE_CHARACTER_OK}\n\n` +
          formatProfileReadable(profile, meta) +
          `\n\n请评估：符合剧情？改方向？功能重复？\n` +
          `决定采用 → 调用 **save_character**（可改 name/字段；默认保存本方案）。\n` +
          `决定放弃 → 勿 save_character。`,
        messages: [],
      };
    },
  },
  {
    name: "save_character",
    description:
      "将新角色暂存到本轮续写（未写入小说库）。" +
      "默认保存最近一次 introduce_character 方案；也可传 profile JSON 覆盖。" +
      "保存后异步计算人物关系；accept 接受续写时再合并进人物列表与关系。",
    parameters: {
      type: "object",
      properties: {
        profile: {
          type: "string",
          description:
            "可选。完整角色 JSON 字符串；省略则用最近 introduce_character 方案",
        },
        name: {
          type: "string",
          description: "可选。仅改名时用（基于最近方案）",
        },
      },
      required: [],
    },
    execute: async (args, ctx) => {
      const { novelId, branchId } = resolveStoreIds(args as any, ctx as any);
      const userId = ctx.userId || "guest";
      if (!novelId) {
        return { content: "save_character 失败：缺少 novelId", messages: [] };
      }

      let profile: CharacterProfile | null = null;
      const profileRaw = args.profile;
      if (typeof profileRaw === "string" && profileRaw.trim()) {
        try {
          profile = normalizeProfile(extractJSON(profileRaw));
        } catch {
          try {
            profile = normalizeProfile(JSON.parse(profileRaw));
          } catch {
            profile = null;
          }
        }
      } else if (profileRaw && typeof profileRaw === "object") {
        profile = normalizeProfile(profileRaw);
      }

      if (!profile) {
        const last = getLastIntroducedCharacter(novelId, branchId);
        if (last) {
          profile = { ...last, relationships: [...(last.relationships || [])] };
          const rename = String(args.name || "").trim();
          if (rename) profile = { ...profile, name: rename };
        }
      }

      if (!profile?.name) {
        return {
          content:
            "save_character 失败：无可用角色。请先 introduce_character，或传 profile JSON。",
          messages: [],
        };
      }

      // Avoid duplicate names against DB cast (allow overwrite pending)
      const existing = getCharacters(userId, novelId) || [];
      if (
        existing.some((c) => nameKey(c.name) === nameKey(profile!.name))
      ) {
        return {
          content: `save_character 失败：小说库已有同名角色「${profile.name}」。请换名或修改已有档案。`,
          messages: [],
        };
      }

      savePendingCharacter(novelId, branchId, profile);

      // Async relationship computation
      const job = runRelationshipJob({
        userId,
        novelId,
        branchId,
        characterId: profile.id,
      });
      setCharacterRelJob(novelId, branchId, profile.id, job);

      const n = getPendingCharacters(novelId, branchId).length;
      return {
        content:
          `${SAVE_CHARACTER_OK}：${profile.name}（id=${profile.id}）。` +
          `本轮暂存 ${n} 人；人物关系**异步计算中**。` +
          `accept_continuation 接受续写时写入小说人物列表与关系。`,
        messages: [],
      };
    },
  },
];

/**
 * Merge pending intro characters into DB cast (relationships applied).
 * Call from accept_continuation after awaiting rel jobs.
 */
export function commitPendingCharactersToNovel(
  userId: string,
  novelId: string,
  branchId: string,
): { added: number; total: number; names: string[] } {
  const pending = getPendingCharacters(novelId, branchId);
  if (!pending.length) {
    return { added: 0, total: (getCharacters(userId, novelId) || []).length, names: [] };
  }

  const existing = getCharacters(userId, novelId) || [];
  const byKey = new Map(existing.map((c) => [nameKey(c.name), { ...c }]));

  const names: string[] = [];
  for (const p of pending) {
    const k = nameKey(p.name);
    if (!k) continue;
    if (byKey.has(k)) {
      // merge richer pending onto existing
      byKey.set(k, mergeCharacterProfiles(byKey.get(k)!, p));
    } else {
      byKey.set(k, { ...p });
      names.push(p.name);
    }

    // Apply pending.relationships onto owner + ensure characterId
    const owner = byKey.get(k)!;
    const rels: Relationship[] = [];
    for (const r of p.relationships || []) {
      const target = byKey.get(nameKey(r.characterName));
      rels.push({
        ...r,
        characterId: target?.id || r.characterId || "",
        characterName: target?.name || r.characterName,
      });
    }
    // merge rels
    if (!owner.relationships) owner.relationships = [];
    for (const r of rels) {
      const exists = owner.relationships.some(
        (x) =>
          nameKey(x.characterName) === nameKey(r.characterName) &&
          x.type === r.type,
      );
      if (!exists) owner.relationships.push(r);
    }

    // Reverse edges: if pending listed relation to existing, add reverse stub if missing
    for (const r of rels) {
      const tk = nameKey(r.characterName);
      const other = byKey.get(tk);
      if (!other || other.id === owner.id) continue;
      if (!other.relationships) other.relationships = [];
      const hasBack = other.relationships.some(
        (x) => nameKey(x.characterName) === nameKey(owner.name),
      );
      if (!hasBack && (r.symmetry === "bidirectional" || r.symmetry === "asymmetric")) {
        other.relationships.push({
          characterId: owner.id,
          characterName: owner.name,
          type: r.reverseType || r.type,
          symmetry: r.symmetry,
          description: r.description || `与${owner.name}的关系`,
          history: r.history || "",
          dynamics: r.dynamics || "",
        });
      }
    }
  }

  const merged = Array.from(byKey.values());
  saveCharacters(userId, novelId, merged);

  return { added: names.length, total: merged.length, names };
}
