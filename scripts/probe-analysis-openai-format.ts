import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createLLMProvider, resetProvider } from "../src/core/llm/factory";
import { initRegistry } from "../src/core/agents/init";
import { buildToolSchemas } from "../src/core/agents/registry";
import { ANALYSIS_MASTER_TOOL_NAMES } from "../src/core/agents/analysis-allowlist";
import { resolveAgentSystem } from "../src/core/prompts/resolve-agent-prompt";
import type { LLMMessage } from "../src/types";

const SCRATCH =
  process.env.SCRATCH ||
  "C:\\Users\\57864\\AppData\\Local\\Temp\\grok-goal-5e9458b614f4\\implementer";

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadEnvLocal();
  resetProvider();
  initRegistry();
  mkdirSync(SCRATCH, { recursive: true });
  const lines: string[] = [];
  const log = (s: string) => {
    console.log(s);
    lines.push(s);
  };

  const tools = buildToolSchemas().filter((t) =>
    (ANALYSIS_MASTER_TOOL_NAMES as readonly string[]).includes(t.name),
  );
  const sys = resolveAgentSystem("novel_analysis", "zh", {
    novelId: "novel_test",
    branchId: "main",
    modules: "",
    forceRefresh: "false",
    prompt: "",
  });
  const llm = createLLMProvider("analysis");

  // --- Format A: Anthropic-style (current chat route) ---
  {
    const conversation: LLMMessage[] = [
      { role: "system", content: sys },
      { role: "user", content: "先调用 get_current_novel 与 get_current_branch" },
    ];
    const uses: any[] = [];
    for await (const ev of llm.chatWithTools(conversation, tools as any, {
      temperature: 0.2,
      maxTokens: 1024,
    })) {
      if (ev.type === "tool_use") uses.push(ev);
    }
    log(`A turn1 uses=${uses.map((u) => u.name).join(",")}`);
    for (const u of uses) {
      conversation.push({
        role: "assistant",
        content: [
          { type: "tool_use", id: u.id, name: u.name, input: u.args || {} },
        ],
      } as any);
      conversation.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: u.id,
            content: JSON.stringify({ novelId: "novel_test", branchId: "main" }),
          },
        ],
      } as any);
    }
    try {
      let n = 0;
      for await (const ev of llm.chatWithTools(conversation, tools as any, {
        temperature: 0.2,
        maxTokens: 1024,
      })) {
        if (ev.type === "tool_use") {
          n++;
          log(`A turn2 use=${ev.name}`);
        }
      }
      log(`A_TURN2_OK n=${n}`);
    } catch (e) {
      log(`A_TURN2_ERR=${(e as Error).message.slice(0, 180)}`);
    }
  }

  // --- Format B: OpenAI native tool_calls + role:tool ---
  {
    const conversation: any[] = [
      { role: "system", content: sys },
      { role: "user", content: "先调用 get_current_novel 与 get_current_branch" },
    ];
    const uses: any[] = [];
    for await (const ev of llm.chatWithTools(conversation, tools as any, {
      temperature: 0.2,
      maxTokens: 1024,
    })) {
      if (ev.type === "tool_use") uses.push(ev);
    }
    log(`B turn1 uses=${uses.map((u) => u.name).join(",")}`);
    conversation.push({
      role: "assistant",
      content: null,
      tool_calls: uses.map((u) => ({
        id: u.id,
        type: "function",
        function: { name: u.name, arguments: JSON.stringify(u.args || {}) },
      })),
    });
    for (const u of uses) {
      conversation.push({
        role: "tool",
        tool_call_id: u.id,
        content: JSON.stringify({ novelId: "novel_test", branchId: "main" }),
      });
    }
    try {
      let n = 0;
      for await (const ev of llm.chatWithTools(conversation as any, tools as any, {
        temperature: 0.2,
        maxTokens: 1024,
      })) {
        if (ev.type === "tool_use") {
          n++;
          log(`B turn2 use=${ev.name}`);
        }
      }
      log(`B_TURN2_OK n=${n}`);
    } catch (e) {
      log(`B_TURN2_ERR=${(e as Error).message.slice(0, 180)}`);
    }
  }

  // --- Format C: sequential OpenAI (one tool_call per assistant) ---
  {
    const conversation: any[] = [
      { role: "system", content: sys },
      { role: "user", content: "先调用 get_current_novel，然后再 get_current_branch（可以分两次）" },
    ];
    const uses: any[] = [];
    for await (const ev of llm.chatWithTools(conversation, tools as any, {
      temperature: 0.2,
      maxTokens: 1024,
    })) {
      if (ev.type === "tool_use") uses.push(ev);
    }
    log(`C turn1 uses=${uses.map((u) => u.name).join(",")}`);
    for (const u of uses) {
      conversation.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: u.id,
            type: "function",
            function: { name: u.name, arguments: JSON.stringify(u.args || {}) },
          },
        ],
      });
      conversation.push({
        role: "tool",
        tool_call_id: u.id,
        content: JSON.stringify({ novelId: "novel_test", branchId: "main" }),
      });
    }
    try {
      let n = 0;
      for await (const ev of llm.chatWithTools(conversation as any, tools as any, {
        temperature: 0.2,
        maxTokens: 1024,
      })) {
        if (ev.type === "tool_use") {
          n++;
          log(`C turn2 use=${ev.name}`);
        }
      }
      log(`C_TURN2_OK n=${n}`);
    } catch (e) {
      log(`C_TURN2_ERR=${(e as Error).message.slice(0, 180)}`);
    }
  }

  writeFileSync(`${SCRATCH}/analysis-turn2-formats.log`, lines.join("\n"), "utf8");
  console.log("wrote formats log");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
