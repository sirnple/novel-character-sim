import { NextRequest, NextResponse } from "next/server";
import type { SimulationState } from "@/types";

// In-memory saved simulations store
const savedSimulations = new Map<string, SimulationState>();

export async function POST(request: NextRequest) {
  try {
    const simulation = (await request.json()) as SimulationState;
    savedSimulations.set(simulation.id, simulation);
    return NextResponse.json({ success: true, id: simulation.id });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save simulation" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const simId = request.nextUrl.searchParams.get("id");
  if (simId) {
    const sim = savedSimulations.get(simId);
    if (!sim) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(sim);
  }

  // List all saved
  const list = Array.from(savedSimulations.values()).map((s) => ({
    id: s.id,
    novelTitle: s.novelTitle,
    createdAt: s.createdAt,
    status: s.status,
  }));
  return NextResponse.json(list);
}
