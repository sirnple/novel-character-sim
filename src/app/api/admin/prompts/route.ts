import { NextRequest, NextResponse } from "next/server";
import { listAgentPrompts, getAgentPrompt, updateAgentPrompt, resetAgentPrompt, seedAgentPrompts } from "@/lib/db";
import { AGENT_REGISTRY } from "@/core/prompts/registry";
import { getDefaultPrompt } from "@/core/prompts/defaults";
import { isAdmin } from "@/core/prompts/admin-auth";

let seeded = false;

function ensureSeed() {
  if (seeded) return;
  // Seed only zh entries — en is stored as a language variant of the same agent_id
  seedAgentPrompts(
    AGENT_REGISTRY.map((a) => ({
      agentId: a.agentId,
      name: a.name,
      description: a.description,
      category: a.category,
    }))
  );
  seeded = true;
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  ensureSeed();
  const agentId = req.nextUrl.searchParams.get("agent");
  const lang = req.nextUrl.searchParams.get("lang") || "zh";

  if (agentId) {
    const row = getAgentPrompt(agentId, lang);
    if (!row) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    // Fill in default prompts if the row has none (not yet modified by user)
    const defaults = getDefaultPrompt(agentId, lang);
    return NextResponse.json({
      ...row,
      system_prompt: row.system_prompt ?? defaults?.systemPrompt ?? null,
      user_prompt_template: row.user_prompt_template ?? defaults?.userPromptTemplate ?? null,
    });
  }
  const rows = listAgentPrompts();
  // Fill in defaults for list view too (so the sidebar shows correct modification status)
  const enriched = rows.map((row) => {
    const defaults = getDefaultPrompt(row.agent_id, row.language);
    return {
      ...row,
      system_prompt: row.system_prompt ?? defaults?.systemPrompt ?? null,
      user_prompt_template: row.user_prompt_template ?? defaults?.userPromptTemplate ?? null,
    };
  });
  return NextResponse.json(enriched);
}

export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const { agentId, language, systemPrompt, userPromptTemplate } = await req.json();
  if (!agentId || !language) {
    return NextResponse.json({ error: "缺少 agentId 或 language" }, { status: 400 });
  }
  updateAgentPrompt(agentId, language, {
    system_prompt: systemPrompt ?? null,
    user_prompt_template: userPromptTemplate ?? null,
  });
  return NextResponse.json({ success: true });
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const { agentId, language } = await req.json();
  if (!agentId || !language) {
    return NextResponse.json({ error: "缺少 agentId 或 language" }, { status: 400 });
  }
  resetAgentPrompt(agentId, language);
  return NextResponse.json({ success: true });
}
