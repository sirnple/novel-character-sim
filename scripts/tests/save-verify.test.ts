/**
 * toolSaveSucceeded / lastToolResult from shipped save-verify.ts
 */
import { assert, suite, test } from "../lib/test-harness";
import { lastToolResult, toolSaveSucceeded } from "../../src/core/agents/save-verify";
import type { TrailMessage } from "../../src/core/agents/types";
import { SAVE_PROSE_OK_PREFIX, SAVE_PROSE_REJECT_PREFIX } from "../../src/core/agents/prose-guard";

export function runSaveVerifyTests(): void {
  suite("save-verify", () => {
    test("toolSaveSucceeded reports not called", () => {
      const trail: TrailMessage[] = [
        { role: "assistant", content: "thinking" },
      ];
      const r = toolSaveSucceeded(trail, "save_prose", SAVE_PROSE_OK_PREFIX);
      assert.equal(r.called, false);
      assert.equal(r.ok, false);
    });

    test("toolSaveSucceeded reports called + ok with success marker", () => {
      const trail: TrailMessage[] = [
        { role: "tool_call", toolName: "save_prose", content: "{}" },
        {
          role: "tool_result",
          toolName: "save_prose",
          content: `${SAVE_PROSE_OK_PREFIX}，共 120 字`,
        },
      ];
      const r = toolSaveSucceeded(trail, "save_prose", SAVE_PROSE_OK_PREFIX);
      assert.equal(r.called, true);
      assert.equal(r.ok, true);
      assert.ok(r.detail.includes(SAVE_PROSE_OK_PREFIX));
    });

    test("toolSaveSucceeded called but not ok when reject / wrong marker", () => {
      const trail: TrailMessage[] = [
        {
          role: "tool_result",
          toolName: "save_prose",
          content: `${SAVE_PROSE_REJECT_PREFIX}：内容像审查清单`,
        },
      ];
      const r = toolSaveSucceeded(trail, "save_prose", SAVE_PROSE_OK_PREFIX);
      assert.equal(r.called, true);
      assert.equal(r.ok, false);
    });

    test("toolSaveSucceeded uses last matching tool_result", () => {
      const trail: TrailMessage[] = [
        {
          role: "tool_result",
          toolName: "save_outline",
          content: "失败",
        },
        {
          role: "tool_result",
          toolName: "save_outline",
          content: "大纲已存，len=200",
        },
      ];
      const r = toolSaveSucceeded(trail, "save_outline", "大纲已存");
      assert.equal(r.called, true);
      assert.equal(r.ok, true);
      assert.equal(lastToolResult(trail, "save_outline"), "大纲已存，len=200");
    });

    test("lastToolResult empty when none", () => {
      assert.equal(lastToolResult([], "save_prose"), "");
    });
  });
}
