import { NextRequest } from "next/server";
import type { CharacterProfile, SceneDefinition, WritingStyle, SceneOutline, TimelineEvent, CharacterChapterState } from "@/types";
import { SimulationEngine, type SimulationEvent } from "@/core/simulation/engine";
import { buildCodex } from "@/core/codex/builder";
import type { WritersCodex } from "@/core/codex/types";
import { saveCodex, getNovel, getStoryInfo, getTimeline } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { debugLog } from "@/lib/debug-log";
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
    outlineOnly,
    timelineEvents,
    lastChapterStates: rawLastChapterStates,
    continueFromOffset,
  }: {
    novelTitle: string;
    novelId?: string;
    characters: CharacterProfile[];
    scene: SceneDefinition;
    writingStyle?: WritingStyle;
    outline?: SceneOutline | null;
    outlineOnly?: boolean;
    timelineEvents?: TimelineEvent[];
    lastChapterStates?: CharacterChapterState[];
    continueFromOffset?: number;
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

  // Build codex — DB enrichment requires userId+novelId
  // Without them, falls back to client-provided data alone
  let codex: WritersCodex | null = null;
  let dbStoryInfo: any = null;
  let dbTimeline: any = null;
  let dbNovelText = "";
  try {
    if (novelId) {
      try {
        const dbNovel = getNovel(userId, novelId);
        if (dbNovel) {
          dbNovelText = dbNovel.text;
          dbStoryInfo = getStoryInfo(userId, novelId);
          dbTimeline = getTimeline(userId, novelId);
          debugLog("StreamRoute", `Novel loaded: text=${dbNovelText.length}chars, storyInfo=${dbStoryInfo ? "yes" : "no"}, timeline=${dbTimeline ? `yes(${dbTimeline.chapters?.length || 0}ch)` : "no"}`);
        } else {
          debugLog("StreamRoute", `Novel NOT FOUND in DB for id=${novelId}`);
        }
      } catch {}
    }

    codex = buildCodex({
      scene,
      characters,
      storyInfo: dbStoryInfo,
      fullNovelText: dbNovelText,
      recentProse: continueFromOffset ? dbNovelText.slice(0, continueFromOffset) : dbNovelText.slice(-6000),
      lastChapterStates: rawLastChapterStates || [],
      timeline: dbTimeline,
    });

    if (novelId) {
      saveCodex(novelId, codex);
    }
    debugLog("StreamRoute", `Codex built: chars=${codex.characterDossiers?.profiles?.length || 0}, chapters=${codex.narrativeContext?.chapterSummaries?.length || 0}, worldRules=${codex.worldBible?.rules?.length || 0}`);
  } catch (e) {
    debugLog("StreamRoute", `Codex build FAILED: ${(e as Error).message}`);
    console.warn("[StreamRoute] Codex build failed, falling back to legacy prompt:", e);
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
        codex,
        !outlineOnly,  // runReview = false when outlineOnly
        continueFromOffset ? dbNovelText.slice(0, continueFromOffset) : undefined
      );

      try {
        if (outlineOnly) {
          // Outline-only mode: run the outline writer, emit, then stop
          const { runOutlineWriter } = await import("@/core/simulation/outline-agent");
          const presentChars = characters.filter(c => scene.characterIds.includes(c.id));
          const allChars = presentChars.length > 0 ? presentChars : characters;

          // Chapter summaries from DB timeline (if available)
          const dbChapters = dbTimeline?.chapters || [];
          const chapterSummaries = dbChapters.map((ch: any, i: number) => ({
            chapterNumber: ch.chapterNumber || i + 1,
            title: ch.title || `第${i + 1}章`,
            summary: (ch.events || []).slice(0, 3).map((e: any) => e.title + "：" + e.description).join("；").slice(0, 300) || "",
            keyEvents: (ch.events || []).slice(0, 5).map((e: any) => e.title || ""),
            characterChanges: {},
          }));

          // Continue chapter number from request body or timeline length
          const continueFromChapter = (body as any).continueFromChapter || Math.max(1, dbChapters.length);
          const continueFromLabel = (body as any).continueFromLabel || `第${continueFromChapter}章末`;

          try {
            const result = await runOutlineWriter({
              characters: allChars,
              continueFromChapter: continueFromChapter,
              continueFromLabel: continueFromLabel,
              previousProse: continueFromOffset ? dbNovelText.slice(0, continueFromOffset) : "",
              chapterSummaries,
              activeForeshadowing: (codex?.foreshadowingLedger?.active as any) || [],
              worldBible: dbStoryInfo?.worldSetting || undefined,
              authorNotes: (body as any).authorNotes || "",
              selectCharacters: true,
            }, sendEvent);
            sendEvent({
              type: "outline",
              outline: result.outline,
              prompt: result.prompt,
            });
          } catch (e) {
            console.warn("[OutlineOnly] Outline writer failed:", e);
          }
          controller.close();
          return;
        }
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
