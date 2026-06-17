import { NextRequest } from "next/server";
import type { CharacterProfile, SceneDefinition, WritingStyle, SceneOutline } from "@/types";
import { SimulationEngine, type SimulationEvent } from "@/core/simulation/engine";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

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

  const {
    novelTitle,
    characters,
    scene,
    writingStyle,
    outline: cachedOutline,
  }: {
    novelTitle: string;
    characters: CharacterProfile[];
    scene: SceneDefinition;
    writingStyle?: WritingStyle;
    outline?: SceneOutline | null;
  } = await request.json();

  if (!characters?.length || !scene) {
    return new Response(
      JSON.stringify({ error: "Characters and scene are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
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
        writingStyle
      );

      try {
        await engine.run(cachedOutline);
      } catch (error) {
        sendEvent({
          type: "error",
          message: error instanceof Error ? error.message : "Simulation error",
        });
      }

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
