import type { CharacterProfile, ChannelMessage } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { buildCharacterSystemPrompt } from "./types";
import { isChinese } from "@/lib/utils";

const RESPONSE_SCHEMA = {
  name: "character_response",
  description: "Character's channel response",
  parameters: {
    type: "object",
    properties: {
      targetChannel: { type: "string", description: "public or private channel id to send to" },
      targetCharacter: { type: "string", description: "Character name if sending to private channel" },
      dialogue: { type: "string", description: "What the character says" },
      actions: { type: "string", description: "What the character does" },
      innerThoughts: { type: "string", description: "Inner thoughts" },
      shouldPass: { type: "boolean", description: "True if character chooses not to speak this turn" },
    },
    required: ["dialogue", "actions", "innerThoughts"],
  },
};

interface CharacterChannelResponse {
  targetChannel?: string;
  targetCharacter?: string;
  dialogue: string;
  actions: string;
  innerThoughts: string;
  shouldPass?: boolean;
}

export async function runCharacterAgent(
  profile: CharacterProfile,
  sceneDescription: string,
  channelContext: string,
  previousMessages: ChannelMessage[],
  otherResponsesThisRound: ChannelMessage[],
  isReaction: boolean = false
): Promise<{
  channelId: string;
  dialogue: string;
  actions: string;
  innerThoughts: string;
  characterName: string;
}> {
  const llm = createLLMProvider();
  const systemPrompt = buildCharacterSystemPrompt(profile);
  const zh = isChinese(profile.personality.description + profile.speakingStyle.description);

  const othersText = otherResponsesThisRound.length > 0
    ? otherResponsesThisRound
        .map((m) => {
          const chLabel = m.channelId === "public" ? "【公共】" : "【私信】";
          return `${chLabel} ${m.fromCharacterName}：${m.dialogue}`;
        })
        .join("\n")
    : (zh ? "（没有人说话）" : "(no one has spoken)");

  const historyText = previousMessages.length > 0
    ? previousMessages.slice(-8).map((m) => `${m.fromCharacterName}：${m.dialogue}`).join("\n")
    : "";

  const reactionHint = isReaction
    ? (zh
        ? `\n\n⚠️ 这是快速反应轮。如果有人刚说的话需要你回应，请简短回复（1-2句话）。如果没什么要说的，设置 shouldPass: true。`
        : `\n\n⚠️ This is a quick reaction pass. If someone just said something that warrants a brief reply (1-2 sentences), respond. Otherwise set shouldPass: true.`)
    : "";

  const userPrompt = zh
    ? `## 场景\n${sceneDescription}\n\n## 当前频道消息\n${channelContext}\n\n## 本回合其他人的发言\n${othersText}\n\n## 之前的历史\n${historyText || "（对话刚开始）"}${reactionHint}\n\n轮到你说话了。你可以选择：\n- 在公共频道发言（大家都能看到）\n- 给某个角色发私信（只有对方能看到）\n- 不说话（如果你觉得没什么可说的）\n\n如果要发私信，指定 targetCharacter。如果觉得不应该说话，设置 shouldPass: true。`
    : `## Scene\n${sceneDescription}\n\n## Channel Messages\n${channelContext}\n\n## Others This Round\n${othersText}\n\n## History\n${historyText || "(beginning)"}${reactionHint}\n\nYour turn. Choose: public channel, private message to someone, or pass (shouldPass: true).`;

  const result = await llm.chatWithTool<CharacterChannelResponse>(
    [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    RESPONSE_SCHEMA,
    { temperature: isReaction ? 0.8 : 0.9, maxTokens: isReaction ? 300 : 600 }
  );

  // Determine channel: private if targetCharacter specified and a private channel exists
  let channelId = "public";
  if (result.targetCharacter && result.shouldPass !== true) {
    // Find or create private channel via the relationship
    channelId = result.targetCharacter;
  }

  return {
    channelId,
    dialogue: result.shouldPass ? "" : (result.dialogue || ""),
    actions: result.actions || "",
    innerThoughts: result.innerThoughts || "",
    characterName: profile.name,
  };
}
