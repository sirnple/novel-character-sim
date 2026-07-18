/**
 * Agent markdown frontmatter: parse, strip, allowlist tools, schema resolve.
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  parseAgentFrontmatter,
  stripFrontmatter,
} from "../../src/core/prompts/frontmatter";
import {
  loadPromptFile,
  loadPromptFrontmatter,
  clearPromptFileCache,
} from "../../src/core/prompts/renderer";
import {
  getAgentAllowedTools,
  resolveAgentToolSchemas,
} from "../../src/core/prompts/agent-tools";
import { AGENT_PROMPT_FILES } from "../../src/core/prompts/agent-prompt-map";
import { initRegistry } from "../../src/core/agents/init";

export function runAgentFrontmatterTests(): void {
  suite("agent-frontmatter", () => {
    test("every AGENT_PROMPT_FILES primary system has name/description/tools", () => {
      clearPromptFileCache();
      for (const [agentId, files] of Object.entries(AGENT_PROMPT_FILES)) {
        const systemFiles = [files.system, files.systemEn].filter(Boolean) as string[];
        for (const file of systemFiles) {
          const fm = loadPromptFrontmatter(file);
          assert.equal(typeof fm.name, "string", `${agentId}/${file} name`);
          assert.ok(String(fm.name).length > 0, `${agentId}/${file} name non-empty`);
          assert.equal(typeof fm.description, "string", `${agentId}/${file} description`);
          assert.ok(Array.isArray(fm.tools), `${agentId}/${file} tools array`);
          // extraction agents: empty tools; writing agents: non-empty
          if (
            agentId === "master" ||
            agentId.startsWith("writer_") ||
            agentId === "outline_writer" ||
            agentId.includes("review")
          ) {
            assert.ok(
              (fm.tools as string[]).length > 0,
              `${agentId}/${file} should declare tools`,
            );
          }
        }
      }
    });
    test("parseAgentFrontmatter extracts name/description/tools list", () => {
      const raw = `---
name: demo
description: "Hello world"
tools:
  - get_outline
  - save_outline
---
You are the body.
`;
      const doc = parseAgentFrontmatter(raw);
      assert.equal(doc.hasFrontmatter, true);
      assert.equal(doc.frontmatter.name, "demo");
      assert.equal(doc.frontmatter.description, "Hello world");
      assert.deepEqual(doc.frontmatter.tools, ["get_outline", "save_outline"]);
      assert.ok(doc.body.startsWith("You are the body"));
      assert.ok(stripFrontmatter(raw).startsWith("You are the body"));
    });

    test("parseAgentFrontmatter supports inline tools", () => {
      const raw = `---
name: inline
tools: a, b, c
---
Body
`;
      const doc = parseAgentFrontmatter(raw);
      assert.deepEqual(doc.frontmatter.tools, ["a", "b", "c"]);
    });

    test("parseAgentFrontmatter without header returns raw body", () => {
      const raw = "No frontmatter here.";
      const doc = parseAgentFrontmatter(raw);
      assert.equal(doc.hasFrontmatter, false);
      assert.equal(doc.body, raw);
    });

    test("loadPromptFile strips master frontmatter; tools deny prose", () => {
      clearPromptFileCache();
      const body = loadPromptFile("master-system.md");
      assert.equal(body.startsWith("---"), false);
      assert.ok(body.includes("小说创作主编"));

      const fm = loadPromptFrontmatter("master-system.md");
      assert.equal(fm.name, "master");
      assert.ok(Array.isArray(fm.tools));
      const tools = fm.tools as string[];
      assert.ok(tools.includes("agent"));
      assert.equal(tools.includes("get_prose"), false);
      assert.equal(tools.includes("save_prose"), false);
    });

    test("getAgentAllowedTools matches outline / writer / review / extraction", () => {
      clearPromptFileCache();
      const outline = getAgentAllowedTools("outline_writer");
      assert.ok(outline.includes("save_outline"));
      assert.ok(outline.includes("get_novel_form"));

      const create = getAgentAllowedTools("writer_create");
      const rewrite = getAgentAllowedTools("writer_rewrite");
      assert.ok(create.includes("get_outline") && create.includes("save_prose"));
      assert.ok(rewrite.includes("get_prose") && rewrite.includes("get_findings"));
      assert.equal(create.includes("get_prose"), false);

      const fsTools = getAgentAllowedTools("foreshadowing_review");
      assert.ok(fsTools.includes("save_foreshadowing_realization"));
      assert.equal(fsTools.includes("save_findings"), false);

      assert.deepEqual(getAgentAllowedTools("character_list"), []);
    });

    test("resolveAgentToolSchemas builds schemas after initRegistry", () => {
      clearPromptFileCache();
      initRegistry();
      const master = resolveAgentToolSchemas("master");
      const names = master.map((s) => s.name);
      assert.ok(names.includes("agent"));
      assert.ok(names.includes("ask_question"));
      assert.equal(names.includes("save_prose"), false);
      assert.ok(master.every((s) => s.description && s.parameters));

      const writer = resolveAgentToolSchemas("writer_create");
      assert.ok(writer.some((s) => s.name === "save_prose"));
    });
  });
}
