/**
 * Reproduce analysis chat first turn: full system prompt + full analysis tool allowlist.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { createLLMProvider, resetProvider } from "../src/core/llm/factory";
import { initRegistry } from "../src/core/agents/init";
import { buildToolSchemas } from "../src/core/agents/registry";
import { ANALYSIS_MASTER_TOOL_NAMES } from "../src/core/agents/analysis-allowlist";
import { resolveAgentSystem } from "../src/core/prompts/resolve-agent-prompt";

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

async function runOnce(
  label: string,
  tools: { name: string; description: string; parameters: Record<string, unknown> }[],
  system: string,
  user: string,
) {
  const lines: string[] = [];
  const log = (s: string) => {
    console.log(`[${label}] ${s}`);
    lines.push(`[${label}] ${s}`);
  };
  log(`tools=${tools.length} names=${tools.map((t) => t.name).join(",")}`);
  log(`sysLen=${system.length} userLen=${user.length}`);
  try {
    const llm = createLLMProvider("analysis");
    let uses = 0;
    for await (const ev of llm.chatWithTools(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools as any,
      { temperature: 0.2, maxTokens: 1024 },
    )) {
      if (ev.type === "tool_use") {
        uses++;
        log(`tool_use=${ev.name}`);
      }
      if (ev.type === "done") log(`done uses=${uses}`);
    }
    log(`OK`);
  } catch (e) {
    log(`ERR=${(e as Error).message}`);
  }
  return lines;
}

async function main() {
  loadEnvLocal();
  resetProvider();
  initRegistry();
  mkdirSync(SCRATCH, { recursive: true });

  const allow = new Set<string>(ANALYSIS_MASTER_TOOL_NAMES as unknown as string[]);
  const all = buildToolSchemas().filter((t) => allow.has(t.name));
  const sys = resolveAgentSystem("novel_analysis", "zh", {
    novelId: "novel_test",
    branchId: "main",
    modules: "",
    forceRefresh: "false",
    prompt: "",
  });
  const user =
    "请做【完整分析】。先调用 get_current_novel 与 get_current_branch 确认当前小说与分支，再用返回的 id 调度。";

  const out: string[] = [];
  out.push(
    ...(await runOnce("full_allowlist", all as any, sys, user)),
  );
  // Without ask_question
  const noAsk = all.filter((t) => t.name !== "ask_question");
  out.push(
    ...(await runOnce("no_ask_question", noAsk as any, sys, user)),
  );
  // Minimal tools only
  const minimal = all.filter((t) =>
    ["get_current_novel", "get_current_branch", "get_analysis_status"].includes(
      t.name,
    ),
  );
  out.push(...(await runOnce("minimal3", minimal as any, sys, user)));

  writeFileSync(`${SCRATCH}/analysis-full-probe.log`, out.join("\n"), "utf8");
  console.log(`wrote ${SCRATCH}/analysis-full-probe.log`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
