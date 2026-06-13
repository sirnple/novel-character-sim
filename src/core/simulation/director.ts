import type { CharacterProfile, SceneDefinition, SimulationRound } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { buildDirectorSystemPrompt } from "./types";
import { isChinese } from "@/lib/utils";

const DIRECTOR_SCHEMA = {
  name: "director_decision",
  description: "Director's scene advancement decision",
  parameters: {
    type: "object",
    properties: {
      sceneDevelopment: {
        type: "string",
        description: "What happens next in the scene (1-3 sentences)",
      },
      activeCharacters: {
        type: "array",
        items: { type: "string" },
        description: "Names of characters who should react in this round",
      },
      moodShift: {
        type: "string",
        description: "How the mood or tension shifts in this beat",
      },
      isSceneEnd: {
        type: "boolean",
        description: "Whether the scene has reached a natural conclusion",
      },
    },
    required: ["sceneDevelopment", "activeCharacters", "isSceneEnd"],
  },
};

export interface DirectorDecision {
  sceneDevelopment: string;
  activeCharacters: string[];
  moodShift?: string;
  isSceneEnd: boolean;
}

export async function runDirector(
  characters: CharacterProfile[],
  scene: SceneDefinition,
  previousRounds: SimulationRound[]
): Promise<DirectorDecision> {
  const llm = createLLMProvider();
  const systemPrompt = buildDirectorSystemPrompt(characters, scene);

  const zh = characters.length > 0 && isChinese(characters[0].personality.description);

  // Build history context
  const historyContext =
    previousRounds.length > 0
      ? `\n\n${zh ? '## 目前为止发生的事' : '## WHAT HAS HAPPENED SO FAR'}\n${previousRounds
          .map(
            (r) =>
              `${zh ? '第' : 'Round '}${r.roundNumber}${zh ? '轮' : ''}:\n${r.directorAction}\n${r.characterResponses
                .map((cr) => `${cr.characterName}: "${cr.dialogue}" [${cr.actions}]`)
                .join("\n")}`
          )
          .join("\n\n")}`
      : "";

  const userPrompt = zh
    ? `现在是第${previousRounds.length === 0 ? "一" : "下一"}轮。
${previousRounds.length === 0 ? "请设置场景的开场。" : "根据已发生的事推进场景。"}
${historyContext}

接下来发生什么？`
    : `It's time for the ${previousRounds.length === 0 ? "first" : "next"} round.
${previousRounds.length === 0 ? "Set the opening of the scene." : "Advance the scene with the next development."}
${historyContext}

What happens next?`;

  return llm.chatWithTool<DirectorDecision>(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    DIRECTOR_SCHEMA,
    { temperature: 0.8, maxTokens: 500 }
  );
}
