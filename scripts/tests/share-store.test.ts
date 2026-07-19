import { randomUUID } from "node:crypto";
import { assert, suite, test } from "../lib/test-harness";
import {
  createShareOverview,
  deleteNovel,
  getShareOverviewByToken,
  importNovel,
  listShareOverviews,
  revokeShareOverview,
  revokeShareOverviewsForNovel,
  updateShareVisibility,
} from "../../src/lib/db";
import { buildSharePayload, mintShareToken } from "../../src/lib/share-payload";

export function runShareStoreTests(): void {
  suite("share-store", () => {
    test("create + get by token; list active", () => {
      const userId = `sh_u_${randomUUID().slice(0, 8)}`;
      const novelId = `sh_n_${randomUUID().slice(0, 8)}`;
      try {
        importNovel(userId, novelId, "分享测试", "这是正文不应出现在列表里。");
        const token = mintShareToken();
        const payload = buildSharePayload({
          title: "分享测试",
          story: null,
          characters: [],
        });
        // empty characters+null story still allowed at store layer
        createShareOverview({
          token,
          ownerUserId: userId,
          novelId,
          visibility: "public",
          payload: {
            ...payload,
            story: {
              title: "分享测试",
              plotSummary: "摘要",
              mainStoryline: "",
              subPlots: [],
              chapterOutlines: [],
              worldSetting: {
                timePeriod: "",
                location: "",
                socialStructure: "",
                powerSystem: "",
                factions: [],
                rules: [],
                atmosphere: "",
              },
              backgroundInfo: "",
              themes: [],
              writingStyle: {
                genre: "",
                styleDescription: "",
                narrativeTechniques: [],
                languageFeatures: "",
                pacingDescription: "",
                tone: "",
                examplePassages: [],
                contentRating: "G",
              },
            },
          },
        });
        const row = getShareOverviewByToken(token);
        assert.ok(row);
        assert.equal(row!.token, token);
        assert.equal(row!.ownerUserId, userId);
        assert.equal(row!.novelId, novelId);
        assert.equal(row!.visibility, "public");
        assert.equal(row!.revokedAt, null);
        assert.equal(row!.payload.title, "分享测试");

        const list = listShareOverviews(userId, novelId);
        assert.equal(list.length, 1);
        assert.equal(list[0].url, `/share/${token}`);
        assert.ok(!JSON.stringify(list).includes("这是正文"));
      } finally {
        deleteNovel(userId, novelId);
      }
    });

    test("revoke is idempotent for owner; wrong owner forbidden", () => {
      const userId = `sh_u_${randomUUID().slice(0, 8)}`;
      const other = `sh_u_${randomUUID().slice(0, 8)}`;
      const novelId = `sh_n_${randomUUID().slice(0, 8)}`;
      try {
        importNovel(userId, novelId, "T", "body");
        const token = mintShareToken();
        createShareOverview({
          token,
          ownerUserId: userId,
          novelId,
          visibility: "auth",
          payload: buildSharePayload({ title: "T", story: null, characters: [] }),
        });
        assert.equal(revokeShareOverview(token, other).ok, false);
        assert.equal((revokeShareOverview(token, other) as { reason: string }).reason, "forbidden");
        assert.equal(revokeShareOverview(token, userId).ok, true);
        assert.equal(revokeShareOverview(token, userId).ok, true); // idempotent
        const row = getShareOverviewByToken(token);
        assert.ok(row?.revokedAt);
        const active = listShareOverviews(userId, novelId);
        assert.equal(active.length, 0);
        const all = listShareOverviews(userId, novelId, { includeRevoked: true });
        assert.equal(all.length, 1);
      } finally {
        deleteNovel(userId, novelId);
      }
    });

    test("update visibility; deleteNovel revokes shares", () => {
      const userId = `sh_u_${randomUUID().slice(0, 8)}`;
      const novelId = `sh_n_${randomUUID().slice(0, 8)}`;
      try {
        importNovel(userId, novelId, "T", "body");
        const token = mintShareToken();
        createShareOverview({
          token,
          ownerUserId: userId,
          novelId,
          visibility: "public",
          payload: buildSharePayload({ title: "T", story: null, characters: [] }),
        });
        const up = updateShareVisibility(token, userId, "auth");
        assert.equal(up.ok, true);
        assert.equal(getShareOverviewByToken(token)?.visibility, "auth");

        deleteNovel(userId, novelId);
        const after = getShareOverviewByToken(token);
        assert.ok(after?.revokedAt, "deleteNovel should revoke shares");
      } finally {
        // novel already deleted; revoke cleanup no-op
        try {
          deleteNovel(userId, novelId);
        } catch {
          /* ignore */
        }
      }
    });

    test("revokeShareOverviewsForNovel bulk", () => {
      const userId = `sh_u_${randomUUID().slice(0, 8)}`;
      const novelId = `sh_n_${randomUUID().slice(0, 8)}`;
      try {
        importNovel(userId, novelId, "T", "body");
        const t1 = mintShareToken();
        const t2 = mintShareToken();
        for (const token of [t1, t2]) {
          createShareOverview({
            token,
            ownerUserId: userId,
            novelId,
            visibility: "public",
            payload: buildSharePayload({ title: "T", story: null, characters: [] }),
          });
        }
        revokeShareOverviewsForNovel(userId, novelId);
        assert.ok(getShareOverviewByToken(t1)?.revokedAt);
        assert.ok(getShareOverviewByToken(t2)?.revokedAt);
      } finally {
        deleteNovel(userId, novelId);
      }
    });
  });
}
