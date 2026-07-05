import { NextRequest, NextResponse } from "next/server";
import type { CharacterProfile, SceneDefinition, SimulationRound, WritingStyle, TimelineEvent, CharacterChapterState, ChapterTimeline } from "@/types";
import { SimulationEngine } from "@/core/simulation/engine";
import { buildCodex } from "@/core/codex/builder";
import { saveCodex } from "@/lib/db";
import type { WritersCodex } from "@/core/codex/types";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { getStoryInfo, getCharacters } from "@/lib/db";

// Store running simulations
const simulationStore = new Map<
  string,
  {
    engine: SimulationEngine;
    state: { status: string; rounds: SimulationRound[]; fullNovelOutput: string };
  }
>();

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "simulation_start", { windowMs: 300_000, maxRequests: 5 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rateLimitMessage(rate) },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const {
      novelTitle,
      novelId,
      characters,
      scene,
      writingStyle,
      timelineEvents,
      lastChapterStates: rawLastChapterStates,
    }: {
      novelTitle: string;
      novelId?: string;
      characters: CharacterProfile[];
      scene: SceneDefinition;
      writingStyle?: WritingStyle;
      timelineEvents?: TimelineEvent[];
      lastChapterStates?: CharacterChapterState[];
    } = body;

    if (!characters?.length || !scene) {
      return NextResponse.json(
        { error: "Characters and scene are required" },
        { status: 400 }
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
      if (novelId) saveCodex(novelId, codex);
    } catch (e) {
      console.warn("Codex build failed, falling back to legacy prompt:", e);
    }

    // Create engine with event handler that updates the stored state
    const simId = `sim_${Date.now()}`;
    const storedState = {
      status: "running" as string,
      rounds: [] as SimulationRound[],
      fullNovelOutput: "",
    };

    const engine = new SimulationEngine(
      novelTitle || "Untitled",
      characters,
      scene,
      (event) => {
        switch (event.type) {
          case "outline":
            break;
          case "prose":
            storedState.fullNovelOutput = event.prose;
            break;
          case "review":
            console.log(`[Engine] Review: ${event.review.needsHumanReview.length} issues need human review`);
            break;
          case "scene_end":
            storedState.status = "completed";
            storedState.fullNovelOutput = event.fullNovel;
            break;
          case "error":
            storedState.status = "error";
            break;
        }
      },
      writingStyle,
      timelineContext,
      lastChapterStatesStr,
      codex
    );

    simulationStore.set(simId, { engine, state: storedState });

    // Run simulation in background
    engine.run().catch(console.error);

    return NextResponse.json({ simulationId: simId, status: "started" });
  } catch (error) {
    console.error("Simulation start error:", error);
    const message = error instanceof Error ? error.message : "Failed to start simulation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const simId = request.nextUrl.searchParams.get("simulationId");
  if (!simId) {
    return NextResponse.json({ error: "simulationId required" }, { status: 400 });
  }

  const sim = simulationStore.get(simId);
  if (!sim) {
    return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: sim.state.status,
    rounds: sim.state.rounds,
    fullNovelOutput: sim.state.fullNovelOutput,
  });
}
