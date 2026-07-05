// ============================================================
// Style Profiler — Statistical Style Fingerprint
// ============================================================

import type { StyleFingerprint } from "./types";

/**
 * Compute a statistical style fingerprint from the novel text.
 * Samples from start, middle, and end for representative profiling.
 */
export function computeStyleFingerprint(text: string): StyleFingerprint {
  const samples = [
    text.slice(0, 5000),
    text.slice(Math.floor(text.length / 2) - 2500, Math.floor(text.length / 2) + 2500),
    text.slice(-5000),
  ];

  const allSentences = samples.flatMap(s => splitSentences(s));
  const totalChars = samples.reduce((sum, s) => sum + s.length, 0);

  // Avg sentence length
  const avgSentenceLength =
    allSentences.reduce((sum, s) => sum + s.length, 0) / Math.max(1, allSentences.length);

  // Dialogue ratio
  const dialogueChars = samples.reduce((sum, s) => {
    const matches =
      s.match(/「[^」]*」|[“][^”]*[”]|“[^”]*”/g) || [];
    return sum + matches.reduce((s2, m) => s2 + m.length, 0);
  }, 0);
  const dialogueRatio = totalChars > 0 ? dialogueChars / totalChars : 0;
  const narrationRatio = 1 - dialogueRatio;

  // Common openers
  const openers = allSentences.map(s => s.slice(0, Math.min(s.length, 3))).filter(o => o.length >= 2);
  const openerCount = new Map<string, number>();
  for (const o of openers) {
    openerCount.set(o, (openerCount.get(o) || 0) + 1);
  }
  const commonOpeners = Array.from(openerCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k]) => k);

  // Common connectors
  const transitionPatterns =
    /(突然|忽然|就在此时|紧接着|与此同时|不一会儿|过了许久|转眼间|随后|接着|然后|于是|然而|但是|不过|因此|所以|因为|虽然|如果|只要)/g;
  const connectorMatches = samples.join(" ").match(transitionPatterns) || [];
  const connectorCount = new Map<string, number>();
  for (const c of connectorMatches) {
    connectorCount.set(c, (connectorCount.get(c) || 0) + 1);
  }
  const commonConnectors = Array.from(connectorCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k]) => k);

  // Punctuation
  const totalK = Math.max(1, totalChars / 1000);
  const questionMatches = samples.join("").match(/[？?]/g) || [];
  const exclamationMatches = samples.join("").match(/[！!]/g) || [];
  const ellipsisMatches = samples.join("").match(/…|\.{3,}/g) || [];
  const emDashMatches = samples.join("").match(/[—–-]{1,2}/g) || [];

  // Vocab tier
  const vocabTier = classifyVocabTier(samples.join(""));

  // Pacing
  const shortRatio = allSentences.filter(s => s.length < 15).length / Math.max(1, allSentences.length);
  const longRatio = allSentences.filter(s => s.length > 50).length / Math.max(1, allSentences.length);
  let pacingSignature: string;
  if (shortRatio > 0.4 && avgSentenceLength < 25) {
    pacingSignature = "fast — predominantly short sentences, rapid pace";
  } else if (longRatio > 0.3 && avgSentenceLength > 40) {
    pacingSignature = "slow — many long, descriptive sentences, measured pace";
  } else {
    pacingSignature = "varied — mix of short and long sentences, moderate pace";
  }

  return {
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    dialogueRatio: Math.round(dialogueRatio * 1000) / 1000,
    narrationRatio: Math.round(narrationRatio * 1000) / 1000,
    commonOpeners,
    commonConnectors,
    punctuationProfile: {
      questionMarksPer1k: Math.round((questionMatches.length / totalK) * 10) / 10,
      exclamationPer1k: Math.round((exclamationMatches.length / totalK) * 10) / 10,
      ellipsisPer1k: Math.round((ellipsisMatches.length / totalK) * 10) / 10,
      emDashPer1k: Math.round((emDashMatches.length / totalK) * 10) / 10,
    },
    vocabularyTier: vocabTier,
    pacingSignature,
  };
}

function splitSentences(text: string): string[] {
  return text.split(/[。！？\.!\?\n]+/).filter(s => s.trim().length > 2);
}

function classifyVocabTier(text: string): StyleFingerprint["vocabularyTier"] {
  const sample = text.slice(0, 20000);
  const literaryWords =
    /旖旎|氤氲|潋滟|寂寥|阑珊|缱绻|葳蕤|叆叇|潺潺|婆娑|冉冉|袅袅|蹁跹|觊觎|逡巡|倥偬|酩酊|魑魅|魍魉/g;
  const slangWords = /卧槽|牛逼|尼玛|特么|艹|靠|我去|屌/g;
  const classicalPatterns = /之乎者也|矣|焉|哉|兮|噫/g;

  const literaryCount = (sample.match(literaryWords) || []).length;
  const slangCount = (sample.match(slangWords) || []).length;
  const classicalCount = (sample.match(classicalPatterns) || []).length;

  if (classicalCount > 10) return "literary_classical";
  if (literaryCount > 15) return "literary";
  if (slangCount > 10) return "vernacular";
  return "mixed";
}
