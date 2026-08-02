/**
 * Server-owned AgentRun (OpenCode-style loop ownership).
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  appendAgentRunEvent,
  cancelAgentRun,
  createAgentRun,
  getAgentRun,
  getAgentRunEventsAfter,
  setAgentRunStatus,
} from "../../src/core/agents/agent-run";

export function runAgentRunTests(): void {
  suite("agent-run", () => {
    test("create + append events with monotonic seq", () => {
      const run = createAgentRun({
        userId: "u1",
        novelId: "n1",
        branchId: "main",
        mode: "analysis",
      });
      assert.ok(run.id.startsWith("arun_"));
      assert.equal(run.status, "running");

      appendAgentRunEvent(run.id, { type: "agent_run", runId: run.id });
      appendAgentRunEvent(run.id, { type: "chunk", content: "hi" });
      appendAgentRunEvent(run.id, { type: "tool_call", tool: "agent", status: "running" });

      const all = getAgentRunEventsAfter(run.id, 0);
      assert.equal(all.length, 3);
      assert.equal(all[0]!.seq, 1);
      assert.equal(all[2]!.seq, 3);

      const after1 = getAgentRunEventsAfter(run.id, 1);
      assert.equal(after1.length, 2);
      assert.equal(after1[0]!.seq, 2);
    });

    test("ask_question sets awaiting_user; done sets done", () => {
      const run = createAgentRun({
        userId: "u2",
        novelId: "n2",
        branchId: "main",
        mode: "analysis",
      });
      appendAgentRunEvent(run.id, {
        type: "ask_question",
        question: "保存？",
      });
      assert.equal(getAgentRun(run.id)?.status, "awaiting_user");

      setAgentRunStatus(run.id, "running");
      appendAgentRunEvent(run.id, { type: "done" });
      // appendEvent only promotes running→done on type done
      assert.equal(getAgentRun(run.id)?.status, "done");
    });

    test("cancel aborts and marks cancelled", () => {
      const run = createAgentRun({
        userId: "u3",
        novelId: "n3",
        branchId: "main",
        mode: "analysis",
      });
      assert.equal(run.abort.signal.aborted, false);
      const ok = cancelAgentRun(run.id);
      assert.equal(ok, true);
      assert.equal(getAgentRun(run.id)?.status, "cancelled");
      assert.equal(run.abort.signal.aborted, true);
    });
  });
}
