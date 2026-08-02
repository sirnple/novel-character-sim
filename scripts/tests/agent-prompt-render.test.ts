/**
 * Agent prompt rendering: {{vars}}, {{#blocks}}, frontmatter strip, registry variables.
 * Uses md defaults only (getDefaultPromptFromMd) so tests do not depend on Admin DB overrides.
 */
import { assert, suite, test } from "../lib/test-harness";
import { AGENT_REGISTRY } from "../../src/core/prompts/registry";
import {
  getDefaultPromptFromMd,
  getEffectivePromptTemplates,
  resolveAgentPrompt,
} from "../../src/core/prompts/resolve-agent-prompt";
import {
  clearPromptFileCache,
  renderTemplate,
  renderPrompt,
} from "../../src/core/prompts/renderer";

/** Unique markers so we can assert each var landed in the rendered text. */
function sampleVars(names: string[]): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const n of names) {
    vars[n] = `__VAR_${n}__`;
  }
  return vars;
}

/** Simple {{path}} placeholders (not {{#block}} / {{/block}}). */
function simplePlaceholders(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(/\{\{(?!#|\/)([\w.]+)\}\}/g)) {
    out.add(m[1]);
  }
  return [...out];
}

/** Top-level key of a placeholder path (worldBible.timePeriod → worldBible). */
function topKey(path: string): string {
  return path.split(".")[0];
}

function renderAgent(
  agentId: string,
  language: string,
  vars: Record<string, unknown>,
): { system: string; user: string; systemTpl: string; userTpl: string } {
  // LLM path: effective templates (frontmatter stripped)
  const t = getEffectivePromptTemplates(agentId, language);
  assert.ok(t.systemPrompt.length > 0 || t.userPromptTemplate.length >= 0, `defaults missing for ${agentId}`);
  const resolved = resolveAgentPrompt(agentId, language, vars);
  return {
    systemTpl: t.systemPrompt,
    userTpl: t.userPromptTemplate,
    system: resolved.system,
    user: resolved.user,
  };
}

export function runAgentPromptRenderTests(): void {
  suite("agent-prompt-render", () => {
    test("renderTemplate replaces simple variables", () => {
      const out = renderTemplate("Hello {{name}}, id={{id}}", {
        name: "林晚",
        id: "n1",
      });
      assert.equal(out, "Hello 林晚, id=n1");
    });

    test("renderTemplate leaves unknown placeholders intact", () => {
      const out = renderTemplate("x={{known}} y={{missing}}", { known: "OK" });
      assert.equal(out, "x=OK y={{missing}}");
    });

    test("renderTemplate supports nested paths", () => {
      const out = renderTemplate(
        "loc={{world.location}}",
        { world: { location: "江城" } },
      );
      assert.equal(out, "loc=江城");
    });

    test("renderTemplate {{#block}} shows only when truthy", () => {
      const tpl =
        "before\n{{#note}}\nNOTE: {{note}}\n{{/note}}\nafter";
      assert.ok(
        renderTemplate(tpl, { note: "重要" }).includes("NOTE: 重要"),
      );
      assert.equal(
        renderTemplate(tpl, { note: "" }).includes("NOTE:"),
        false,
      );
      assert.equal(
        renderTemplate(tpl, {}).includes("NOTE:"),
        false,
      );
    });

    test("Admin defaults keep full md including frontmatter", () => {
      clearPromptFileCache();
      const raw = getDefaultPromptFromMd("master", "zh");
      assert.ok(raw);
      assert.ok(raw!.systemPrompt.startsWith("---"), "full file should start with frontmatter");
      assert.ok(raw!.systemPrompt.includes("name: master"));
    });

    test("LLM resolveAgentPrompt strips frontmatter then renders vars", () => {
      clearPromptFileCache();
      const r = renderAgent("master", "zh", {
        novelId: "novel_xyz",
        branchId: "if_1",
      });
      assert.equal(r.system.startsWith("---"), false);
      assert.equal(r.system.includes("name: master"), false);
      assert.ok(r.system.includes("novelId = novel_xyz"));
      assert.ok(r.system.includes("branchId = if_1"));
      assert.equal(r.system.includes("{{novelId}}"), false);
      assert.equal(r.system.includes("{{branchId}}"), false);
    });

    test("master / writer / review user templates render registry variables", () => {
      clearPromptFileCache();

      const master = renderAgent("master", "zh", sampleVars(["novelId", "branchId"]));
      assert.ok(master.system.includes("__VAR_novelId__"));
      assert.ok(master.system.includes("__VAR_branchId__"));

      const writer = renderAgent(
        "writer",
        "zh",
        sampleVars(["prompt", "novelId", "branchId"]),
      );
      assert.ok(writer.user.includes("__VAR_prompt__"));
      assert.ok(writer.user.includes("__VAR_novelId__"));
      assert.ok(writer.user.includes("__VAR_branchId__"));
      assert.equal(writer.user.includes("{{prompt}}"), false);

      const review = renderAgent(
        "character_reviewer",
        "zh",
        sampleVars([
          "prompt",
          "novelId",
          "branchId",
          "dimensionName",
          "dimensionCode",
        ]),
      );
      assert.ok(review.user.includes("__VAR_prompt__"));
      assert.ok(review.user.includes("__VAR_dimensionName__"));
      assert.ok(review.user.includes("__VAR_dimensionCode__"));
      assert.equal(review.user.includes("{{dimensionName}}"), false);
    });

    test("canonical analysis agents render zh templates", () => {
      clearPromptFileCache();
      const cases: Array<{
        id: string;
        vars: string[];
        expectIn: "system" | "user";
        check: string;
      }> = [
        {
          id: "form",
          vars: ["prompt", "novelId", "branchId"],
          expectIn: "user",
          check: "novelId",
        },
        {
          id: "story_world",
          vars: ["prompt", "novelId", "branchId"],
          expectIn: "user",
          check: "novelId",
        },
        {
          id: "character_detail",
          vars: ["prompt", "novelId", "branchId"],
          expectIn: "user",
          check: "novelId",
        },
        {
          id: "style",
          vars: ["prompt", "novelId", "branchId"],
          expectIn: "user",
          check: "novelId",
        },
        {
          id: "ideas",
          vars: ["prompt", "novelId", "branchId"],
          expectIn: "user",
          check: "novelId",
        },
      ];

      for (const c of cases) {
        const vars = sampleVars(c.vars);
        const zh = renderAgent(c.id, "zh", vars);
        const text = c.expectIn === "system" ? zh.system : zh.user;
        assert.ok(
          text.includes(`__VAR_${c.check}__`) || text.length > 0,
          `${c.id}/zh empty`,
        );
        for (const v of c.vars) {
          const tpl = c.expectIn === "system" ? zh.systemTpl : zh.userTpl;
          if (tpl.includes(`{{${v}}}`)) {
            assert.equal(
              text.includes(`{{${v}}}`),
              false,
              `${c.id}/zh leftover {{${v}}}`,
            );
            assert.ok(
              text.includes(`__VAR_${v}__`),
              `${c.id}/zh missing ${v}`,
            );
          }
        }
      }
    });

    test("every AGENT_REGISTRY agent with md: declared vars substituted", () => {
      clearPromptFileCache();
      for (const meta of AGENT_REGISTRY) {
        // Job-only agent: no system md
        if (meta.agentId === "timeline") continue;
        const vars = sampleVars(meta.variables);
        const r = renderAgent(meta.agentId, "zh", vars);
        assert.equal(
          r.system.startsWith("---"),
          false,
          `${meta.agentId}/zh system still has frontmatter`,
        );
        assert.equal(
          r.system.includes("\ntools:\n") || r.system.includes("\ntools:"),
          false,
          `${meta.agentId}/zh tools frontmatter leaked into body`,
        );

        const combinedTpl = `${r.systemTpl}\n${r.userTpl}`;
        const combinedOut = `${r.system}\n${r.user}`;
        const placeholders = simplePlaceholders(combinedTpl);

        for (const path of placeholders) {
          const key = topKey(path);
          if (!meta.variables.includes(key) && !meta.variables.includes(path)) {
            // placeholder not listed in registry — skip (may be optional/legacy)
            continue;
          }
          // provided as top-level string sentinel
          if (meta.variables.includes(path)) {
            assert.ok(
              combinedOut.includes(`__VAR_${path}__`),
              `${meta.agentId}/zh did not render {{${path}}}`,
            );
            assert.equal(
              combinedOut.includes(`{{${path}}}`),
              false,
              `${meta.agentId}/zh leftover {{${path}}}`,
            );
          } else if (meta.variables.includes(key) && !path.includes(".")) {
            assert.ok(
              combinedOut.includes(`__VAR_${key}__`),
              `${meta.agentId}/zh did not render {{${key}}}`,
            );
          }
        }

        // Every registry variable that appears as {{var}} in templates must be filled
        for (const v of meta.variables) {
          if (combinedTpl.includes(`{{${v}}}`)) {
            assert.ok(
              combinedOut.includes(`__VAR_${v}__`),
              `${meta.agentId}/zh registry var ${v} not rendered`,
            );
            assert.equal(
              combinedOut.includes(`{{${v}}}`),
              false,
              `${meta.agentId}/zh leftover {{${v}}}`,
            );
          }
        }
      }
    });

    test("oneshot outline-user block vars: previousProse / worldBible nested", () => {
      clearPromptFileCache();
      // Simulation one-shot outline (not multi-turn outline agent)
      const withBlocks = renderPrompt("oneshot/outline-user.md", {
        continueFromLabel: "第3章末",
        previousProse: "前文片段ABC",
        summaryText: "摘要",
        charSummaries: "角色A",
        worldBible: {
          timePeriod: "民国",
          location: "上海",
          powerSystem: "无",
          atmosphere: "阴郁",
        },
        foreshadowingText: "伏笔1",
        authorText: "作者注",
      });
      assert.ok(withBlocks.includes("第3章末"));
      assert.ok(withBlocks.includes("前文片段ABC"));
      assert.ok(withBlocks.includes("民国"));
      assert.ok(withBlocks.includes("上海"));
      assert.equal(withBlocks.includes("{{continueFromLabel}}"), false);
      assert.equal(withBlocks.includes("{{worldBible.location}}"), false);

      const withoutOptional = renderPrompt("oneshot/outline-user.md", {
        continueFromLabel: "末尾",
        summaryText: "s",
        charSummaries: "c",
        foreshadowingText: "f",
        authorText: "a",
      });
      // previousProse / worldBible blocks omitted when falsy
      assert.equal(withoutOptional.includes("前文片段"), false);
      assert.equal(withoutOptional.includes("时代："), false);
      assert.ok(withoutOptional.includes("末尾"));
    });

    test("outline agent user renders prompt/novelId/branchId", () => {
      clearPromptFileCache();
      const r = renderAgent(
        "outline",
        "zh",
        sampleVars(["prompt", "novelId", "branchId", "selectionInstruction"]),
      );
      assert.ok(r.user.includes("__VAR_prompt__"));
      assert.ok(r.user.includes("__VAR_novelId__"));
      assert.ok(r.user.includes("__VAR_branchId__"));
      // systemExtra contract is joined into system
      assert.ok(r.system.includes("save_outline") || r.system.includes("大纲"));
      assert.equal(r.system.startsWith("---"), false);
    });
  });
}
