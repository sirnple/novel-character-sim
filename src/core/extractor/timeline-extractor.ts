import type { ChapterTimeline, TimelineEvent, CharacterChapterState, ParsedNovel } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { isChinese, generateId } from "@/lib/utils";
import { resolveAgentSystem } from "@/core/prompts/resolve-agent-prompt";

// === Timeline Extractor ===
// Recursively builds a chapter-by-chapter timeline from the novel.
// Each chapter yields: events, involved characters, and cumulative state deltas.

const TIMELINE_EVENT_SCHEMA = {
  name: "timeline_event_list",
  description: "Ordered list of timeline events for a chapter",
  parameters: {
    type: "object",
    properties: {
      chapterTitle: { type: "string", description: "章节标题" },
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "事件名称" },
            description: { type: "string", description: "事件描述 (1-2句)" },
            involvedCharacters: { type: "array", items: { type: "string" }, description: "参与角色名列表" },
            outcomes: { type: "array", items: { type: "string" }, description: "事件造成的结果" },
            charactersChanged: {
              type: "object",
              description: "角色名→此事件中该角色的状态变化",
              additionalProperties: { type: "string" }
            }
          },
          required: ["title", "description", "involvedCharacters", "outcomes"]
        }
      }
    },
    required: ["events"]
  }
};

const CHAPTER_STATE_SCHEMA = {
  name: "chapter_character_states",
  description: "All characters final state at end of chapter",
  parameters: {
    type: "object",
    properties: {
      characterStates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            alive: { type: "boolean" },
            location: { type: "string" },
            delta: { type: "string", description: "从上一章到本章结束，角色状态变化摘要" }
          },
          required: ["name", "alive", "location", "delta"]
        }
      }
    },
    required: ["characterStates"]
  }
};

/** Split text by chapter pattern */
function splitChapters(text: string): { title: string; content: string }[] {
  // Common chapter patterns: "第X章", "Chapter X", "第X节", "X、"
  const pattern = /(?:^|\n)(第[零一二三四五六七八九十百千万\d]+[章節节]|Chapter\s+\d+|第[零一二三四五六七八九十百千万\d]+[卷集部篇]|[零一二三四五六七八九十百千万\d]+、)\s*([^\n]*)/gi;
  const chapters: { title: string; content: string }[] = [];
  let lastIndex = 0;
  let lastTitle = "开篇";

  const full = text ?? "";
  let m: RegExpExecArray | null;

  // Reset lastIndex
  pattern.lastIndex = 0;
  while ((m = pattern.exec(full)) !== null) {
    const title = (m[1] + " " + (m[2] || "")).trim();
    if (chapters.length > 0) {
      chapters[chapters.length - 1].content = full.slice(lastIndex, m.index).trim();
    } else if (m.index > 0) {
      // Text before first chapter header = intro
      chapters.push({ title: "开篇", content: full.slice(0, m.index).trim() });
    }
    chapters.push({ title, content: "" });
    lastIndex = m.index + m[0].length;
  }
  // Last chapter
  if (chapters.length > 0) {
    chapters[chapters.length - 1].content = full.slice(lastIndex).trim();
  } else {
    chapters.push({ title: "全书", content: full.trim() });
  }

  return chapters.filter(c => c.content.length > 0);
}

export class TimelineExtractor {
  private novelText: string;
  private useChinese: boolean;
  private characterNames: string[];

  constructor(parsed: ParsedNovel, characterNames: string[] = []) {
    this.novelText = parsed.fullText;
    this.useChinese = isChinese(this.novelText);
    this.characterNames = characterNames;
  }

  async extract(): Promise<ChapterTimeline> {
    const chapters = splitChapters(this.novelText);
    const llm = createLLMProvider();
    let globalSequence = 0;
    const snapshots: import("@/types").ChapterSnapshot[] = [];
    let prevStates: CharacterChapterState[] = [];

    console.log(`[TimelineExtractor] Found ${chapters.length} chapters`);

    for (let ci = 0; ci < chapters.length; ci++) {
      const ch = chapters[ci];
      console.log(`[TimelineExtractor] Ch ${ci + 1}/${chapters.length}: ${ch.title} (${ch.content.length} chars)`);

      const { snapshot, nextSeq, nextStates } = await this.extractOneUnit(
        llm,
        ch.title,
        ci + 1,
        ch.content,
        globalSequence,
        prevStates,
      );
      globalSequence = nextSeq;
      snapshots.push(snapshot);
      prevStates = nextStates;
    }

    return {
      novelId: "",
      totalChapters: chapters.length,
      chapters: snapshots
    };
  }

  /**
   * Process a single narrative unit (chapter / scene / window) for async jobs.
   */
  async extractOneUnit(
    llm: ReturnType<typeof createLLMProvider>,
    unitTitle: string,
    unitNumber: number,
    unitText: string,
    startSeq: number,
    prevStates: CharacterChapterState[],
  ): Promise<{
    snapshot: import("@/types").ChapterSnapshot;
    nextSeq: number;
    nextStates: CharacterChapterState[];
  }> {
    const events = await this.extractChapterEvents(
      llm,
      unitTitle,
      unitNumber,
      unitText,
      startSeq,
    );
    const charStates = await this.extractCharacterStates(
      llm,
      unitTitle,
      unitNumber,
      unitText,
      prevStates,
    );
    return {
      snapshot: {
        chapterNumber: unitNumber,
        title: unitTitle,
        events,
        characterStates: charStates,
      },
      nextSeq: startSeq + events.length,
      nextStates: charStates,
    };
  }

  private async extractChapterEvents(
    llm: ReturnType<typeof createLLMProvider>,
    chapterTitle: string,
    chapterNumber: number,
    chapterText: string,
    startSeq: number
  ): Promise<TimelineEvent[]> {
    // For long chapters, truncate to keep API call manageable
    const maxLen = 8000;
    const truncated = chapterText.length > maxLen
      ? chapterText.slice(0, maxLen) + "\n...(后续省略)"
      : chapterText;

    const prompt = resolveAgentSystem("timeline", this.useChinese ? "zh" : "en", {
      chapterTitle,
      truncated,
    });

    const result = await llm.chatWithTool<{ chapterTitle: string; events: any[] }>(
      [{ role: "user", content: prompt }],
      TIMELINE_EVENT_SCHEMA,
      { temperature: 0.3, maxTokens: 8192 }
    );

    return (result.events || []).map((e, i) => ({
      id: generateId(),
      sequence: startSeq + i + 1,
      chapterNumber,
      title: e.title || "事件" + (i + 1),
      description: e.description || "",
      involvedCharacters: e.involvedCharacters || [],
      outcomes: e.outcomes || [],
      charactersChanged: e.charactersChanged || {},
      precedingEvent: i > 0 ? (result.events?.[i - 1]?.title ?? null) : null
    }));
  }

  private async extractCharacterStates(
    llm: ReturnType<typeof createLLMProvider>,
    chapterTitle: string,
    chapterNumber: number,
    chapterText: string,
    prevStates: CharacterChapterState[]
  ): Promise<CharacterChapterState[]> {
    const prevStateDesc = prevStates.length > 0
      ? prevStates.map(s => `${s.name}: alive=${s.alive}, loc=${s.location}, delta="${s.delta}"`).join(", ")
      : "无上一章（首次出现）";

    const maxLen = 8000;
    const truncated = chapterText.length > maxLen
      ? chapterText.slice(0, maxLen) + "\n...(后续省略)"
      : chapterText;

    const knownNames = prevStates.map(s => s.name);
    if (this.characterNames.length > 0) {
      for (const n of this.characterNames) {
        if (!knownNames.includes(n)) knownNames.push(n);
      }
    }

    const prompt = resolveAgentSystem("timeline_states", this.useChinese ? "zh" : "en", {
      chapterTitle,
      truncated,
      knownNames: knownNames.join(", ") || (this.useChinese ? "未提供" : "none"),
      prevStateDesc,
    });

    const result = await llm.chatWithTool<{ characterStates: any[] }>(
      [{ role: "user", content: prompt }],
      CHAPTER_STATE_SCHEMA,
      { temperature: 0.3, maxTokens: 4096 }
    );

    return (result.characterStates || []).map(s => ({
      characterId: s.name || "",
      name: s.name || "",
      lastSeenChapter: chapterNumber,
      alive: s.alive !== false,
      location: s.location || "未知",
      delta: s.delta || ""
    }));
  }
}
