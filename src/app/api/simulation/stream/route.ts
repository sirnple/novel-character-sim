import { NextRequest } from "next/server";
import type { CharacterProfile, SceneDefinition, WritingStyle } from "@/types";
import { SimulationEngine, type SimulationEvent } from "@/core/simulation/engine";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const {
    novelTitle,
    characters,
    scene,
    writingStyle,
  }: {
    novelTitle: string;
    characters: CharacterProfile[];
    scene: SceneDefinition;
    writingStyle?: WritingStyle;
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
        await engine.run();
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
