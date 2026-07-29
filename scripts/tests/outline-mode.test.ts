import { assert, suite, test } from "../lib/test-harness";
import { isOutlineRewritePrompt } from "../../src/core/agents/agents/outline";

export function runOutlineModeTests(): void {
  suite("isOutlineRewritePrompt", () => {
    test("first-write prompts are create", () => {
      assert.equal(isOutlineRewritePrompt("请为续写设计大纲"), false);
      assert.equal(isOutlineRewritePrompt("为本分支生成大纲并衔接前文"), false);
      assert.equal(
        isOutlineRewritePrompt("【任务模式:create】\n写大纲"),
        false,
      );
      // bare "findings" must not force rewrite
      assert.equal(
        isOutlineRewritePrompt("注意 findings 审查流程后写大纲"),
        false,
      );
    });

    test("rewrite markers are rewrite", () => {
      assert.equal(
        isOutlineRewritePrompt("【任务模式:rewrite】\n改大纲"),
        true,
      );
      assert.equal(
        isOutlineRewritePrompt("【系统强制改写大纲】审核未通过"),
        true,
      );
      assert.equal(isOutlineRewritePrompt("按审核意见修改大纲"), true);
      assert.equal(isOutlineRewritePrompt("用户要求修改大纲"), true);
    });
  });
}
