import type { ParsedNovel, NovelChunk } from "@/types";
import { chunkText, extractTitle } from "@/lib/utils";

const MAX_CHUNK_SIZE = 4000;
const CHUNK_OVERLAP = 500;

export function parseNovel(text: string): ParsedNovel {
  const title = extractTitle(text);
  const chunkContents = chunkText(text, MAX_CHUNK_SIZE, CHUNK_OVERLAP);

  const chunks: NovelChunk[] = chunkContents.map((content, index) => ({
    index,
    content,
    isFirst: index === 0,
    isLast: index === chunkContents.length - 1,
  }));

  return {
    title,
    fullText: text,
    chunks,
    totalLength: text.length,
  };
}

/**
 * Build a condensed summary of the novel for context windows.
 * For long novels, we use representative chunks.
 */
export function buildNovelContext(parsed: ParsedNovel, maxChunks: number = 5): string {
  if (parsed.chunks.length <= maxChunks) {
    return parsed.chunks.map((c) => c.content).join("\n\n---\n\n");
  }

  // Take first chunk, evenly spaced middle chunks, and last chunk
  const selected: NovelChunk[] = [parsed.chunks[0]];
  const middleCount = maxChunks - 2;
  if (middleCount > 0) {
    const step = Math.floor((parsed.chunks.length - 2) / (middleCount + 1));
    for (let i = 1; i <= middleCount; i++) {
      const idx = 1 + i * step;
      if (idx < parsed.chunks.length - 1) {
        selected.push(parsed.chunks[idx]);
      }
    }
  }
  selected.push(parsed.chunks[parsed.chunks.length - 1]);

  return selected.map((c) => c.content).join("\n\n---\n\n");
}
