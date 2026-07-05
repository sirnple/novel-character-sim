import { NextRequest, NextResponse } from "next/server";
import type { CharacterProfile, SceneDefinition, SimulationRound, WritingStyle, TimelineEvent, CharacterChapterState } from "@/types";
import { SimulationEngine } from "@/core/simulation/engine";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

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
      characters,
      scene,
      writingStyle,
      timelineEvents,
      lastChapterStates: rawLastChapterStates,
    }: {
      novelTitle: string;
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
          .map(
            (e) =>
              `事件${e.sequence}: ${e.title} — ${e.description}`
          )
          .join("\n")
      : "";

    // Format last chapter states
    const lastChapterStates = rawLastChapterStates?.length
      ? rawLastChapterStates
          .map(
            (s) =>
              `${s.name}: alive=${s.alive}, 位置=${s.location}, 状态=${s.delta}`
          )
          .join("\n")
      : "";

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
          case "prose":
            storedState.fullNovelOutput = event.prose;
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
      lastChapterStates
    );

    simulationStore.set(simId, { engine, state: storedState });

    // Run simulation in background
    engine.run().catch(console.error);

    return NextResponse.json({ simulationId: simId, status: "started" });
  } catch (error) {
    console.error("Simulation start error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to start simulation";
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
