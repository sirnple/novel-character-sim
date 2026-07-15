/**
 * Shared guards for novel prose (vs findings / revision plans).
 * Used by save_prose tool (reject bad writes) and writer agent (verify save happened).
 */

export function stripLeadingMeta(text: string): string {
  const lines = text.replace(/^\uFEFF/, "").split("\n");
  let i = 0;
  const metaRe =
    /^(好的[，,。]?|我先|让我|我会|现在开始|以下是|正文如下|开始创作|开始续写|开始修改|已(经)?获取|我已经|核心修改|修改方向|修改要点|主要修改)/;
  const toolTalkRe =
    /(获取|调用).{0,12}(大纲|正文|角色|前文|工具|信息)|现在开始(创作|续写|写作|修改)|开始修改正文/;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (line.length <= 100 && (metaRe.test(line) || toolTalkRe.test(line))) {
      i++;
      continue;
    }
    break;
  }
  const stripped = lines.slice(i).join("\n").trim();
  return stripped.length >= 50 ? stripped : text.trim();
}

export function looksLikeFindingsNotProse(text: string): boolean {
  const t = text.trim();
  if (!t) return true;

  if (t.startsWith("[")) {
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) return true;
        const sample = parsed[0];
        if (sample && typeof sample === "object" && ("severity" in sample || "suggestion" in sample)) {
          return true;
        }
      }
    } catch { /* not pure JSON */ }
  }

  if (/^共\s*\d+\s*个问题/.test(t) || /【审查问题清单/.test(t)) return true;
  if (/^##\s*(角色一致性|连贯性|伏笔|风格|世界观|节奏)/.test(t) && /【(致命|重要|次要|critical|major|minor)】/i.test(t)) {
    return true;
  }

  const lines = t.split("\n").filter(l => l.trim());
  if (lines.length >= 2) {
    const findingLines = lines.filter(l =>
      /【(致命|重要|次要)】/.test(l) ||
      /^\d+\.\s*【/.test(l) ||
      /"severity"\s*:/.test(l)
    );
    if (findingLines.length >= Math.ceil(lines.length * 0.5)) return true;
  }

  return false;
}

/** 「核心修改方向：1.…」类编辑计划 */
export function looksLikeRevisionPlanNotProse(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 20) return false;

  const planHeader =
    /开始修改正文|核心修改方向|修改方向如下|修改要点|主要修改|修订计划|改动说明|修改说明|我将(会)?(按|根据)|准备修改|如下修改|改写思路|修改思路/;
  const hasPlanHeader = planHeader.test(t.slice(0, 400));
  const bullets = t.split("\n").filter(l => /^\s*([- *•]|\d+[\.、\)])/.test(l));
  const planBullets = bullets.filter(l =>
    /(增加|精简|压缩|删减|调整|改写|保留|过渡|留白|篇幅|独白|缓冲|情绪|修改)/.test(l)
  );

  if (hasPlanHeader && planBullets.length >= 2) return true;
  if (hasPlanHeader && t.length < 1500 && planBullets.length >= 1) return true;
  if (planBullets.length >= 3 && planBullets.length >= Math.ceil(bullets.length * 0.6) && t.length < 2500) {
    return true;
  }
  if (planHeader.test(t) && !/[「」『』""]/.test(t) && t.length < 2000 && planBullets.length >= 1) {
    return true;
  }
  return false;
}

export type ProseValidation =
  | { ok: true; prose: string }
  | { ok: false; reason: string; message: string };

/** Validate candidate text before accepting as stored prose. */
export function validateProseContent(
  raw: string,
  opts?: { minLen?: number; previousProse?: string },
): ProseValidation {
  const minLen = opts?.minLen ?? 50;
  const prose = stripLeadingMeta(raw || "");

  if (!prose || prose.length < minLen) {
    return { ok: false, reason: "empty_or_short", message: `正文过短或为空（${prose.length} 字，至少 ${minLen}）` };
  }
  if (looksLikeFindingsNotProse(prose)) {
    return { ok: false, reason: "findings_like", message: "内容像审查清单/findings，不是小说正文" };
  }
  if (looksLikeRevisionPlanNotProse(prose)) {
    return {
      ok: false,
      reason: "revision_plan",
      message: "内容像「修改计划/核心修改方向」，不是完整小说正文",
    };
  }

  const prev = opts?.previousProse;
  if (prev && prev.length > 500 && prose.length < prev.length * 0.35) {
    return {
      ok: false,
      reason: "too_short_vs_original",
      message: `相对原文过短（${prose.length} 字 vs 原文 ${prev.length} 字）`,
    };
  }

  return { ok: true, prose };
}

/** Trail marker: successful save_prose tool_result content prefix */
export const SAVE_PROSE_OK_PREFIX = "正文已存";
export const SAVE_PROSE_REJECT_PREFIX = "拒绝保存";
