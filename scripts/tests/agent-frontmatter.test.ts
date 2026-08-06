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
import { AGENT_FILE_SPECS, loadAgentConfig, clearAgentConfigCache, listAgentConfigs } from "../../src/core/agents/agent-config";
import { initRegistry } from "../../src/core/agents/init";

export function runAgentFrontmatterTests(): void {
  suite("agent-frontmatter", () => {
    test("every agent system md: frontmatter name is source of AgentConfig.name", () => {
      clearPromptFileCache();
      clearAgentConfigCache();
      for (const spec of AGENT_FILE_SPECS) {
        const fm = loadPromptFrontmatter(spec.system);
        assert.equal(typeof fm.name, "string", `${spec.system} name`);
        assert.ok(String(fm.name).trim().length > 0, `${spec.system} name non-empty`);
        assert.equal(typeof fm.description, "string", `${spec.system} description`);
        assert.ok(Array.isArray(fm.tools), `${spec.system} tools array`);

        const cfg = loadAgentConfig(String(fm.name));
        assert.ok(cfg, `AgentConfig for ${fm.name}`);
        assert.equal(cfg!.name, String(fm.name).trim(), "config.name === frontmatter name");
        assert.equal(cfg!.description, String(fm.description));

        if (
          cfg!.name === "master" ||
          cfg!.name.startsWith("writer_") ||
          cfg!.name === "outline_creator" ||
          cfg!.name === "outline_rewriter" ||
          cfg!.name.includes("review")
        ) {
          assert.ok(
            (fm.tools as string[]).length > 0,
            `${cfg!.name} should declare tools`,
          );
        }
      }
      assert.ok(listAgentConfigs().length === AGENT_FILE_SPECS.length);
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
      const creator = getAgentAllowedTools("outline_creator");
      assert.ok(creator.includes("save_outline"));
      assert.ok(creator.includes("get_novel_form"));
      assert.equal(creator.includes("get_outline"), false);

      const oRewrite = getAgentAllowedTools("outline_rewriter");
      assert.ok(oRewrite.includes("get_outline") && oRewrite.includes("save_outline"));

      const create = getAgentAllowedTools("writer");
      const rewrite = getAgentAllowedTools("rewriter");
      assert.ok(create.includes("get_outline") && create.includes("save_prose"));
      assert.ok(rewrite.includes("get_prose") && rewrite.includes("get_findings"));
      assert.equal(create.includes("get_prose"), false);

      const fsTools = getAgentAllowedTools("foreshadow_reviewer");
      assert.ok(fsTools.includes("save_foreshadowing_realization"));
      assert.equal(fsTools.includes("save_findings"), false);

      const novel = getAgentAllowedTools("analyst");
      assert.ok(novel.includes("agent"));
      assert.ok(novel.includes("finish_novel_analysis"));
      assert.equal(novel.includes("save_prose"), false);
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

      const writer = resolveAgentToolSchemas("writer");
      assert.ok(writer.some((s) => s.name === "save_prose"));
    });
  });
}
