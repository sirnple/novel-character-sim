import type { SceneDefinition, WritingStyle, ChannelMessage } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { buildRecorderSystemPrompt } from "./types";
import { isChinese } from "@/lib/utils";

export async function runRecorder(
  scene: SceneDefinition,
  roundNumber: number,
  allMessages: ChannelMessage[],
  previousProse: string,
  writingStyle?: WritingStyle
): Promise<string> {
  const llm = createLLMProvider();
  const sample = allMessages.map((m) => m.dialogue).join(" ");
  const zh = isChinese(sample) || isChinese(scene.initialSituation);
  const systemPrompt = buildRecorderSystemPrompt(scene, zh, writingStyle);

  // Group messages by channel for structured context
  const publicMsgs = allMessages.filter((m) => m.channelId === "public");
  const privateMsgs = allMessages.filter((m) => m.channelId !== "public");

  let channelReport = "";
  if (publicMsgs.length > 0) {
    channelReport += `【公共频道】\n${publicMsgs.map((m) => `${m.fromCharacterName}：${m.dialogue} [${m.actions}]`).join("\n")}\n`;
  }
  if (privateMsgs.length > 0) {
    // Group private messages by channel
    const grouped = new Map<string, ChannelMessage[]>();
    for (const m of privateMsgs) {
      const arr = grouped.get(m.channelId) || [];
      arr.push(m);
      grouped.set(m.channelId, arr);
    }
    grouped.forEach((msgs, chId) => {
      const names = chId.replace("priv-", "").split("-").join(" ↔ ");
      channelReport += `\n【私信：${names}】\n${msgs.map((m) => `${m.fromCharacterName}：${m.dialogue} [${m.actions}]`).join("\n")}\n`;
    });
  }

  const prompt = zh
    ? `## 第 ${roundNumber} 轮\n\n${channelReport}\n${previousProse ? `## 前文\n${previousProse.slice(-500)}` : "## 场景开场"}\n\n请将以上所有频道的对话编织成连贯的叙事文字。你拥有上帝视角——既能看到公共对话，也能看到私密交流。`
    : `## Round ${roundNumber}\n\n${channelReport}\n${previousProse ? `## Previous\n${previousProse.slice(-500)}` : "## Opening"}\n\nWeave all channel conversations into narrative prose. You have God's-eye view.`;

  const prose = await llm.chat(
    [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
    { temperature: 0.8, maxTokens: 1500 }
  );

  return prose.trim();
}
