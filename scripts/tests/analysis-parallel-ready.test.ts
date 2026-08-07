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
  partitionAnalysisPending,
  isWriteReadyFromDomainMap,
  ANALYSIS_OPTIONAL_DOMAINS,
  ANALYSIS_WRITE_REQUIRED_DOMAINS,
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
    test("before form: only chapter_structure_indexer is ready to launch", () => {
      const ready: Record<string, boolean> = {};
      const wave = listParallelReadyAgents(ready);
      assert.deepEqual(wave, ["chapter_structure_indexer"]);
    });

    test("after form agent ready: five domains that only need form", () => {
      const ready: Record<string, boolean> = {
        chapter_structure_indexer: true,
      };
      const wave = listParallelReadyAgents(ready);
      assert.ok(wave.includes("character_list"));
      assert.ok(wave.includes("story_world"));
      assert.ok(wave.includes("timeline"));
      assert.ok(wave.includes("style"));
      assert.ok(wave.includes("ideas"));
      assert.equal(wave.includes("character_detail"), false);
      assert.equal(wave.includes("character_relationships"), false);
      assert.ok(wave.length >= 5);
    });

    test("after list: detail becomes ready, not relationships", () => {
      const ready: Record<string, boolean> = {
        form: true,
        character_list: true,
        story_world: true,
        timeline: true,
        style: true,
        ideas: true,
      };
      const wave = listParallelReadyAgents(ready);
      assert.ok(wave.includes("character_detail"));
      assert.equal(wave.includes("character_relationships"), false);
    });

    test("all done: parallelReady empty", () => {
      const ready: Record<string, boolean> = {};
      for (const id of ANALYSIS_SUBAGENT_TYPES) ready[id] = true;
      assert.equal(listParallelReadyAgents(ready).length, 0);
    });

    test("wave-2 deps are only chapter_structure_indexer", () => {
      for (const id of [
        "character_list",
        "story_world",
        "timeline",
        "style",
        "ideas",
      ] as const) {
        assert.deepEqual(
          [...(ANALYSIS_AGENT_DEPENDENCIES[id] || [])],
          ["chapter_structure_indexer"],
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
        agent("character_list", "a"),
        agent("story_world", "b"),
        agent("timeline", "c"),
        agent("style", "d"),
        agent("ideas", "e"),
      ];
      const waves = groupPendingToolsForExecution(pending, true);
      assert.equal(waves.length, 1);
      assert.equal(waves[0].parallel, true);
      assert.equal(waves[0].tools.length, 5);
      assert.deepEqual(waveAgentTypes(waves[0]).sort(), [
        "character_list",
        "story_world",
        "timeline",
        "ideas",
        "style",
      ].sort());
    });

    test("analysis: single agent wave is not marked parallel", () => {
      const waves = groupPendingToolsForExecution(
        [agent("chapter_structure_indexer", "1")],
        true,
      );
      assert.equal(waves.length, 1);
      assert.equal(waves[0].parallel, false);
      assert.equal(waves[0].tools.length, 1);
    });

    test("analysis: agent wave then ask_question then agent — three waves", () => {
      const pending = [
        agent("story_world", "1"),
        agent("style", "2"),
        tool("ask_question", "3", { question: "save?" }),
        agent("character_detail", "4"),
      ];
      const waves = groupPendingToolsForExecution(pending, true);
      assert.equal(waves.length, 3);
      assert.equal(waves[0].parallel, true);
      assert.equal(waves[0].tools.length, 2);
      assert.equal(waves[1].parallel, false);
      assert.equal(waves[1].tools[0].toolName, "ask_question");
      assert.equal(waves[2].parallel, false);
      assert.equal(waves[2].tools[0].args.agent_type, "character_detail");
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

  suite("timeline optional for write / wrap-up", () => {
    test("timeline is the only optional domain by default", () => {
      assert.deepEqual([...ANALYSIS_OPTIONAL_DOMAINS], ["timeline"]);
    });

    test("partitionAnalysisPending isolates timeline", () => {
      const { pendingRequired, pendingOptional } = partitionAnalysisPending([
        "style",
        "timeline",
        "ideas",
      ]);
      assert.deepEqual(pendingOptional, ["timeline"]);
      assert.deepEqual(pendingRequired.sort(), ["ideas", "style"].sort());
    });

    test("writeReady needs form + story + character_list only", () => {
      assert.equal(
        isWriteReadyFromDomainMap({
          form: true,
          story: true,
          character_list: true,
          timeline: false,
        }),
        true,
      );
      assert.equal(
        isWriteReadyFromDomainMap({
          form: true,
          story: true,
          character_list: false,
        }),
        false,
      );
      assert.ok(ANALYSIS_WRITE_REQUIRED_DOMAINS.includes("form"));
      assert.ok(ANALYSIS_WRITE_REQUIRED_DOMAINS.includes("story"));
      assert.ok(ANALYSIS_WRITE_REQUIRED_DOMAINS.includes("character_list"));
      assert.equal(
        (ANALYSIS_WRITE_REQUIRED_DOMAINS as readonly string[]).includes(
          "timeline",
        ),
        false,
      );
    });
  });
}
