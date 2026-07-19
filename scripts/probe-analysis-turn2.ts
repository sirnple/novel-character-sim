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
    ) {
      v = v.slice(1, -1);
    }
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
  const conversation: LLMMessage[] = [
    { role: "system", content: sys },
    {
      role: "user",
      content:
        "请做【完整分析】。先调用 get_current_novel 与 get_current_branch 确认当前小说与分支。",
    },
  ];

  const uses: { id: string; name: string; args: any }[] = [];
  try {
    for await (const ev of llm.chatWithTools(conversation, tools as any, {
      temperature: 0.2,
      maxTokens: 1024,
    })) {
      if (ev.type === "tool_use") {
        uses.push({ id: ev.id, name: ev.name, args: ev.args });
        log(`turn1 tool_use=${ev.name}`);
      }
    }
    log(`turn1_ok uses=${uses.length}`);
  } catch (e) {
    log(`turn1_ERR=${(e as Error).message}`);
    writeFileSync(`${SCRATCH}/analysis-turn2.log`, lines.join("\n"));
    return;
  }

  // Match chat route: assistant tool_use blocks + user tool_result blocks
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
          content: JSON.stringify({
            novelId: "novel_test",
            branchId: "main",
            title: "probe",
            textLength: 1000,
            ok: true,
          }),
        },
      ],
    } as any);
  }

  try {
    let uses2 = 0;
    for await (const ev of llm.chatWithTools(conversation, tools as any, {
      temperature: 0.2,
      maxTokens: 1024,
    })) {
      if (ev.type === "tool_use") {
        uses2++;
        log(`turn2 tool_use=${ev.name}`);
      }
      if (ev.type === "done") log(`turn2_done uses=${uses2}`);
    }
    log("TURN2_OK");
  } catch (e) {
    log(`TURN2_ERR=${(e as Error).message}`);
  }

  writeFileSync(`${SCRATCH}/analysis-turn2.log`, lines.join("\n"), "utf8");
  console.log(`wrote ${SCRATCH}/analysis-turn2.log`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
