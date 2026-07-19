/**
 * Probe analysis-role chatWithTools against configured provider (.env.local).
 * Usage: npx tsx scripts/probe-analysis-llm.ts
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { createLLMProvider, resetProvider } from "../src/core/llm/factory";
import { initRegistry } from "../src/core/agents/init";
import { buildToolSchemas, getTool } from "../src/core/agents/registry";
import {
  ANALYSIS_MASTER_TOOL_NAMES,
  toOpenAIFunctionTools,
} from "../src/core/agents/analysis-allowlist";

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
  mkdirSync(SCRATCH, { recursive: true });
  const lines: string[] = [];
  const log = (s: string) => {
    console.log(s);
    lines.push(s);
  };

  initRegistry();
  const allow = new Set<string>(ANALYSIS_MASTER_TOOL_NAMES as unknown as string[]);
  const schemas = buildToolSchemas().filter(
    (t) => allow.has(t.name) && t.name !== "ask_question",
  );
  log(`provider_env=${process.env.LLM_PROVIDER || "(unset)"}`);
  log(`analysis_model=${process.env.DEEPSEEK_ANALYSIS_MODEL || process.env.DEEPSEEK_MODEL || "(default)"}`);
  log(`tools_for_analysis=${schemas.length}`);
  log(`tool_names=${schemas.map((s) => s.name).join(",")}`);

  const openaiShape = toOpenAIFunctionTools(
    schemas.map((s) => ({
      name: s.name,
      description: s.description,
      parameters: s.parameters as Record<string, unknown>,
    })),
  );
  const emptyProps = openaiShape.filter(
    (t) => Object.keys(t.function.parameters.properties || {}).length === 0,
  );
  log(`empty_param_schemas_after_normalize=${emptyProps.length}`);
  log(`get_current_novel_registered=${!!getTool("get_current_novel")}`);
  log(`run_form_analysis_registered=${!!getTool("run_form_analysis")}`);
  log(`scan_character_mentions_registered=${!!getTool("scan_character_mentions")}`);
  log(`finish_registered=${!!getTool("finish_novel_analysis")}`);

  try {
    const llm = createLLMProvider("analysis");
    log(`provider_created=ok`);
    let toolUses = 0;
    let text = "";
    try {
      for await (const ev of llm.chatWithTools(
        [
          {
            role: "system",
            content:
              "你是分析主 Agent。先调用 get_current_novel，再调用 get_current_branch。不要编造。",
          },
          {
            role: "user",
            content: "请确认当前小说与分支（必须用工具）。",
          },
        ],
        schemas as any,
        { temperature: 0.1, maxTokens: 1024 },
      )) {
        if (ev.type === "text_delta") text += ev.text;
        if (ev.type === "tool_use") {
          toolUses++;
          log(
            `tool_use name=${ev.name} args=${JSON.stringify(ev.args).slice(0, 200)}`,
          );
        }
        if (ev.type === "done") log(`stream_done`);
      }
      log(`first_turn_ok toolUses=${toolUses} textLen=${text.length}`);
    } catch (e) {
      log(`first_turn_error=${(e as Error).message}`);
      log(`environmental_or_payload_failure=true`);
    }
  } catch (e) {
    log(`provider_create_error=${(e as Error).message}`);
  }

  writeFileSync(`${SCRATCH}/analysis-llm.log`, lines.join("\n"), "utf8");
  writeFileSync(`${SCRATCH}/analysis-sse.log`, lines.join("\n"), "utf8");
  console.log(`wrote ${SCRATCH}/analysis-llm.log`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
