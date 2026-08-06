/**
 * After acceptContinuation: chapter meta boundary + catalog (D4).
 */
import { randomUUID } from "node:crypto";
import { assert, suiteAsync, testAsync } from "../lib/test-harness";
import { acceptContinuation } from "../../src/core/foreshadowing/accept-continuation";
import { _resetStore, saveProse } from "../../src/core/agents/intermediate-store";
import {
  deleteNovel,
  getBranchChapterMeta,
  importNovel,
  saveNovelForm,
  saveBranchChapterMeta,
  emptyBranchChapterMeta,
} from "../../src/lib/db";
import { extractChapterCatalog } from "../../src/core/form/chapter-catalog";
import type { NovelFormProfile } from "../../src/types";

const BODY =
  "雨落在青石板上，发出细碎的声响。顾深把斗笠压低，沿着巷口那盏将灭未灭的灯走去，" +
  "怀中的信纸被雨水洇出一圈淡痕，却仍能辨认出「旧桥」二字。巷更深了。";

function enabledForm(novelId: string): NovelFormProfile {
  return {
    novelId,
    formType: "web_novel",
    unitHierarchy: { volume: "absent", chapter: "present", section: "absent" },
    chaptering: {
      enabled: true,
      confidence: 0.9,
      numbering: "arabic_di_n_zhang",
      titlePattern: "第N章",
      separator: " ",
      samples: ["第1章 序", "第2章 雨"],
    },
    narrativeArchitecture: {
      primaryTemplate: "episodic",
      genreHints: [],
      evidenceNotes: "",
      povScheme: "unknown",
      timeScheme: "linear",
    },
    continuationRules: ["本书分章"],
  };
}

function disabledForm(novelId: string): NovelFormProfile {
  const f = enabledForm(novelId);
  f.formType = "essay_prose";
  f.chaptering = {
    enabled: false,
    confidence: 0.1,
    numbering: "none",
    titlePattern: "",
    separator: "",
    samples: [],
  };
  f.continuationRules = ["弱分章"];
  return f;
}

export async function runAcceptChapterMetaTests(): Promise<void> {
  await suiteAsync("accept chapter meta", async () => {
    await testAsync(
      "enabled + draft starts with 第K章 → catalog gains chapter (no boundary field)",
      async () => {
        _resetStore();
        const userId = `tu_${randomUUID().slice(0, 8)}`;
        const novelId = `tn_${randomUUID().slice(0, 8)}`;
        try {
          const base =
            "第1章 序\n" + "甲".repeat(80) + "\n\n第2章 雨\n" + "乙".repeat(80);
          importNovel(userId, novelId, "chap-novel", base);
          saveNovelForm(userId, novelId, enabledForm(novelId));
          saveBranchChapterMeta(userId, {
            ...emptyBranchChapterMeta(novelId, "main"),
            chapters: [
              {
                id: "c1",
                number: 1,
                title: "第1章 序",
                startOffset: 0,
                source: "regex",
              },
            ],
          });

          const draft = `第3章 桥\n${BODY}`;
          saveProse(novelId, "main", draft);
          const r = await acceptContinuation({
            userId,
            novelId,
            branchId: "main",
            content: draft,
          });
          assert.equal(r.ok, true, r.error || "accept failed");

          const meta = getBranchChapterMeta(userId, novelId, "main");
          assert.equal(
            (meta as { chapterBoundary?: unknown }).chapterBoundary,
            undefined,
          );
          assert.ok(
            meta.chapters.some(
              (c) =>
                c.number === 3 ||
                c.title.includes("桥") ||
                c.title.includes("第3章"),
            ),
            `catalog missing ch3: ${JSON.stringify(meta.chapters)}`,
          );
          const last = meta.chapters[meta.chapters.length - 1];
          assert.ok(
            last.endOffset != null && last.endOffset > last.startOffset,
            "last chapter endOffset should reach tip",
          );
        } finally {
          deleteNovel(userId, novelId);
          _resetStore();
        }
      },
    );

    await testAsync(
      "enabled + continue same chapter → last endOffset extends",
      async () => {
        _resetStore();
        const userId = `tu_${randomUUID().slice(0, 8)}`;
        const novelId = `tn_${randomUUID().slice(0, 8)}`;
        try {
          const base =
            "第1章 序\n" + "甲".repeat(80) + "\n\n第2章 雨\n" + "乙".repeat(80);
          importNovel(userId, novelId, "chap-novel", base);
          saveNovelForm(userId, novelId, enabledForm(novelId));
          const seeded = extractChapterCatalog(base);
          saveBranchChapterMeta(userId, {
            ...emptyBranchChapterMeta(novelId, "main"),
            chapters: seeded,
          });
          const beforeLen = base.length;
          const beforeLastEnd =
            getBranchChapterMeta(userId, novelId, "main").chapters.slice(-1)[0]
              ?.endOffset ?? beforeLen;

          const draft = BODY;
          saveProse(novelId, "main", draft);
          const r = await acceptContinuation({
            userId,
            novelId,
            branchId: "main",
            content: draft,
          });
          assert.equal(r.ok, true, r.error || "accept failed");

          const meta = getBranchChapterMeta(userId, novelId, "main");
          const tip = (r.branchText || "").length;
          assert.ok(tip > beforeLen, "branch text should grow");
          const last = meta.chapters[meta.chapters.length - 1];
          assert.ok(last, "catalog should still have chapters");
          assert.equal(
            last.endOffset,
            tip,
            `last endOffset should be tip ${tip}, got ${last.endOffset} (was ${beforeLastEnd})`,
          );
          assert.ok(
            meta.chapters.some((c) => c.number === 2 || c.title.includes("雨")),
            "chapter 2 should remain",
          );
        } finally {
          deleteNovel(userId, novelId);
          _resetStore();
        }
      },
    );

    await testAsync(
      "disabled chaptering → accept does not require chapter titles in meta",
      async () => {
        _resetStore();
        const userId = `tu_${randomUUID().slice(0, 8)}`;
        const novelId = `tn_${randomUUID().slice(0, 8)}`;
        try {
          importNovel(userId, novelId, "prose-novel", "长文无章。".repeat(20));
          saveNovelForm(userId, novelId, disabledForm(novelId));
          saveBranchChapterMeta(userId, {
            ...emptyBranchChapterMeta(novelId, "main"),
            chapters: [],
          });

          const draft = `第99章 不该入库\n${BODY}`;
          saveProse(novelId, "main", draft);
          const r = await acceptContinuation({
            userId,
            novelId,
            branchId: "main",
            content: draft,
          });
          assert.equal(r.ok, true, r.error || "accept failed");

          const meta = getBranchChapterMeta(userId, novelId, "main");
          assert.equal(meta.chapters.length, 0);
          assert.ok(
            !meta.chapters.some(
              (c) =>
                c.number === 99 ||
                c.title.includes("不该入库") ||
                c.title.includes("第99章"),
            ),
            `disabled chaptering must not catalog draft title: ${JSON.stringify(meta.chapters)}`,
          );
        } finally {
          deleteNovel(userId, novelId);
          _resetStore();
        }
      },
    );
  });
}
