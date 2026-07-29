/**
 * Mention kind taxonomy for stage-① extract → stage-③ coref.
 *
 * LLM is asked to label each mention; rules fill gaps / override high-confidence
 * patterns (deictics, generic epithets, kinship, titles).
 */

export const MENTION_KINDS = [
  "proper",
  "personal_nick",
  "generic",
  "kinship",
  "title",
  "deictic",
  "desc",
] as const;

export type MentionKind = (typeof MENTION_KINDS)[number];

/** Strong identity signal for coref (shared → positive; exclusive pairs matter). */
export function isIdentityStrongKind(k: MentionKind): boolean {
  return k === "proper" || k === "personal_nick";
}

/**
 * Mentions only useful during coref / extract analysis — never show as UI aliases.
 * (我/他、瘦瘦的小孩、那人 等)
 */
export function isAnalysisOnlyMentionKind(k: MentionKind): boolean {
  return k === "deictic" || k === "desc" || k === "generic";
}

/** Surface kinds ok for roster alias / page display. */
export function isDisplayAliasKind(k: MentionKind): boolean {
  return !isAnalysisOnlyMentionKind(k);
}

/**
 * Filter aliases for UI / roster display.
 * Prefer per-mention `kind` when provided; else rule-based resolveMentionKind.
 */
export function filterDisplayAliases(
  aliases: string[],
  mentions?: Array<{ surface?: string; kind?: MentionKind | string | null }>,
): string[] {
  const kindBySurface = new Map<string, MentionKind>();
  for (const m of mentions || []) {
    const s = (m.surface || "").trim().replace(/\s+/g, " ");
    if (!s) continue;
    const parsed = parseMentionKind(m.kind);
    if (parsed) {
      const prev = kindBySurface.get(s);
      kindBySurface.set(s, prev ? preferMentionKind(prev, parsed) : parsed);
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of aliases || []) {
    const s = (raw || "").trim().replace(/\s+/g, " ");
    if (!s || seen.has(s)) continue;
    const k = kindBySurface.get(s) || resolveMentionKind(s);
    if (!isDisplayAliasKind(k)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** True personal name — exclusive clash is strongest "different people" signal. */
export function isProperKind(k: MentionKind): boolean {
  return k === "proper";
}

export function isDeicticKind(k: MentionKind): boolean {
  return k === "deictic";
}

const KIND_RANK: Record<MentionKind, number> = {
  proper: 70,
  personal_nick: 60,
  title: 40,
  kinship: 35,
  desc: 30,
  generic: 20,
  deictic: 10,
};

/** Prefer higher-identity kind when the same surface is tagged inconsistently. */
export function preferMentionKind(a: MentionKind, b: MentionKind): MentionKind {
  return KIND_RANK[a] >= KIND_RANK[b] ? a : b;
}

const DEICTIC_SURFACES = new Set([
  "我",
  "你",
  "您",
  "他",
  "她",
  "它",
  "咱",
  "俺",
  "本人",
  "自己",
  "大家",
  "别人",
  "人家",
  "咱们",
  "我们",
  "你们",
  "他们",
  "她们",
  "它们",
]);

const KINSHIP_EXACT = new Set([
  "爸",
  "妈",
  "爹",
  "娘",
  "父",
  "母",
  "哥",
  "姐",
  "弟",
  "妹",
  "兄",
  "弟",
  "老公",
  "老婆",
  "丈夫",
  "妻子",
  "儿子",
  "女儿",
  "孩子",
  "小孩",
  "孙子",
  "孙女",
  "爷爷",
  "奶奶",
  "外公",
  "外婆",
  "叔叔",
  "阿姨",
  "舅舅",
  "婶婶",
  "姑姑",
  "伯父",
  "伯母",
  "后妈",
  "小妈",
  "继母",
  "继父",
  "男友",
  "女友",
  "男朋友",
  "女朋友",
  "嫂子",
  "姐夫",
  "弟媳",
  "妹夫",
  "亲妈",
  "亲爸",
  "弟弟",
  "哥哥",
  "姐姐",
  "妹妹",
  "大哥",
  "大姐",
  "小弟",
  "小妹",
]);

const TITLE_EXACT = new Set([
  "老师",
  "先生",
  "小姐",
  "女士",
  "老板",
  "总",
  "经理",
  "主任",
  "医生",
  "护士",
  "司机",
  "服务员",
  "保姆",
  "警察",
  "警官",
  "将军",
  "上校",
  "队长",
  "班长",
  "同学",
  "同事",
  "师傅",
  "师父",
  "教授",
  "博士",
  "执政官",
  "机长",
  "官员",
]);

/** Normalize LLM / wire kind strings. */
export function parseMentionKind(raw: unknown): MentionKind | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!t) return null;
  const aliases: Record<string, MentionKind> = {
    proper: "proper",
    proper_name: "proper",
    name: "proper",
    full_name: "proper",
    personal_name: "proper",
    personal_nick: "personal_nick",
    nick: "personal_nick",
    nickname: "personal_nick",
    alias: "personal_nick",
    generic: "generic",
    epithet: "generic",
    generic_epithet: "generic",
    weak: "generic",
    kinship: "kinship",
    relation: "kinship",
    relative: "kinship",
    title: "title",
    role: "title",
    job: "title",
    deictic: "deictic",
    pronoun: "deictic",
    desc: "desc",
    description: "desc",
    descriptive: "desc",
  };
  if (aliases[t]) return aliases[t]!;
  // Chinese labels sometimes returned by models
  const zh: Record<string, MentionKind> = {
    专名: "proper",
    真名: "proper",
    姓名: "proper",
    外号: "personal_nick",
    昵称: "personal_nick",
    别名: "personal_nick",
    绰号: "generic",
    泛称: "generic",
    亲属: "kinship",
    称谓: "kinship",
    职务: "title",
    头衔: "title",
    代词: "deictic",
    描述: "desc",
  };
  if (zh[raw.trim()]) return zh[raw.trim()]!;
  if ((MENTION_KINDS as readonly string[]).includes(t)) return t as MentionKind;
  return null;
}

/**
 * Rule-only inference from surface form (no LLM).
 * High-precision patterns first; short Han names default to proper.
 */
export function inferMentionKind(surface: string): MentionKind {
  const s = (surface || "").trim().replace(/\s+/g, " ");
  if (!s) return "desc";

  if (DEICTIC_SURFACES.has(s)) return "deictic";

  // 我爸 / 他哥 / 你女朋友 …
  if (
    /^(我|你|他|她|咱|俺)(的)?(爸|妈|爹|娘|父|母|哥|姐|弟|妹|老公|老婆|丈夫|妻子|儿子|女儿|孩子|男友|女友|男朋友|女朋友|亲妈|亲爸|后妈|小妈)/.test(
      s,
    ) ||
    KINSHIP_EXACT.has(s) ||
    /^(亲)?(爸|妈|爹|娘)(爸|妈)?$/.test(s)
  ) {
    return "kinship";
  }

  // 这小子 / 那家伙 / 此女 …
  if (
    /^(这|那|此)(个|名|位)?(小子|家伙|姑娘|丫头|女人|男人|人|孩|小孩|男孩|女孩|少年|青年|老者|老头|老太婆|大叔|大哥|小姐)/.test(
      s,
    ) ||
    /^(小子|家伙|小鬼|那小子|这小子|这人|那人|旁人|路人)$/.test(s)
  ) {
    return "generic";
  }

  if (TITLE_EXACT.has(s)) return "title";
  // 许老师 / 周总 — surname + title (not a free-standing proper for exclusive clash)
  if (
    /^[\u4e00-\u9fff]{1,2}(老师|总|董|工|医|导)$/.test(s) ||
    /(老师|博士|将军|少将|执政官|机长|官员|保姆|服务员|经理|主任)$/.test(s)
  ) {
    return "title";
  }

  // Personal nick: 航仔 屿哥 小航 老吴 予嫣姐 周屿哥哥
  if (/^[\u4e00-\u9fff]{2,4}(哥哥|姐姐|弟弟|妹妹|哥|姐)$/.test(s)) {
    return "personal_nick";
  }
  if (/^(小|老)[\u4e00-\u9fff]{1,2}$/.test(s) || /[仔哥姐爷叔婶]$/.test(s)) {
    return "personal_nick";
  }

  // Descriptive phrases
  if (
    s.length >= 4 &&
    /(的|那个|一个|穿|戴|瘦|胖|黑|白|高|矮)/.test(s)
  ) {
    return "desc";
  }

  // Default: 2–4 Han / Latin word → proper name heuristic
  if (/^[\u4e00-\u9fff·•]{2,4}$/.test(s)) return "proper";
  if (/^[A-Za-z][A-Za-z\s\-.]{1,30}$/.test(s)) return "proper";
  if (s.length >= 2) return "personal_nick";
  return "desc";
}

/**
 * Resolve final kind: high-confidence rules win over LLM;
 * otherwise use LLM if valid; else full infer.
 */
export function resolveMentionKind(
  surface: string,
  llmKind?: string | null,
): MentionKind {
  const s = (surface || "").trim();
  const inferred = inferMentionKind(s);
  const fromLlm = parseMentionKind(llmKind ?? null);

  // High-precision rules win over LLM (do not trust "proper" on 他 / 这小子)
  if (inferred === "deictic") return "deictic";
  if (
    inferred === "generic" &&
    (/^(这|那|此)/.test(s) || /^(小子|家伙|小鬼|这人|那人)$/.test(s))
  ) {
    return "generic";
  }
  if (
    inferred === "kinship" &&
    (/^(我|你|他|她)/.test(s) || KINSHIP_EXACT.has(s))
  ) {
    return "kinship";
  }

  if (fromLlm) {
    if (
      inferred === "title" &&
      (fromLlm === "proper" || fromLlm === "personal_nick") &&
      /老师$|将军$|老板$|服务员$/.test(s)
    ) {
      return "title";
    }
    return fromLlm;
  }
  return inferred;
}

export function kindOfSurfaceOnCharacter(
  mentions: Array<{ surface?: string; kind?: MentionKind }>,
  surface: string,
): MentionKind {
  const target = (surface || "").trim().replace(/\s+/g, " ");
  let best: MentionKind | null = null;
  for (const m of mentions || []) {
    const s = (m.surface || "").trim().replace(/\s+/g, " ");
    if (s !== target) continue;
    const k = m.kind ?? resolveMentionKind(s);
    best = best ? preferMentionKind(best, k) : k;
  }
  return best ?? resolveMentionKind(target);
}
