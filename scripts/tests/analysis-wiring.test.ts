/**
 * Analysis pipeline wiring: allowlist, tools, agents, workspace, form + domain submit.
 * Exercises shipped modules — not reimplementations.
 */
import { randomUUID } from "node:crypto";
import { assert, suiteAsync, test, testAsync } from "../lib/test-harness";
import {
  deleteNovel,
  importNovel,
  getNovelForm,
  getStoryInfo,
} from "../../src/lib/db";
import { initRegistry } from "../../src/core/agents/init";
import { getTool, buildToolSchemas } from "../../src/core/agents/registry";
import { getAgent } from "../../src/core/agents/agent-registry";
import {
  ANALYSIS_MASTER_TOOL_NAMES,
  ANALYSIS_SUBAGENT_TYPES,
  WRITE_SUBAGENT_TYPES,
  buildLaunchPlan,
  buildMasterAgentToolSchema,
  listDependencyChain,
  normalizeToolParametersForOpenAI,
  resolveAnalysisAgentType,
  toOpenAIFunctionTools,
} from "../../src/core/agents/analysis-allowlist";
// getAgent already imported above
import {
  beginNovelAnalysisWorkspace,
  getNovelAnalysisWorkspace,
  clearNovelAnalysisWorkspace,
} from "../../src/core/extractor/novel-analysis-workspace";
import { getCharacterExtractWorkspace } from "../../src/core/extractor/character-extract-workspace";
import { ANALYSIS_OK } from "../../src/core/agents/agents/analysis-tools";
import type { LLMProvider } from "../../src/types";

/** Dummy for tools that don't need LLM. */
const dummyLlm = {} as LLMProvider;

/**
 * Minimal mock for scan_character_mentions: chatWithTool returns 2–4 char CJK tokens
 * found in the unit text (simulates LLM unit mention extract).
 */
const unitScanLlm = {
  async chatWithTool(_messages: unknown, _schema: unknown) {
    const user = (_messages as { role: string; content: string }[]).find(
      (m) => m.role === "user",
    );
    const content = user?.content || "";
    // unit body is after label in prompt; pull CJK bigrams that look like names
    const found = new Set<string>();
    const re = /[\u4e00-\u9fff]{2,4}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) && found.size < 12) {
      const t = m[0];
      // Prefer common test names
      if (
        /孙|唐|猪|悟|僧|悟空|三藏|八戒|周|许|秦/.test(t) ||
        found.size < 4
      ) {
        found.add(t);
      }
    }
    // Always include 孙悟空/唐僧 if present in prompt text
    for (const n of ["孙悟空", "唐僧", "猪八戒"]) {
      if (content.includes(n)) found.add(n);
    }
    return {
      characters: Array.from(found)
        .slice(0, 10)
        .map((name) => ({ name, aliases: [] })),
    };
  },
  async chat() {
    return '{"characters":[]}';
  },
} as unknown as LLMProvider;

export async function runAnalysisWiringTests(): Promise<void> {
  await suiteAsync("analysis-wiring", async () => {
    test("normalizeToolParameters rejects empty properties trap", () => {
      const n = normalizeToolParametersForOpenAI({
        type: "object",
        properties: {},
        required: [],
      });
      assert.ok(Object.keys(n.properties).length >= 1, "empty props must be filled");
      assert.equal(n.type, "object");
    });

    test("toOpenAIFunctionTools produces non-empty parameter schemas", () => {
      const tools = toOpenAIFunctionTools([
        {
          name: "get_current_novel",
          description: "x",
          parameters: { type: "object", properties: {}, required: [] },
        },
        {
          name: "run_form_analysis",
          description: "y",
          parameters: {
            type: "object",
            properties: {
              forceRefresh: { type: "boolean", description: "f" },
            },
            required: [],
          },
        },
      ]);
      assert.equal(tools.length, 2);
      for (const t of tools) {
        assert.equal(t.type, "function");
        assert.ok(t.function.parameters.properties);
        assert.ok(Object.keys(t.function.parameters.properties).length >= 1);
      }
    });

    test("analysis allowlist tools are registered after initRegistry", () => {
      initRegistry();
      for (const n of ANALYSIS_MASTER_TOOL_NAMES) {
        if (n === "agent") {
          // agent schema is mode-built, but registry still has agent tool
          assert.ok(getTool("agent"), "agent dispatcher tool missing");
          continue;
        }
        assert.ok(getTool(n), `tool missing: ${n}`);
      }
      assert.ok(getTool("run_form_analysis"), "form program tool still registered for sub-agent");
      assert.ok(getTool("finish_novel_analysis"));
      // Master must not expose run_form_analysis — only agent(analyze_form)
      assert.ok(!(ANALYSIS_MASTER_TOOL_NAMES as readonly string[]).includes("run_form_analysis"));
      assert.ok((ANALYSIS_SUBAGENT_TYPES as readonly string[]).includes("analyze_form"));
      assert.ok(getAgent("analyze_form"), "analyze_form agent registered");
      // Domain work is not master tools
      assert.ok(!getTool("run_story_world_agent"), "run_*_agent wrappers must not exist");
      assert.ok(!ANALYSIS_MASTER_TOOL_NAMES.includes("scan_character_mentions" as any));
      assert.ok(!ANALYSIS_MASTER_TOOL_NAMES.includes("get_kept_roster" as any));
    });

    test("mode-scoped agent() schema: analysis ≠ write enums", () => {
      const a = buildMasterAgentToolSchema("analysis");
      const w = buildMasterAgentToolSchema("write");
      assert.equal(a.name, "agent");
      assert.equal(w.name, "agent");
      const aEnum = (a.parameters.properties as any).agent_type.enum as string[];
      const wEnum = (w.parameters.properties as any).agent_type.enum as string[];
      for (const id of ANALYSIS_SUBAGENT_TYPES) {
        assert.ok(aEnum.includes(id), `analysis enum missing ${id}`);
      }
      for (const id of WRITE_SUBAGENT_TYPES) {
        assert.ok(wEnum.includes(id), `write enum missing ${id}`);
      }
      assert.ok(!aEnum.includes("write_prose"), "analysis master must not see write_prose");
      assert.ok(!wEnum.includes("analyze_story_world"), "write master must not see analysis agents");
      assert.ok(
        String(a.description).includes("子 Agent") || String(a.description).includes("调度"),
        "agent description must mark sub-agent dispatch",
      );
    });

    test("each analysis sub-agent is registered for agent(agent_type=...)", () => {
      initRegistry();
      for (const agentId of ANALYSIS_SUBAGENT_TYPES) {
        assert.ok(getAgent(agentId), `agent not registered: ${agentId}`);
      }
    });

    test("resolveAnalysisAgentType maps truncated analyze_story → analyze_story_world", () => {
      assert.equal(resolveAnalysisAgentType("analyze_story"), "analyze_story_world");
      assert.equal(resolveAnalysisAgentType("analyze_story_world"), "analyze_story_world");
      assert.equal(resolveAnalysisAgentType("story_world"), "analyze_story_world");
      assert.equal(resolveAnalysisAgentType("analyze_character"), "analyze_character_list");
      assert.equal(resolveAnalysisAgentType("extract_character"), "extract_character_detail");
      // write agents pass through unchanged
      assert.equal(resolveAnalysisAgentType("write_prose"), "write_prose");
    });

    test("launch plan runs missing deps before target", () => {
      assert.deepEqual(listDependencyChain("extract_character_relationships"), [
        "analyze_form",
        "analyze_character_list",
        "extract_character_detail",
      ]);
      const empty = buildLaunchPlan("extract_character_detail", {
        analyze_form: false,
        analyze_character_list: false,
        extract_character_detail: false,
      });
      assert.deepEqual(empty.sequence, [
        "analyze_form",
        "analyze_character_list",
        "extract_character_detail",
      ]);
      const mid = buildLaunchPlan("extract_character_detail", {
        analyze_form: true,
        analyze_character_list: true,
        extract_character_detail: false,
      });
      assert.deepEqual(mid.sequence, ["extract_character_detail"]);
      assert.ok(mid.note.includes("直接派") || mid.missingDeps.length === 0, mid.note);
      const ready = buildLaunchPlan("analyze_story_world", {
        analyze_form: true,
        analyze_story_world: true,
      });
      assert.equal(ready.sequence.length, 0);
      assert.ok(ready.ready);
    });

    await testAsync(
      "get_current_novel/branch + form + story submit on real novel",
      async () => {
        initRegistry();
        const userId = `au_${randomUUID().slice(0, 8)}`;
        const novelId = `an_${randomUUID().slice(0, 8)}`;
        const branchId = "main";
        const text =
          "第一章 孙悟空出世\n\n话说孙悟空大闹天宫。齐天大圣不服。\n\n" +
          "第二章 唐僧取经\n\n唐僧带孙悟空、猪八戒西行。\n\n".repeat(8);
        try {
          importNovel(userId, novelId, "西游测试", text);
          beginNovelAnalysisWorkspace(userId, novelId, branchId, {
            fullText: text,
            forceRefresh: true,
          });

          const ctx = { userId, novelId, branchId };
          const novelTool = getTool("get_current_novel")!;
          const branchTool = getTool("get_current_branch")!;
          const formTool = getTool("run_form_analysis")!;
          const storyTool = getTool("submit_story_world")!;
          const finishTool = getTool("finish_novel_analysis")!;
          const scanTool = getTool("scan_character_mentions")!;

          const nRes = await novelTool.execute({}, ctx, dummyLlm);
          assert.ok(nRes.content.includes(novelId), nRes.content);
          assert.ok(
            nRes.content.includes("西游测试") || nRes.content.includes(novelId),
          );

          const bRes = await branchTool.execute({}, ctx, dummyLlm);
          assert.ok(bRes.content.includes(branchId), bRes.content);
          assert.ok(bRes.content.includes(novelId));

          const fRes = await formTool.execute({ forceRefresh: true }, ctx, dummyLlm);
          assert.ok(
            fRes.content.includes(ANALYSIS_OK.form) ||
              fRes.content.includes("章法") ||
              fRes.content.includes("就绪"),
            fRes.content,
          );
          // Before finish: form is only in workspace, not DB
          assert.ok(
            !getNovelForm(userId, novelId),
            "form must not hit DB until finish_novel_analysis",
          );
          const ws = getNovelAnalysisWorkspace(userId, novelId, branchId);
          assert.ok(ws?.form, "form staged in workspace");
          assert.ok(ws?.units && ws.units.length >= 1, "units in workspace");

          // Second call without force should skip, not re-LLM
          const fSkip = await formTool.execute({}, ctx, dummyLlm);
          assert.ok(
            fSkip.content.includes("跳过") || fSkip.content.includes("就绪"),
            `expected skip message, got: ${fSkip.content}`,
          );
          const statusTool = getTool("get_analysis_status")!;
          const st = await statusTool.execute({}, ctx, dummyLlm);
          assert.ok(st.content.includes("nextActions") || st.content.includes("form"), st.content);
          assert.ok(st.content.includes('"form": true') || st.content.includes("form\": true"), st.content);

          // scan_character_mentions = LLM unit mention extract (agent-callable tool)
          const sRes = await getTool("scan_character_mentions")!.execute(
            { forceRefresh: true },
            ctx,
            unitScanLlm,
          );
          assert.ok(
            sRes.content.includes(ANALYSIS_OK.scan) ||
              sRes.content.includes("指称") ||
              sRes.content.includes("扫"),
            sRes.content,
          );
          assert.ok(sRes.content.trim().length > 20, "scan tool must return non-empty summary");
          assert.ok(
            sRes.content.includes("候选") || sRes.content.includes("surfaces="),
            sRes.content,
          );
          assert.ok(
            sRes.content.includes("LLM") || sRes.content.includes("分段") || sRes.content.includes("catalog"),
            `should state LLM mention catalog: ${sRes.content.slice(0, 120)}`,
          );
          const cws = getCharacterExtractWorkspace(userId, novelId, branchId);
          assert.ok(
            (cws?.catalog?.stats?.length || 0) >= 1,
            `character catalog surfaces got ${cws?.catalog?.stats?.length}`,
          );

          const storyJson = JSON.stringify({
            plotSummary: "孙悟空随唐僧西行。",
            mainStoryline: "取经",
            worldSetting: {
              timePeriod: "唐",
              location: "东土/西天",
              socialStructure: "神魔",
            },
          });
          const stRes = await storyTool.execute(
            { story_json: storyJson },
            ctx,
            dummyLlm,
          );
          assert.ok(stRes.content.includes(ANALYSIS_OK.story), stRes.content);
          assert.ok(
            !getStoryInfo(userId, novelId)?.plotSummary,
            "story must not hit DB until finish",
          );
          assert.ok(
            getNovelAnalysisWorkspace(userId, novelId, branchId)?.storyInfo?.plotSummary,
            "story staged in workspace",
          );

          const finNo = await finishTool.execute({}, ctx, dummyLlm);
          assert.ok(
            finNo.content.includes("未落库") || finNo.content.includes("确认"),
            finNo.content,
          );
          assert.ok(!getNovelForm(userId, novelId), "no DB write without userConfirmed");

          const fin = await finishTool.execute({ userConfirmed: true }, ctx, dummyLlm);
          assert.ok(fin.content.includes(ANALYSIS_OK.finish), fin.content);
          assert.ok(getNovelForm(userId, novelId), "form committed to DB on finish");
          assert.ok(
            getStoryInfo(userId, novelId)?.plotSummary,
            "story committed to DB on finish",
          );

          // Staging survives "process" via sqlite: re-read after clear mem by re-get
          // (finish clears workspace; commit path already verified via DB above)
        } finally {
          clearNovelAnalysisWorkspace(userId, novelId, branchId);
          deleteNovel(userId, novelId);
        }
      },
    );
  });
}
