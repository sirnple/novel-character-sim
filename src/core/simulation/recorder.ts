import type { SceneDefinition, WritingStyle, ChannelMessage } from "@/types";
import { createLLMProvider } from "@/core/llm/factory";
import { buildRecorderSystemPrompt } from "./types";
import { isChinese } from "@/lib/utils";

export interface DirectorContext {
  summary: string;
  pacing: "fast" | "medium" | "slow";
  mood: string;
  conflict: number;
  beat: number;
}

export async function runRecorder(
  scene: SceneDefinition,
  roundNumber: number,
  allMessages: ChannelMessage[],
  previousProse: string,
  writingStyle?: WritingStyle,
  directorCtx?: DirectorContext
): Promise<string> {
  const llm = createLLMProvider();
  const sample = allMessages.map((m) => m.dialogue).join(" ");
  const zh = isChinese(sample) || isChinese(scene.initialSituation);
  const systemPrompt = buildRecorderSystemPrompt(scene, zh, writingStyle);

  const publicMsgs = allMessages.filter((m) => m.channelId === "public");
  const privateMsgs = allMessages.filter((m) => m.channelId !== "public");

  let channelReport = "";
  if (publicMsgs.length > 0) {
    channelReport += `【公共频道】\n${publicMsgs.map((m) => `${m.fromCharacterName}：${m.dialogue} [${m.actions}]`).join("\n")}\n`;
  }
  if (privateMsgs.length > 0) {
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

  // Director scheduling context
  let directorGuide = "";
  if (directorCtx) {
    directorGuide = zh
      ? `\n## 导演调度\n- 节拍：${directorCtx.beat}\n- 情绪基调：${directorCtx.mood}\n- 节奏：${directorCtx.pacing === "fast" ? "快节奏，短句快切" : directorCtx.pacing === "slow" ? "慢节奏，从容铺陈" : "中速推进"}\n- 冲突强度：${directorCtx.conflict}/10\n- 调度摘要：${directorCtx.summary}\n\n请按此基调和节奏写作。`
      : `\n## Director's Note\n- Beat: ${directorCtx.beat}\n- Mood: ${directorCtx.mood}\n- Pacing: ${directorCtx.pacing}\n- Conflict: ${directorCtx.conflict}/10\n- Summary: ${directorCtx.summary}\n\nWrite accordingly.`;
  }

  const prompt = zh
    ? `## 第 ${roundNumber} 轮\n\n${channelReport}\n${previousProse ? `## 前文\n${previousProse.slice(-500)}` : "## 场景开场"}${directorGuide}\n请将以上所有频道的对话编织成连贯的叙事文字。你拥有上帝视角——既能看到公共对话，也能看到私密交流。`
    : `## Round ${roundNumber}\n\n${channelReport}\n${previousProse ? `## Previous\n${previousProse.slice(-500)}` : "## Opening"}${directorGuide}\nWeave all conversations into narrative prose. God's-eye view.`;

  const prose = await llm.chat(
    [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
    { temperature: 0.8, maxTokens: 1500 }
  );

  return prose.trim();
}
