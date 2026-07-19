/**
 * Canonical relationship type catalog for extract + UI.
 * id: stable English key stored when model returns English;
 * zh: display / filter label (also accepted as type string).
 */

export interface RelTypeDef {
  id: string;
  zh: string;
  /** short hint for prompts */
  hint: string;
  color: string;
  dash?: string;
}

/**
 * Expanded set: web-novel oriented. Models often collapsed everything into
 * friend/lover/enemy/other when the enum was only ~9 buckets.
 */
export const RELATIONSHIP_TYPE_DEFS: RelTypeDef[] = [
  { id: "family", zh: "家人", hint: "血亲/姻亲/养父母子女", color: "#f43f5e" },
  { id: "lover", zh: "恋人", hint: "确认恋爱/订婚/夫妻", color: "#f472b6" },
  { id: "affair", zh: "暧昧", hint: "未确认情愫/调情/暗恋", color: "#e879f9" },
  { id: "ex", zh: "前任", hint: "分手/离异/旧爱", color: "#c084fc" },
  { id: "friend", zh: "朋友", hint: "普通友情", color: "#38bdf8" },
  { id: "sworn", zh: "结义", hint: "结拜/义兄弟/过命交情", color: "#0ea5e9" },
  { id: "comrade", zh: "战友", hint: "同袍/搭档/战场羁绊", color: "#22d3ee" },
  { id: "ally", zh: "盟友", hint: "临时或长期合作抗敌", color: "#2dd4bf" },
  { id: "colleague", zh: "同僚", hint: "同事/同级办事", color: "#a78bfa" },
  {
    id: "superior-subordinate",
    zh: "上下级",
    hint: "领导部属/军衔差",
    color: "#8b5cf6",
  },
  {
    id: "mentor-student",
    zh: "师徒",
    hint: "师父徒弟/教导传承",
    color: "#14b8a6",
  },
  {
    id: "master-servant",
    zh: "主仆",
    hint: "主从/侍从/契约仆从",
    color: "#f59e0b",
  },
  {
    id: "patron",
    zh: "金主",
    hint: "金主靠山/包养/庇护换效忠",
    color: "#eab308",
  },
  {
    id: "org",
    zh: "同组织",
    hint: "同门派/同公司/同势力成员",
    color: "#84cc16",
  },
  {
    id: "business",
    zh: "利益",
    hint: "交易/买卖/利用无感情",
    color: "#a3e635",
  },
  {
    id: "benefactor",
    zh: "恩人",
    hint: "救命/提携之恩",
    color: "#4ade80",
  },
  { id: "rival", zh: "对手", hint: "竞争/较劲未必仇杀", color: "#fb923c", dash: "4 3" },
  { id: "enemy", zh: "敌人", hint: "敌对/仇杀/死敌", color: "#ef4444", dash: "6 4" },
  {
    id: "captor",
    zh: "控制",
    hint: "囚禁/奴役/精神或芯片控制",
    color: "#dc2626",
    dash: "2 3",
  },
  { id: "acquaintance", zh: "相识", hint: "认识但不深", color: "#94a3b8" },
  { id: "other", zh: "其他", hint: "无法归入以上时再用", color: "#a8a29e" },
];

/** Enum values accepted by LLM tool schema (id + zh). */
export function relationshipTypeEnum(): string[] {
  const ids = RELATIONSHIP_TYPE_DEFS.map((d) => d.id);
  const zhs = RELATIONSHIP_TYPE_DEFS.map((d) => d.zh);
  return Array.from(new Set([...ids, ...zhs]));
}

export function relationshipTypePromptList(zh: boolean): string {
  return RELATIONSHIP_TYPE_DEFS.map((d) =>
    zh ? `${d.zh}（${d.id}，${d.hint}）` : `${d.id} (${d.zh}: ${d.hint})`,
  ).join("；");
}

/** Map any model output → stable id, then optional zh label for UI. */
export function normalizeRelationshipTypeId(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return "other";
  const lower = t.toLowerCase();
  for (const d of RELATIONSHIP_TYPE_DEFS) {
    if (d.id === lower || d.zh === t) return d.id;
  }
  // common aliases
  const aliases: Record<string, string> = {
    亲属: "family",
    血亲: "family",
    夫妻: "lover",
    情侣: "lover",
    未婚妻: "lover",
    未婚夫: "lover",
    炮友: "affair",
    暗恋: "affair",
    旧情人: "ex",
    兄弟: "sworn",
    姐妹: "friend",
    搭档: "comrade",
    队友: "comrade",
    上司: "superior-subordinate",
    下属: "superior-subordinate",
    老板: "superior-subordinate",
    师父: "mentor-student",
    徒弟: "mentor-student",
    仆人: "master-servant",
    奴隶: "captor",
    仇人: "enemy",
    死敌: "enemy",
    情敌: "rival",
    合作: "ally",
    同谋: "ally",
    同门: "org",
    组织: "org",
  };
  if (aliases[t]) return aliases[t];
  if (aliases[lower]) return aliases[lower];
  return "other";
}

export function relationshipTypeZh(idOrRaw: string): string {
  const id = normalizeRelationshipTypeId(idOrRaw);
  const d = RELATIONSHIP_TYPE_DEFS.find((x) => x.id === id);
  return d?.zh || idOrRaw || "其他";
}

export function relationshipTypeMeta(
  idOrRaw: string,
): { color: string; label: string; dash?: string; id: string } {
  const id = normalizeRelationshipTypeId(idOrRaw);
  const d = RELATIONSHIP_TYPE_DEFS.find((x) => x.id === id);
  return {
    id,
    color: d?.color || "#a8a29e",
    label: d?.zh || idOrRaw || "其他",
    dash: d?.dash,
  };
}
