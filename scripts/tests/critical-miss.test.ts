/**
 * Critical get-miss helpers — shipped critical-miss.ts
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  CRITICAL_MISS_PREFIX,
  askUserForCriticalMiss,
  formatCriticalMiss,
  isCriticalGetTool,
  isCriticalMissContent,
  parseCriticalMiss,
} from "../../src/core/agents/critical-miss";

export function runCriticalMissTests(): void {
  suite("critical-miss", () => {
    test("isCriticalGetTool marks get_outline/get_prose/get_branch_text", () => {
      assert.equal(isCriticalGetTool("get_outline"), true);
      assert.equal(isCriticalGetTool("get_prose"), true);
      assert.equal(isCriticalGetTool("get_branch_text"), true);
      assert.equal(isCriticalGetTool("save_prose"), false);
      assert.equal(isCriticalGetTool("get_findings"), false);
    });

    test("formatCriticalMiss + isCriticalMissContent + parseCriticalMiss", () => {
      const raw = formatCriticalMiss("outline", "大纲未生成（key=n::main）");
      assert.ok(raw.includes(CRITICAL_MISS_PREFIX));
      assert.ok(raw.includes("kind=outline"));
      assert.equal(isCriticalMissContent(raw), true);
      assert.equal(isCriticalMissContent("普通错误"), false);

      const parsed = parseCriticalMiss(raw);
      assert.ok(parsed);
      assert.equal(parsed!.kind, "outline");
      assert.ok(parsed!.message.includes("大纲未生成"));
    });

    test("askUserForCriticalMiss builds non-empty question + options", () => {
      const content = formatCriticalMiss("prose", "正文草稿未生成");
      const ask = askUserForCriticalMiss("get_prose", content);
      assert.ok(ask.question.length > 0);
      assert.ok(ask.question.includes("get_prose") || ask.question.includes("正文"));
      assert.ok(Array.isArray(ask.options));
      assert.ok(ask.options.length >= 2);
      assert.equal(ask.missKind, "prose");
      assert.equal(ask.toolName, "get_prose");
    });

    test("askUserForCriticalMiss outline options differ from default", () => {
      const content = formatCriticalMiss("outline", "missing");
      const ask = askUserForCriticalMiss("get_outline", content);
      assert.ok(ask.options.some((o) => o.includes("大纲") || o.includes("重新")));
    });
  });
}
