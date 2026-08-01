/**
 * AnalysisSession full mode must survive multi-turn continue.
 */
import { randomUUID } from "node:crypto";
import { assert, suiteAsync, testAsync } from "../lib/test-harness";
import { deleteNovel, importNovel } from "../../src/lib/db";
import {
  getNovelAnalysisWorkspace,
} from "../../src/core/extractor/novel-analysis-workspace";
import {
  ensureAnalysisSession,
  isFullAnalysisSession,
} from "../../src/core/extractor/analysis-session";
import {
  isUserConfirmSave,
  isUserForceFullReanalyze,
} from "../../src/lib/analysis-confirm";

export async function runAnalysisForceRefreshFlagTests(): Promise<void> {
  await suiteAsync("analysis-session", async () => {
    await testAsync("full session survives continue turns", async () => {
      const userId = `fr_${randomUUID().slice(0, 8)}`;
      const novelId = `n_${randomUUID().slice(0, 8)}`;
      const branchId = "main";
      const text = "第一章\n正文\n".repeat(20);
      try {
        importNovel(userId, novelId, "测试", text);
        const started = ensureAnalysisSession({
          userId,
          novelId,
          branchId,
          mode: "full",
          fullText: text,
        });
        assert.equal(started.full, true);
        assert.equal(started.seededForm, true);
        assert.equal(
          isFullAnalysisSession({ userId, novelId, branchId }),
          true,
        );
        assert.ok(
          getNovelAnalysisWorkspace(userId, novelId, branchId)?.form,
          "full start seeds form",
        );

        // Next chat turn (same session, not another one-click)
        const cont = ensureAnalysisSession({
          userId,
          novelId,
          branchId,
          mode: "continue",
        });
        assert.equal(cont.full, true, "continue must keep full mode");
        assert.equal(
          isFullAnalysisSession({ userId, novelId, branchId }),
          true,
        );
        assert.ok(
          getNovelAnalysisWorkspace(userId, novelId, branchId)?.form,
          "staging kept across continue",
        );
      } finally {
        deleteNovel(userId, novelId);
      }
    });

    await testAsync("isUserForceFullReanalyze is strict", async () => {
      assert.equal(isUserForceFullReanalyze("重新分析"), false);
      assert.equal(isUserForceFullReanalyze("全部重新分析"), false);
      assert.equal(isUserForceFullReanalyze("确认保存到本书"), false);
      assert.equal(isUserForceFullReanalyze("全书强制重跑（含章法，很慢）"), true);
      assert.equal(isUserForceFullReanalyze("全书重跑，清空覆盖章法"), true);
    });

    await testAsync(
      "isUserConfirmSave rejects one-click prompts (must not auto-commit)",
      async () => {
        const oneClick =
          "【一键分析】从头分析当前小说，所有分析都要执行，不用询问是否执行。遇到审查问题，最多修复三轮。";
        assert.equal(isUserConfirmSave(oneClick), false, "one-click text");
        assert.equal(isUserConfirmSave("确认保存到本书"), true);
        assert.equal(isUserConfirmSave("保存分析结果"), true);
        assert.equal(isUserConfirmSave("好的，保存"), true);
        assert.equal(isUserConfirmSave("请保存到本书"), true);
        assert.equal(isUserConfirmSave("保存"), true);
        assert.equal(
          isUserConfirmSave("请先分析故事，写完后再谈保存"),
          false,
        );
      },
    );
  });
}
