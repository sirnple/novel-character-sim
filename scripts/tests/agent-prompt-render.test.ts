/**
 * Agent prompt rendering: {{vars}}, {{#blocks}}, frontmatter strip, registry variables.
 * Uses md defaults only (getDefaultPromptFromMd) so tests do not depend on Admin DB overrides.
 */
import { assert, suite, test } from "../lib/test-harness";
import { AGENT_REGISTRY } from "../../src/core/prompts/registry";
import { getDefaultPromptFromMd } from "../../src/core/prompts/resolve-agent-prompt";
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
  const defaults = getDefaultPromptFromMd(agentId, language);
  assert.ok(defaults, `defaults missing for ${agentId}/${language}`);
  return {
    systemTpl: defaults!.systemPrompt,
    userTpl: defaults!.userPromptTemplate,
    system: renderTemplate(defaults!.systemPrompt, vars),
    user: renderTemplate(defaults!.userPromptTemplate, vars),
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

    test("renderTemplate does not leave frontmatter when used via getDefaultPromptFromMd", () => {
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
        "writer_create",
        "zh",
        sampleVars(["prompt", "novelId", "branchId"]),
      );
      assert.ok(writer.user.includes("__VAR_prompt__"));
      assert.ok(writer.user.includes("__VAR_novelId__"));
      assert.ok(writer.user.includes("__VAR_branchId__"));
      assert.equal(writer.user.includes("{{prompt}}"), false);

      const review = renderAgent(
        "character_consistency_review",
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

    test("extraction agents render zh (and en when bilingual)", () => {
      clearPromptFileCache();
      const cases: Array<{
        id: string;
        vars: string[];
        expectIn: "system" | "user";
        check: string;
      }> = [
        {
          id: "character_names_unit",
          vars: ["unitLabel", "unitText"],
          expectIn: "system",
          check: "unitLabel",
        },
        {
          id: "character_list",
          vars: ["novelContext", "frequencyRoster"],
          expectIn: "system",
          check: "frequencyRoster",
        },
        {
          id: "character_detail",
          vars: ["characterName", "characterBrief", "characterRole", "novelContext"],
          expectIn: "system",
          check: "characterName",
        },
        {
          id: "relationships",
          vars: ["characterNames", "novelContext"],
          expectIn: "system",
          check: "characterNames",
        },
        {
          id: "chapter_end_states",
          vars: ["recentText", "knownNames"],
          expectIn: "system",
          check: "knownNames",
        },
        {
          id: "story_info",
          vars: ["novelContext"],
          expectIn: "system",
          check: "novelContext",
        },
        {
          id: "timeline",
          vars: ["chapterTitle", "truncated"],
          expectIn: "system",
          check: "chapterTitle",
        },
        {
          id: "timeline_states",
          vars: ["chapterTitle", "truncated", "knownNames", "prevStateDesc"],
          expectIn: "system",
          check: "prevStateDesc",
        },
        {
          id: "style_extract",
          vars: ["title", "novelContext"],
          expectIn: "user",
          check: "title",
        },
        {
          id: "idea_extract",
          vars: ["title", "novelContext"],
          expectIn: "user",
          check: "title",
        },
      ];

      for (const c of cases) {
        const vars = sampleVars(c.vars);
        const zh = renderAgent(c.id, "zh", vars);
        const text = c.expectIn === "system" ? zh.system : zh.user;
        assert.ok(
          text.includes(`__VAR_${c.check}__`),
          `${c.id}/zh missing ${c.check}`,
        );
        for (const v of c.vars) {
          // only assert no leftover if the placeholder actually exists in that side
          const tpl = c.expectIn === "system" ? zh.systemTpl : zh.userTpl;
          if (tpl.includes(`{{${v}}}`)) {
            assert.equal(
              text.includes(`{{${v}}}`),
              false,
              `${c.id}/zh leftover {{${v}}}`,
            );
          }
        }

        const meta = AGENT_REGISTRY.find((a) => a.agentId === c.id);
        if (meta?.bilingual) {
          const en = renderAgent(c.id, "en", vars);
          const enText = c.expectIn === "system" ? en.system : en.user;
          assert.ok(
            enText.includes(`__VAR_${c.check}__`),
            `${c.id}/en missing ${c.check}`,
          );
          assert.equal(enText.startsWith("---"), false, `${c.id}/en frontmatter leaked`);
        }
      }
    });

    test("every AGENT_REGISTRY agent: declared vars used in templates are substituted", () => {
      clearPromptFileCache();
      for (const meta of AGENT_REGISTRY) {
        const vars = sampleVars(meta.variables);
        const languages = meta.bilingual ? (["zh", "en"] as const) : (["zh"] as const);

        for (const lang of languages) {
          const r = renderAgent(meta.agentId, lang, vars);
          assert.equal(
            r.system.startsWith("---"),
            false,
            `${meta.agentId}/${lang} system still has frontmatter`,
          );
          assert.equal(
            r.system.includes("\ntools:\n") || r.system.includes("\ntools:"),
            false,
            `${meta.agentId}/${lang} tools frontmatter leaked into body`,
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
                `${meta.agentId}/${lang} did not render {{${path}}}`,
              );
              assert.equal(
                combinedOut.includes(`{{${path}}}`),
                false,
                `${meta.agentId}/${lang} leftover {{${path}}}`,
              );
            } else if (meta.variables.includes(key) && !path.includes(".")) {
              assert.ok(
                combinedOut.includes(`__VAR_${key}__`),
                `${meta.agentId}/${lang} did not render {{${key}}}`,
              );
            }
          }

          // Every registry variable that appears as {{var}} in templates must be filled
          for (const v of meta.variables) {
            if (combinedTpl.includes(`{{${v}}}`)) {
              assert.ok(
                combinedOut.includes(`__VAR_${v}__`),
                `${meta.agentId}/${lang} registry var ${v} not rendered`,
              );
              assert.equal(
                combinedOut.includes(`{{${v}}}`),
                false,
                `${meta.agentId}/${lang} leftover {{${v}}}`,
              );
            }
          }
        }
      }
    });

    test("outline-user block vars: previousProse / worldBible nested", () => {
      clearPromptFileCache();
      // Legacy simulation outline user template (not AGENT_PROMPT_FILES user for outline_writer)
      const withBlocks = renderPrompt("outline-user.md", {
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

      const withoutOptional = renderPrompt("outline-user.md", {
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

    test("outline_writer agent user renders prompt/novelId/branchId", () => {
      clearPromptFileCache();
      const r = renderAgent(
        "outline_writer",
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
