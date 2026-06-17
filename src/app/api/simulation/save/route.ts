import { NextRequest, NextResponse } from "next/server";
import type { SimulationState } from "@/types";
import { saveSimulation, getSimulation, listSimulations } from "@/lib/db";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "simulation_save", { windowMs: 60_000, maxRequests: 30 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }
  try {
    const simulation = (await request.json()) as SimulationState;
    saveSimulation(userId, simulation);
    return NextResponse.json({ success: true, id: simulation.id });
  } catch (error) {
    return NextResponse.json({ error: "Failed to save simulation" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "simulation_save_get", { windowMs: 60_000, maxRequests: 60 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }
  const simId = request.nextUrl.searchParams.get("id");
  if (simId) {
    const sim = getSimulation(userId, simId);
    if (!sim) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(sim);
  }
  const list = listSimulations(userId);
  return NextResponse.json(list);
}
