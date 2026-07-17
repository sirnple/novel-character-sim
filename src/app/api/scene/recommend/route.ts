import { NextRequest, NextResponse } from "next/server";
import { createLLMProvider } from "@/core/llm/factory";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { saveGenerationLog } from "@/lib/db";
import { runWithTokenContext } from "@/lib/token-usage-context";
import type { CharacterProfile, StoryInfo } from "@/types";
import { isChinese } from "@/lib/utils";

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "scene_recommend", { windowMs: 60_000, maxRequests: 10 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(rate) },
      { status: 429 }
    );
  }

  try {
    const { characters, storyInfo }: { characters: CharacterProfile[]; storyInfo?: StoryInfo } = await request.json();

    if (!characters?.length) {
      return NextResponse.json({ error: "Characters required" }, { status: 400 });
    }

    return await runWithTokenContext(
      { userId, agentId: "scene_recommend", category: "scene" },
      async () => {
    const llm = createLLMProvider("write");
    const zh = isChinese(characters[0]?.name || "") || (storyInfo?.plotSummary && isChinese(storyInfo.plotSummary));

    const charList = characters.map((c) => `${c.name}: ${c.personality.description}`).join("\n");
    const storyContext = storyInfo
      ? `故事背景: ${storyInfo.plotSummary}\n世界观: ${storyInfo.worldSetting.timePeriod} - ${storyInfo.worldSetting.location}\n力量体系: ${storyInfo.worldSetting.powerSystem}`
      : "";

    const prompt = zh
      ? `你是一位创意编剧。基于以下角色和故事信息，推荐3个有趣的场景设定。

角色：
${charList}

${storyContext}

为每个场景提供：
- location: 地点（中文）
- timeOfDay: 时间（dawn/morning/afternoon/dusk/night/midnight）
- weather: 天气（clear/rainy/stormy/snowy/foggy/windy）
- atmosphere: 氛围（tense/romantic/mysterious/joyful/melancholic/dangerous/peaceful）
- initialSituation: 初始情境描述（中文，1-2句话）
- whyGood: 为什么这个场景有趣（中文，1句话）
- suggestedCharacters: 建议参与的角色名列表

返回JSON数组。`
      : `You are a creative screenwriter. Based on the characters and story info, recommend 3 interesting scene setups.

Characters:
${charList}

${storyContext}

For each scene provide: location, timeOfDay, weather, atmosphere, initialSituation, whyGood, suggestedCharacters (array of names).

Return a JSON array.`;

    const response = await llm.chatWithTool<{
      scenes: {
        location: string;
        timeOfDay: string;
        weather: string;
        atmosphere: string;
        initialSituation: string;
        whyGood: string;
        suggestedCharacters: string[];
      }[];
    }>(
      [{ role: "user", content: prompt }],
      {
        name: "scene_recommendations",
        description: "Scene recommendations",
        parameters: {
          type: "object",
          properties: {
            scenes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  location: { type: "string" },
                  timeOfDay: { type: "string" },
                  weather: { type: "string" },
                  atmosphere: { type: "string" },
                  initialSituation: { type: "string" },
                  whyGood: { type: "string" },
                  suggestedCharacters: { type: "array", items: { type: "string" } },
                },
                required: ["location", "timeOfDay", "atmosphere", "initialSituation", "suggestedCharacters"],
              },
            },
          },
          required: ["scenes"],
        },
      },
      { temperature: 0.8, maxTokens: 4096 }
    );

    saveGenerationLog({
      id: crypto.randomUUID(),
      userId,
      category: "scene_recommend",
      label: "场景推荐",
      inputSummary: characters.map(c => c.name).join(", "),
      outputPreview: (response.scenes || []).map((s: any) => s.location).join(" | "),
      fullOutput: JSON.stringify(response.scenes),
    });
    return NextResponse.json({ recommendations: response.scenes || [] });
      },
    );
  } catch (error) {
    console.error("Scene recommendation error:", error);
    return NextResponse.json({ error: "Failed to generate recommendations" }, { status: 500 });
  }
}
