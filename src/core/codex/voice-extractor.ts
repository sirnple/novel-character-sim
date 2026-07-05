// ============================================================
// Character Voice Extractor
// ============================================================

import type { CharacterProfile } from "@/types";
import type { CharacterQuote } from "./types";

/**
 * Extract representative quotes for each character from the novel text.
 * Searches for dialogue patterns near character name mentions.
 * Returns up to 8 quotes per character with emotional classification.
 */
export function extractCharacterQuotes(
  profiles: CharacterProfile[],
  fullText: string
): Record<string, CharacterQuote[]> {
  const result: Record<string, CharacterQuote[]> = {};
  for (const profile of profiles) {
    result[profile.name] = [];
  }

  const chapterBlocks = splitIntoChapterBlocks(fullText);

  for (const profile of profiles) {
    const quotes: CharacterQuote[] = [];

    for (let ci = 0; ci < chapterBlocks.length; ci++) {
      const block = chapterBlocks[ci];
      if (!block.includes(profile.name)) continue;

      const dialogueLines = extractNearbyDialogue(block, profile.name);
      for (const line of dialogueLines) {
        if (quotes.length >= 8) break;
        quotes.push({
          text: line.text,
          emotion: classifyEmotion(line.text),
          context: line.context,
          chapterNumber: ci + 1,
        });
      }
      if (quotes.length >= 8) break;
    }

    result[profile.name] = quotes;
  }

  return result;
}

// ---- helpers ----

function splitIntoChapterBlocks(text: string): string[] {
  const full = text ?? "";
  const chapters = full.split(/(?:第[零一二三四五六七八九十百千万\d]+[章節节]|Chapter\s+\d+)/i);

  return chapters
    .filter(c => c.trim().length > 100)
    .reduce<string[]>((acc, c) => {
      if (c.length > 8000) {
        for (let j = 0; j < c.length; j += 4000) {
          acc.push(c.slice(j, j + 4000));
        }
      } else {
        acc.push(c);
      }
      return acc;
    }, []);
}

interface DialogueLine {
  text: string;
  context: string;
}

function extractNearbyDialogue(block: string, characterName: string): DialogueLine[] {
  const lines: DialogueLine[] = [];
  const dialogueRegex = /「([^」]+)」|[“]([^”]+)[”]|“([^”]+)”|：([^，。！？\n]{8,80})/g;
  let match: RegExpExecArray | null;

  while ((match = dialogueRegex.exec(block)) !== null) {
    const dialogue = match[1] || match[2] || match[3] || match[4] || "";
    if (dialogue.length < 5 || dialogue.length > 200) continue;

    const pos = match.index;
    const contextStart = Math.max(0, pos - 100);
    const contextEnd = Math.min(block.length, pos + dialogue.length + 100);
    const context = block.slice(contextStart, contextEnd);

    if (context.includes(characterName)) {
      lines.push({ text: dialogue.trim(), context: context.replace(/\n/g, " ").trim() });
    }

    if (lines.length >= 12) break;
  }

  return deduplicateBySimilarity(lines).slice(0, 8);
}

function classifyEmotion(text: string): CharacterQuote["emotion"] {
  if (/[！!]{2,}|怒|恨|可惡|混蛋|杀|死/.test(text)) return "angry";
  if (/[。\.]{3,}|唉|寂寞|难过|悲伤|哭|泪/.test(text)) return "sad";
  if (/[哈啊呵嘿嘻]{2,}|笑|喜|乐|开心|高兴/.test(text)) return "happy";
  if (/危险|小心|警戒|注意|谁|什么|怎么/.test(text)) return "tense";
  if (/放心|没事|好|平静|安/.test(text)) return "calm";
  return "neutral";
}

function deduplicateBySimilarity(lines: DialogueLine[]): DialogueLine[] {
  const seen = new Set<string>();
  return lines.filter(l => {
    const key = l.text.slice(0, 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
