/**
 * Phase 2: CoW branches + append without novels dual-write.
 */
import { randomUUID } from "node:crypto";
import { assert, suite, test } from "../lib/test-harness";
import {
  appendBranchContent,
  createCowBranch,
  deleteNovel,
  getBranch,
  getBranchProse,
  getNovel,
  importNovel,
  listBranches,
  resolveBranchText,
} from "../../src/lib/db";
import { splitIntoChunks, VIRTUAL_CHUNK_CHARS } from "../../src/components/virtual-novel-body";

export function runBranchCowTests(): void {
  suite("branch CoW + append", () => {
    test("createCowBranch stores empty suffix; resolve rebuilds parent prefix", () => {
      const userId = `cow_u_${randomUUID().slice(0, 8)}`;
      const novelId = `cow_n_${randomUUID().slice(0, 8)}`;
      const base = "第一章。" + "甲".repeat(200) + "分叉点之后本不该在子分支后缀里。";
      try {
        importNovel(userId, novelId, "cow-test", base);
        const offset = 50;
        const row = createCowBranch(userId, novelId, "if1", "支线", "main", offset);
        assert.equal(row.storage, "cow");
        assert.equal(row.parent_branch_id, "main");
        assert.equal((row.text || "").length, 0);
        assert.ok((row.char_count || 0) === offset);

        const resolved = resolveBranchText(userId, novelId, "if1");
        assert.equal(resolved, base.slice(0, offset));
        assert.equal(resolved.length, offset);

        // Stored row text stays small
        const raw = getBranch(userId, novelId, "if1");
        assert.equal((raw?.text || "").length, 0);
      } finally {
        deleteNovel(userId, novelId);
      }
    });

    test("append on CoW only grows suffix; does not rewrite novels.text", () => {
      const userId = `cow_u_${randomUUID().slice(0, 8)}`;
      const novelId = `cow_n_${randomUUID().slice(0, 8)}`;
      const base = "原文固定快照。" + "乙".repeat(100);
      try {
        importNovel(userId, novelId, "cow-append", base);
        const novelBefore = getNovel(userId, novelId)?.text || "";
        createCowBranch(userId, novelId, "if2", "支线2", "main", 20);
        const addition =
          "续写段落一。" + "丙".repeat(80) + "这是足够长的续写内容用于追加测试。";
        appendBranchContent(userId, novelId, "if2", addition);

        const raw = getBranch(userId, novelId, "if2");
        assert.equal(raw?.storage, "cow");
        assert.ok((raw?.text || "").includes("续写段落一"));
        // Suffix only — should not contain full original prefix length as stored blob
        assert.ok((raw?.text || "").length < base.length + addition.length);

        const full = getBranchProse(userId, novelId, "if2").text;
        assert.ok(full.startsWith(base.slice(0, 20)));
        assert.ok(full.includes("续写段落一"));
        assert.equal(raw?.char_count, full.length);

        // novels.text remains import snapshot (no dual-write of main either on IF)
        assert.equal(getNovel(userId, novelId)?.text, novelBefore);
      } finally {
        deleteNovel(userId, novelId);
      }
    });

    test("append on main updates branch + total_length, not novels.text body", () => {
      const userId = `cow_u_${randomUUID().slice(0, 8)}`;
      const novelId = `cow_n_${randomUUID().slice(0, 8)}`;
      const base = "主线原文。" + "丁".repeat(80);
      try {
        importNovel(userId, novelId, "main-append", base);
        const snap = getNovel(userId, novelId)?.text || "";
        const add =
          "主线续写内容足够长，用于验证不再双写 novels 全文。" + "戊".repeat(40);
        appendBranchContent(userId, novelId, "main", add);
        const main = getBranchProse(userId, novelId, "main").text;
        assert.ok(main.includes("主线续写"));
        assert.ok(main.length > base.length);
        // Import snapshot unchanged
        assert.equal(getNovel(userId, novelId)?.text, snap);
        const meta = listBranches(userId, novelId).find((b) => b.id === "main");
        assert.ok(meta && meta.char_count === main.length);
      } finally {
        deleteNovel(userId, novelId);
      }
    });

    test("splitIntoChunks for virtual scroll", () => {
      const text = "字".repeat(VIRTUAL_CHUNK_CHARS * 3 + 10);
      const chunks = splitIntoChunks(text);
      assert.equal(chunks.length, 4);
      assert.equal(chunks[0].baseOffset, 0);
      assert.equal(chunks[1].baseOffset, VIRTUAL_CHUNK_CHARS);
      assert.equal(chunks.map((c) => c.text).join(""), text);
    });
  });
}
