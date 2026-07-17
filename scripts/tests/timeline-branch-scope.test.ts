/**
 * Branch-scoped timeline storage + job hydrate normalization.
 */
import { randomUUID } from "node:crypto";
import { assert, suite, test } from "../lib/test-harness";
import {
  deleteNovel,
  getTimeline,
  importNovel,
  saveTimeline,
  getChapterStates,
  saveChapterStates,
  saveTimelineJobRow,
  getTimelineJobRow,
} from "../../src/lib/db";
import type { ChapterTimeline, CharacterChapterState } from "../../src/types";
import {
  normalizeJobAfterHydrate,
  type TimelineJob,
} from "../../src/core/form/timeline-job";

export function runTimelineBranchScopeTests(): void {
  suite("timeline branch scope", () => {
    test("main and if branch timelines do not clobber each other", () => {
      const userId = `tu_${randomUUID().slice(0, 8)}`;
      const novelId = `tn_${randomUUID().slice(0, 8)}`;
      try {
        importNovel(userId, novelId, "t", "前文。".repeat(20));
        const mainTl: ChapterTimeline = {
          novelId,
          totalChapters: 1,
          chapters: [{ chapterNumber: 1, title: "主线", events: [], characterStates: [] }],
        };
        const ifTl: ChapterTimeline = {
          novelId,
          totalChapters: 1,
          chapters: [{ chapterNumber: 1, title: "支线", events: [], characterStates: [] }],
        };
        saveTimeline(userId, novelId, mainTl, "main");
        saveTimeline(userId, novelId, ifTl, "if_test");
        assert.equal(getTimeline(userId, novelId, "main")?.chapters[0]?.title, "主线");
        assert.equal(getTimeline(userId, novelId, "if_test")?.chapters[0]?.title, "支线");
      } finally {
        deleteNovel(userId, novelId);
      }
    });

    test("default branchId is main for get/save", () => {
      const userId = `tu_${randomUUID().slice(0, 8)}`;
      const novelId = `tn_${randomUUID().slice(0, 8)}`;
      try {
        importNovel(userId, novelId, "t", "文");
        saveTimeline(userId, novelId, {
          novelId,
          totalChapters: 0,
          chapters: [],
        });
        assert.ok(getTimeline(userId, novelId) != null);
        assert.ok(getTimeline(userId, novelId, "main") != null);
      } finally {
        deleteNovel(userId, novelId);
      }
    });

    test("chapter_states are branch-scoped", () => {
      const userId = `tu_${randomUUID().slice(0, 8)}`;
      const novelId = `tn_${randomUUID().slice(0, 8)}`;
      try {
        importNovel(userId, novelId, "t", "文");
        const st: CharacterChapterState[] = [
          {
            characterId: "c1",
            name: "甲",
            lastSeenChapter: 1,
            alive: true,
            location: "城",
            delta: "出现",
          },
        ];
        saveChapterStates(userId, novelId, st, "main");
        saveChapterStates(userId, novelId, [], "if_x");
        assert.equal(getChapterStates(userId, novelId, "main").length, 1);
        assert.equal(getChapterStates(userId, novelId, "if_x").length, 0);
      } finally {
        deleteNovel(userId, novelId);
      }
    });

    test("normalizeJobAfterHydrate marks running as error", () => {
      const job: TimelineJob = {
        id: "tljob_x",
        userId: "u",
        novelId: "n",
        branchId: "main",
        status: "running",
        total: 3,
        completed: 1,
        units: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const n = normalizeJobAfterHydrate(job);
      assert.equal(n.status, "error");
      assert.ok((n.error || "").includes("重启"));
    });

    test("timeline job row round-trip", () => {
      const userId = `tu_${randomUUID().slice(0, 8)}`;
      const novelId = `tn_${randomUUID().slice(0, 8)}`;
      const id = `tljob_${randomUUID().slice(0, 8)}`;
      try {
        importNovel(userId, novelId, "t", "文");
        const job: TimelineJob = {
          id,
          userId,
          novelId,
          branchId: "main",
          status: "done",
          total: 2,
          completed: 2,
          units: [
            {
              unitId: "u1",
              label: "第1章",
              startOffset: 0,
              endOffset: 10,
              status: "done",
              summary: "开场",
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        saveTimelineJobRow(job);
        const loaded = getTimelineJobRow(id);
        assert.ok(loaded);
        assert.equal(loaded!.id, id);
        assert.equal(loaded!.status, "done");
      } finally {
        deleteNovel(userId, novelId);
      }
    });
  });
}
