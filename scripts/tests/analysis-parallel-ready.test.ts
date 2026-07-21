/**
 * Core analysis parallel dispatch:
 * - listParallelReadyAgents (which domains can launch together)
 * - groupPendingToolsForExecution (consecutive agent → parallel wave)
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  listParallelReadyAgents,
  ANALYSIS_AGENT_DEPENDENCIES,
  ANALYSIS_SUBAGENT_TYPES,
} from "../../src/core/agents/analysis-allowlist";
import {
  groupPendingToolsForExecution,
  waveAgentTypes,
  type PendingToolCall,
} from "../../src/core/agents/parallel-tool-waves";

function tool(
  name: string,
  id: string,
  args: Record<string, unknown> = {},
): PendingToolCall {
  return { toolId: id, toolName: name, args };
}

function agent(type: string, id: string): PendingToolCall {
  return tool("agent", id, { agent_type: type, prompt: `run ${type}` });
}

export function runAnalysisParallelReadyTests(): void {
  suite("listParallelReadyAgents", () => {
    test("before form: only analyze_form is ready to launch", () => {
      const ready: Record<string, boolean> = {};
      const wave = listParallelReadyAgents(ready);
      assert.deepEqual(wave, ["analyze_form"]);
    });

    test("after form: five domains that only need form", () => {
      const ready: Record<string, boolean> = { analyze_form: true };
      const wave = listParallelReadyAgents(ready);
      assert.ok(wave.includes("analyze_character_list"));
      assert.ok(wave.includes("analyze_story_world"));
      assert.ok(wave.includes("analyze_timeline"));
      assert.ok(wave.includes("extract_style"));
      assert.ok(wave.includes("extract_ideas"));
      assert.equal(wave.includes("extract_character_detail"), false);
      assert.equal(wave.includes("extract_character_relationships"), false);
      assert.ok(wave.length >= 5);
    });

    test("after list: detail becomes ready, not relationships", () => {
      const ready: Record<string, boolean> = {
        analyze_form: true,
        analyze_character_list: true,
        analyze_story_world: true,
        analyze_timeline: true,
        extract_style: true,
        extract_ideas: true,
      };
      const wave = listParallelReadyAgents(ready);
      assert.ok(wave.includes("extract_character_detail"));
      assert.equal(wave.includes("extract_character_relationships"), false);
    });

    test("all done: parallelReady empty", () => {
      const ready: Record<string, boolean> = {};
      for (const id of ANALYSIS_SUBAGENT_TYPES) ready[id] = true;
      assert.equal(listParallelReadyAgents(ready).length, 0);
    });

    test("wave-2 deps are only analyze_form", () => {
      for (const id of [
        "analyze_character_list",
        "analyze_story_world",
        "analyze_timeline",
        "extract_style",
        "extract_ideas",
      ] as const) {
        assert.deepEqual(
          [...(ANALYSIS_AGENT_DEPENDENCIES[id] || [])],
          ["analyze_form"],
        );
      }
    });
  });

  suite("groupPendingToolsForExecution", () => {
    test("write mode: every tool is its own serial wave", () => {
      const pending = [
        agent("generate_outline", "1"),
        agent("write_prose", "2"),
        tool("ask_question", "3", { question: "ok?" }),
      ];
      const waves = groupPendingToolsForExecution(pending, false);
      assert.equal(waves.length, 3);
      assert.ok(waves.every((w) => !w.parallel && w.tools.length === 1));
    });

    test("analysis: consecutive agents merge into one parallel wave", () => {
      const pending = [
        agent("analyze_character_list", "a"),
        agent("analyze_story_world", "b"),
        agent("analyze_timeline", "c"),
        agent("extract_style", "d"),
        agent("extract_ideas", "e"),
      ];
      const waves = groupPendingToolsForExecution(pending, true);
      assert.equal(waves.length, 1);
      assert.equal(waves[0].parallel, true);
      assert.equal(waves[0].tools.length, 5);
      assert.deepEqual(waveAgentTypes(waves[0]).sort(), [
        "analyze_character_list",
        "analyze_story_world",
        "analyze_timeline",
        "extract_ideas",
        "extract_style",
      ].sort());
    });

    test("analysis: single agent wave is not marked parallel", () => {
      const waves = groupPendingToolsForExecution(
        [agent("analyze_form", "1")],
        true,
      );
      assert.equal(waves.length, 1);
      assert.equal(waves[0].parallel, false);
      assert.equal(waves[0].tools.length, 1);
    });

    test("analysis: agent wave then ask_question then agent — three waves", () => {
      const pending = [
        agent("analyze_story_world", "1"),
        agent("extract_style", "2"),
        tool("ask_question", "3", { question: "save?" }),
        agent("extract_character_detail", "4"),
      ];
      const waves = groupPendingToolsForExecution(pending, true);
      assert.equal(waves.length, 3);
      assert.equal(waves[0].parallel, true);
      assert.equal(waves[0].tools.length, 2);
      assert.equal(waves[1].parallel, false);
      assert.equal(waves[1].tools[0].toolName, "ask_question");
      assert.equal(waves[2].parallel, false);
      assert.equal(waves[2].tools[0].args.agent_type, "extract_character_detail");
    });

    test("analysis: non-agent tools stay serial even when adjacent", () => {
      const pending = [
        tool("get_analysis_status", "1", {}),
        tool("get_current_novel", "2", {}),
      ];
      const waves = groupPendingToolsForExecution(pending, true);
      assert.equal(waves.length, 2);
      assert.ok(waves.every((w) => !w.parallel));
    });

    test("empty pending → empty waves", () => {
      assert.equal(groupPendingToolsForExecution([], true).length, 0);
    });
  });
}
