import { NextRequest } from "next/server";
import type { CharacterProfile, SceneDefinition, WritingStyle, SceneOutline, TimelineEvent, CharacterChapterState } from "@/types";
import { SimulationEngine, type SimulationEvent } from "@/core/simulation/engine";
import { buildCodex } from "@/core/codex/builder";
import { saveCodex, getNovel, getStoryInfo, getTimeline } from "@/lib/db";
import type { WritersCodex } from "@/core/codex/types";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { saveGenerationLog } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "simulation_stream", { windowMs: 300_000, maxRequests: 5 });
  if (!rate.allowed) {
    return new Response(
      JSON.stringify({ error: rateLimitMessage(rate) }),
      { status: 429, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = await request.json();
  const {
    novelTitle,
    novelId,
    characters,
    scene,
    writingStyle,
    outline: cachedOutline,
    timelineEvents,
    lastChapterStates: rawLastChapterStates,
  }: {
    novelTitle: string;
    novelId?: string;
    characters: CharacterProfile[];
    scene: SceneDefinition;
    writingStyle?: WritingStyle;
    outline?: SceneOutline | null;
    timelineEvents?: TimelineEvent[];
    lastChapterStates?: CharacterChapterState[];
  } = body;

  if (!characters?.length || !scene) {
    return new Response(
      JSON.stringify({ error: "Characters and scene are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Format timeline context
  const timelineContext = timelineEvents?.length
    ? timelineEvents
        .map((e) => `事件${e.sequence}: ${e.title} — ${e.description}`)
        .join("\n")
    : "";

  // Format last chapter states
  const lastChapterStatesStr = rawLastChapterStates?.length
    ? rawLastChapterStates
        .map((s) => `${s.name}: alive=${s.alive}, 位置=${s.location}, 状态=${s.delta}`)
        .join("\n")
    : "";

  // Build codex for rich context injection
  let codex: WritersCodex | null = null;
  try {
    codex = buildCodex({
      scene,
      characters,
      storyInfo: null,
      fullNovelText: "",
      lastChapterStates: rawLastChapterStates || [],
      timeline: null,
    });
    if (novelId) {
      saveCodex(novelId, codex);
      // Also try to load storyInfo and fullNovelText from DB to enrich codex
      try {
        const dbNovel = getNovel(userId, novelId);
        if (dbNovel) {
          const enriched = buildCodex({
            scene,
            characters,
            storyInfo: getStoryInfo(userId, novelId),
            fullNovelText: dbNovel.text,
            lastChapterStates: rawLastChapterStates || [],
            timeline: getTimeline(userId, novelId),
          });
          codex = enriched;
          saveCodex(novelId, codex);
        }
      } catch {}
    }
  } catch (e) {
    console.warn("Codex build failed, falling back to legacy prompt:", e);
  }

  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      let finalNovel = "";
      const sendEvent = (event: SimulationEvent) => {
        if (isClosed) return;
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      };

      const engine = new SimulationEngine(
        novelTitle || "Untitled",
        characters,
        scene,
        sendEvent,
        writingStyle,
        timelineContext,
        lastChapterStatesStr,
        codex
      );

      try {
        await engine.run(cachedOutline);
      } catch (error) {
        sendEvent({
          type: "error",
          message: error instanceof Error ? error.message : "Simulation error",
        });
      }

      // Log the full generation
      try {
        if (finalNovel) {
          saveGenerationLog({
            id: crypto.randomUUID(),
            userId,
            category: "writer",
            label: novelTitle || "小说写作",
            inputSummary: scene?.initialSituation?.slice(0, 200) || "",
            outputPreview: finalNovel.slice(0, 300),
            fullOutput: finalNovel,
          });
        }
      } catch {}
      controller.close();
    },
    cancel() {
      isClosed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
