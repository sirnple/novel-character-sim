import { assert, suite, test } from "../lib/test-harness";
import { parseToolCallArguments } from "../../src/core/llm/parse-tool-args";

export function runParseToolArgsTests(): void {
  suite("parseToolCallArguments", () => {
    test("valid JSON", () => {
      const a = parseToolCallArguments(
        JSON.stringify({ content: "这是一段足够长的大纲正文用来测试保存" }),
        "save_outline",
      );
      assert.ok(a);
      assert.ok(String(a!.content).includes("大纲"));
    });

    test("unescaped newlines inside content string", () => {
      // Intentionally invalid JSON (raw newline inside string)
      const raw =
        '{"content":"第一段大纲\n第二段大纲\n第三段还要再长一点才够五十个字左右吧对吧"}';
      const a = parseToolCallArguments(raw, "save_outline");
      assert.ok(a, "should salvage");
      assert.ok(String(a!.content).includes("第一段"));
      assert.ok(String(a!.content).includes("第二段"));
    });

    test("empty → null", () => {
      assert.equal(parseToolCallArguments("", "save_outline"), null);
    });

    test("truncated content marks __truncatedArgs", () => {
      // Unclosed JSON string (stream cut)
      const raw =
        '{"content":"这是一段被截断的正文还在继续写没有结束引号和括号';
      const a = parseToolCallArguments(raw, "save_prose");
      assert.ok(a);
      assert.equal(a!.__truncatedArgs, true);
      assert.ok(String(a!.content).includes("截断"));
    });
  });
}
