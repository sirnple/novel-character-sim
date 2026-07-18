import type { CharacterProfile, StoryInfo } from "@/types";

export type ShareVisibility = "public" | "auth";

export interface ShareCharacter {
  id: string;
  name: string;
  aliases: string[];
  appearance?: { summary?: string };
  personality?: {
    traits?: string[];
    description?: string;
  };
  drive?: {
    goal?: string;
    motivation?: string;
    fear?: string;
  };
  relationships?: Array<{
    characterId?: string;
    characterName: string;
    type: string;
    description?: string;
  }>;
}

export interface ShareOverviewPayload {
  version: 1;
  title: string;
  language?: string;
  generatedAt: string;
  story: StoryInfo | null;
  characters: ShareCharacter[];
}

/** ≥108 bits entropy, url-safe. Uses Web Crypto (works in Node + browser bundles). */
export function mintShareToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // base64url without padding
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function toShareCharacter(c: CharacterProfile): ShareCharacter {
  return {
    id: c.id || "",
    name: c.name || "",
    aliases: Array.isArray(c.aliases) ? c.aliases.slice() : [],
    appearance: c.appearance?.summary
      ? { summary: c.appearance.summary }
      : undefined,
    personality: {
      traits: c.personality?.traits?.slice() || [],
      description: c.personality?.description || "",
    },
    drive: {
      goal: c.drive?.goal || "",
      motivation: c.drive?.motivation || "",
      fear: c.drive?.fear || "",
    },
    relationships: (c.relationships || []).slice(0, 24).map((r) => ({
      characterId: r.characterId || "",
      characterName: r.characterName,
      type: r.type,
      description: r.description || "",
    })),
  };
}

/**
 * Lift whitelist share characters into CharacterProfile shape for read-only
 * RelationshipGraph (edges resolve by id or name).
 */
export function shareCharactersToProfiles(
  chars: ShareCharacter[],
): CharacterProfile[] {
  const nameToId = new Map(
    chars.map((c) => [c.name, c.id || c.name] as const),
  );
  return chars.map((c) => ({
    id: c.id || c.name,
    name: c.name,
    aliases: c.aliases || [],
    appearance: { summary: c.appearance?.summary || "" },
    personality: {
      traits: c.personality?.traits || [],
      description: c.personality?.description || "",
      decisionStyle: "",
      underPressure: "",
    },
    drive: {
      goal: c.drive?.goal || "",
      motivation: c.drive?.motivation || "",
      fear: c.drive?.fear || "",
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
    relationships: (c.relationships || []).map((r) => ({
      characterId:
        r.characterId ||
        nameToId.get(r.characterName) ||
        r.characterName,
      characterName: r.characterName,
      type: r.type,
      description: r.description || "",
      history: "",
      dynamics: "",
    })),
  }));
}

export function buildSharePayload(input: {
  title: string;
  language?: string;
  story: StoryInfo | null;
  characters: CharacterProfile[];
  generatedAt?: string;
}): ShareOverviewPayload {
  return {
    version: 1,
    title: input.title || "未命名",
    language: input.language,
    generatedAt: input.generatedAt || new Date().toISOString(),
    story: input.story,
    characters: (input.characters || []).map(toShareCharacter),
  };
}

export function isShareVisibility(v: unknown): v is ShareVisibility {
  return v === "public" || v === "auth";
}

/** True if payload has something worth showing. */
export function hasShareableContent(
  story: StoryInfo | null,
  characters: CharacterProfile[],
): boolean {
  const hasStory = !!(story && (story.plotSummary || story.mainStoryline || story.title));
  return hasStory || (characters?.length ?? 0) > 0;
}
