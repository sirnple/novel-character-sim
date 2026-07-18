# Share Novel Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let novel owners generate permanent, revocable token links that show a snapshot overview (story/world + character summaries, no body text), with default public access and optional login-only visibility.

**Architecture:** Opaque share tokens stored in SQLite (`share_overviews`) with a JSON payload built by a field-whitelist snapshot builder. Owner CRUD via `/api/share`; public/auth read via `/api/share/[token]` and page `/share/[token]`. Overview UI gets a share dialog.

**Tech Stack:** Next.js 14 App Router, React client components, better-sqlite3 (`src/lib/db.ts`), existing `resolveAuth` / `getUserId`, project test harness (`scripts/lib/test-harness.ts` + `npm test`).

## Global Constraints

- Work only in worktree branch `feature/share-novel-overview` (path `.worktrees/share-novel-overview`).
- Never put novel body text, drafts, simulations, or `novel_id` / `owner_user_id` in public share API responses.
- Character snapshot uses a **field whitelist**; omit `drive.secret` always.
- Snapshot at create time; `PATCH` changes visibility only (no resnapshot).
- `auth` visibility: only `resolveAuth().kind === "user"` (guest is not logged in).
- Missing and revoked tokens both return HTTP 404 with `{ error: "not_found" }`.
- Delete novel must revoke that user's shares for the novel (`revoked_at` set).
- Follow AGENTS.md: no direct Anthropic/OpenAI SDK usage (N/A for this feature); bilingual UI copy Chinese-first to match app.
- Spec: `docs/superpowers/specs/2026-07-19-share-novel-overview-design.md`

## File map

| Path | Responsibility |
|------|----------------|
| `src/lib/share-payload.ts` | Types, `mintShareToken`, `buildSharePayload`, `toShareCharacter` |
| `src/lib/db.ts` | Schema + share CRUD + cascade revoke in `deleteNovel` |
| `src/app/api/share/route.ts` | `POST` create, `GET` list by novelId |
| `src/app/api/share/[token]/route.ts` | `GET` payload, `PATCH` visibility, `DELETE` revoke |
| `src/components/share-overview-view.tsx` | Read-only presentational UI from payload |
| `src/app/share/[token]/page.tsx` | Share page (load + states) |
| `src/components/share-dialog.tsx` | Owner generate/list/revoke/copy UI |
| `src/app/novel/[id]/page.tsx` | Wire「分享概览」button + dialog |
| `scripts/tests/share-payload.test.ts` | Builder unit tests |
| `scripts/tests/share-store.test.ts` | DB share store tests |
| `scripts/run-tests.ts` | Register new suites |

---

### Task 1: Share payload types + builder (TDD)

**Files:**
- Create: `src/lib/share-payload.ts`
- Create: `scripts/tests/share-payload.test.ts`
- Modify: `scripts/run-tests.ts`

**Interfaces:**
- Produces:
  - `ShareVisibility = "public" | "auth"`
  - `ShareCharacter` (whitelist shape)
  - `ShareOverviewPayload` (`version: 1`, title, language?, generatedAt, story, characters)
  - `mintShareToken(): string`
  - `toShareCharacter(c: CharacterProfile): ShareCharacter`
  - `buildSharePayload(input: { title: string; language?: string; story: StoryInfo | null; characters: CharacterProfile[]; generatedAt?: string }): ShareOverviewPayload`

- [ ] **Step 1: Write failing tests**

Create `scripts/tests/share-payload.test.ts`:

```ts
/**
 * Share overview snapshot builder — no body text, character whitelist.
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  buildSharePayload,
  mintShareToken,
  toShareCharacter,
} from "../../src/lib/share-payload";
import type { CharacterProfile, StoryInfo } from "../../src/types";

function minimalCharacter(over: Partial<CharacterProfile> & { name: string }): CharacterProfile {
  return {
    id: over.id || "c1",
    name: over.name,
    aliases: over.aliases || [],
    appearance: over.appearance || { summary: "" },
    personality: over.personality || {
      traits: [],
      description: "",
      decisionStyle: "",
      underPressure: "",
    },
    drive: over.drive || {
      goal: "",
      motivation: "",
      fear: "",
      weakness: "",
      bottomLine: "",
      secret: "",
    },
    behavior: over.behavior || {
      patterns: [],
      habits: [],
      attitudeToAuthority: "",
    },
    worldview: over.worldview || "",
    values: over.values || [],
    speakingStyle: over.speakingStyle || {
      description: "",
      catchphrases: [],
      sentenceStyle: "",
      vocabulary: "",
      emotionalExpression: "",
    },
    voice: over.voice || { description: "" },
    background: over.background || {
      origin: "",
      keyEvents: [],
      description: "",
    },
    relationships: over.relationships || [],
  };
}

export function runSharePayloadTests(): void {
  suite("share-payload", () => {
    test("mintShareToken is long enough and url-safe-ish", () => {
      const t = mintShareToken();
      assert.ok(t.length >= 20);
      assert.equal(t, encodeURIComponent(t));
      const t2 = mintShareToken();
      assert.notEqual(t, t2);
    });

    test("toShareCharacter omits secret and non-whitelist fields", () => {
      const full = minimalCharacter({
        name: "林黛玉",
        aliases: ["颦颦"],
        appearance: { summary: "娇弱" },
        personality: {
          traits: ["敏感"],
          description: "多愁",
          decisionStyle: "感性",
          underPressure: "哭",
        },
        drive: {
          goal: "真情",
          motivation: "孤独",
          fear: "抛弃",
          weakness: "体弱",
          bottomLine: "不屈",
          secret: "绝密不可外传",
        },
        relationships: [
          {
            characterId: "x",
            characterName: "贾宝玉",
            type: "知己",
            description: "木石前盟",
            history: "long history should not fully force include",
            dynamics: "密",
          },
        ],
      });
      const s = toShareCharacter(full);
      const json = JSON.stringify(s);
      assert.equal(s.name, "林黛玉");
      assert.deepEqual(s.aliases, ["颦颦"]);
      assert.equal(s.drive?.goal, "真情");
      assert.equal(s.drive?.motivation, "孤独");
      assert.equal(s.drive?.fear, "抛弃");
      assert.ok(!("secret" in (s.drive || {})));
      assert.ok(!json.includes("绝密不可外传"));
      assert.ok(!("decisionStyle" in (s.personality || {})));
      assert.ok(!("weakness" in (s.drive || {})));
      assert.ok(!("background" in s));
      assert.ok(!("speakingStyle" in s));
      assert.equal(s.relationships?.[0]?.characterName, "贾宝玉");
      assert.equal(s.relationships?.[0]?.type, "知己");
      assert.equal(s.relationships?.[0]?.description, "木石前盟");
      assert.ok(!("history" in (s.relationships?.[0] || {})));
    });

    test("buildSharePayload snapshots story and characters without body", () => {
      const story = {
        title: "红楼",
        plotSummary: "情",
        mainStoryline: "主线",
        subPlots: [],
        chapterOutlines: [],
        worldSetting: {
          timePeriod: "清",
          location: "大观园",
          socialStructure: "",
          powerSystem: "",
          factions: [],
          rules: [],
          atmosphere: "",
        },
        backgroundInfo: "",
        themes: ["悲剧"],
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
      } as StoryInfo;

      const payload = buildSharePayload({
        title: "红楼梦",
        language: "zh",
        story,
        characters: [
          minimalCharacter({
            name: "宝玉",
            drive: {
              goal: " equanimity",
              motivation: "",
              fear: "",
              weakness: "",
              bottomLine: "",
              secret: "BODY_TEXT_LEAK_TEST",
            },
          }),
        ],
        generatedAt: "2026-07-19T00:00:00.000Z",
      });

      assert.equal(payload.version, 1);
      assert.equal(payload.title, "红楼梦");
      assert.equal(payload.language, "zh");
      assert.equal(payload.generatedAt, "2026-07-19T00:00:00.000Z");
      assert.equal(payload.story?.plotSummary, "情");
      assert.equal(payload.characters.length, 1);
      const dump = JSON.stringify(payload);
      assert.ok(!dump.includes("BODY_TEXT_LEAK_TEST"));
      assert.ok(!("text" in payload));
      assert.ok(!dump.includes("fullText"));
    });

    test("buildSharePayload allows null story and empty characters separately", () => {
      const onlyStory = buildSharePayload({
        title: "T",
        story: {
          title: "T",
          plotSummary: "p",
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
        } as StoryInfo,
        characters: [],
      });
      assert.ok(onlyStory.story);
      assert.equal(onlyStory.characters.length, 0);

      const onlyChars = buildSharePayload({
        title: "T",
        story: null,
        characters: [minimalCharacter({ name: "A" })],
      });
      assert.equal(onlyChars.story, null);
      assert.equal(onlyChars.characters.length, 1);
    });
  });
}
```

Register in `scripts/run-tests.ts`:

```ts
import { runSharePayloadTests } from "./tests/share-payload.test";
// inside main(), after existing suites:
runSharePayloadTests();
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test
```

Expected: FAIL importing `../../src/lib/share-payload` (module not found) or missing exports.

- [ ] **Step 3: Implement `src/lib/share-payload.ts`**

```ts
import { randomBytes } from "node:crypto";
import type { CharacterProfile, StoryInfo } from "@/types";

export type ShareVisibility = "public" | "auth";

export interface ShareCharacter {
  id: string;
  name: string;
  aliases: string[];
  appearance?: { summary?: string };
  personality?: {
    traits?: string[];
    description?: string;
  };
  drive?: {
    goal?: string;
    motivation?: string;
    fear?: string;
  };
  relationships?: Array<{
    characterName: string;
    type: string;
    description?: string;
  }>;
}

export interface ShareOverviewPayload {
  version: 1;
  title: string;
  language?: string;
  generatedAt: string;
  story: StoryInfo | null;
  characters: ShareCharacter[];
}

/** ≥108 bits entropy, url-safe. */
export function mintShareToken(): string {
  return randomBytes(18).toString("base64url");
}

export function toShareCharacter(c: CharacterProfile): ShareCharacter {
  return {
    id: c.id || "",
    name: c.name || "",
    aliases: Array.isArray(c.aliases) ? c.aliases.slice() : [],
    appearance: c.appearance?.summary
      ? { summary: c.appearance.summary }
      : undefined,
    personality: {
      traits: c.personality?.traits?.slice() || [],
      description: c.personality?.description || "",
    },
    drive: {
      goal: c.drive?.goal || "",
      motivation: c.drive?.motivation || "",
      fear: c.drive?.fear || "",
    },
    relationships: (c.relationships || []).slice(0, 24).map((r) => ({
      characterName: r.characterName,
      type: r.type,
      description: r.description || "",
    })),
  };
}

export function buildSharePayload(input: {
  title: string;
  language?: string;
  story: StoryInfo | null;
  characters: CharacterProfile[];
  generatedAt?: string;
}): ShareOverviewPayload {
  return {
    version: 1,
    title: input.title || "未命名",
    language: input.language,
    generatedAt: input.generatedAt || new Date().toISOString(),
    story: input.story,
    characters: (input.characters || []).map(toShareCharacter),
  };
}

export function isShareVisibility(v: unknown): v is ShareVisibility {
  return v === "public" || v === "auth";
}

/** True if payload has something worth showing. */
export function hasShareableContent(
  story: StoryInfo | null,
  characters: CharacterProfile[],
): boolean {
  const hasStory = !!(story && (story.plotSummary || story.mainStoryline || story.title));
  return hasStory || (characters?.length ?? 0) > 0;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test
```

Expected: `share-payload` suite all ✓; overall failed = 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/share-payload.ts scripts/tests/share-payload.test.ts scripts/run-tests.ts
git commit -m "feat(share): add overview snapshot payload builder"
```

---

### Task 2: SQLite share store + cascade revoke

**Files:**
- Modify: `src/lib/db.ts` (schema in `initSchema`, exports near other CRUD, `deleteNovel` cascade)
- Create: `scripts/tests/share-store.test.ts`
- Modify: `scripts/run-tests.ts`

**Interfaces:**
- Consumes: `ShareOverviewPayload`, `ShareVisibility` from `@/lib/share-payload`
- Produces:
  - `createShareOverview(row: { token: string; ownerUserId: string; novelId: string; visibility: ShareVisibility; payload: ShareOverviewPayload }): void`
  - `getShareOverviewByToken(token: string): ShareOverviewRow | null` (includes revoked rows)
  - `listShareOverviews(ownerUserId: string, novelId: string, opts?: { includeRevoked?: boolean }): ShareOverviewListItem[]`
  - `revokeShareOverview(token: string, ownerUserId: string): { ok: true } | { ok: false; reason: "not_found" | "forbidden" }` — not_found if token missing; if wrong owner → forbidden; if already revoked → ok (idempotent)
  - `updateShareVisibility(token: string, ownerUserId: string, visibility: ShareVisibility): { ok: true } | { ok: false; reason: "not_found" | "forbidden" | "revoked" }`
  - `revokeShareOverviewsForNovel(ownerUserId: string, novelId: string): void`

```ts
export interface ShareOverviewRow {
  token: string;
  ownerUserId: string;
  novelId: string;
  visibility: ShareVisibility;
  payload: ShareOverviewPayload;
  createdAt: string;
  revokedAt: string | null;
}

export interface ShareOverviewListItem {
  token: string;
  visibility: ShareVisibility;
  createdAt: string;
  revokedAt: string | null;
  url: string; // `/share/${token}`
}
```

- [ ] **Step 1: Write failing store tests**

Create `scripts/tests/share-store.test.ts`:

```ts
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
```

Register `runShareStoreTests()` in `scripts/run-tests.ts`.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test
```

Expected: FAIL on missing `createShareOverview` (or similar) exports from db.

- [ ] **Step 3: Add schema + helpers in `src/lib/db.ts`**

Inside `initSchema` `db.exec(\`...\`)` add:

```sql
CREATE TABLE IF NOT EXISTS share_overviews (
  token TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  novel_id TEXT NOT NULL,
  visibility TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_share_overviews_owner_novel
  ON share_overviews(owner_user_id, novel_id);
```

Add imports at top of db.ts if needed:

```ts
import type { ShareOverviewPayload, ShareVisibility } from "@/lib/share-payload";
```

Implement helpers (place after story/character section or near end of file before exports run out of room — keep near other novel-scoped CRUD):

```ts
export interface ShareOverviewRow {
  token: string;
  ownerUserId: string;
  novelId: string;
  visibility: ShareVisibility;
  payload: ShareOverviewPayload;
  createdAt: string;
  revokedAt: string | null;
}

export interface ShareOverviewListItem {
  token: string;
  visibility: ShareVisibility;
  createdAt: string;
  revokedAt: string | null;
  url: string;
}

function mapShareRow(row: any): ShareOverviewRow {
  return {
    token: row.token,
    ownerUserId: row.owner_user_id,
    novelId: row.novel_id,
    visibility: row.visibility as ShareVisibility,
    payload: JSON.parse(row.payload) as ShareOverviewPayload,
    createdAt: row.created_at,
    revokedAt: row.revoked_at ?? null,
  };
}

export function createShareOverview(input: {
  token: string;
  ownerUserId: string;
  novelId: string;
  visibility: ShareVisibility;
  payload: ShareOverviewPayload;
}): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO share_overviews (token, owner_user_id, novel_id, visibility, payload, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), NULL)`,
  ).run(
    input.token,
    input.ownerUserId,
    input.novelId,
    input.visibility,
    JSON.stringify(input.payload),
  );
}

export function getShareOverviewByToken(token: string): ShareOverviewRow | null {
  const d = getDb();
  const row = d.prepare(`SELECT * FROM share_overviews WHERE token = ?`).get(token) as any;
  return row ? mapShareRow(row) : null;
}

export function listShareOverviews(
  ownerUserId: string,
  novelId: string,
  opts?: { includeRevoked?: boolean },
): ShareOverviewListItem[] {
  const d = getDb();
  const includeRevoked = !!opts?.includeRevoked;
  const rows = includeRevoked
    ? (d
        .prepare(
          `SELECT token, visibility, created_at, revoked_at FROM share_overviews
           WHERE owner_user_id = ? AND novel_id = ?
           ORDER BY created_at DESC`,
        )
        .all(ownerUserId, novelId) as any[])
    : (d
        .prepare(
          `SELECT token, visibility, created_at, revoked_at FROM share_overviews
           WHERE owner_user_id = ? AND novel_id = ? AND revoked_at IS NULL
           ORDER BY created_at DESC`,
        )
        .all(ownerUserId, novelId) as any[]);
  return rows.map((r) => ({
    token: r.token,
    visibility: r.visibility as ShareVisibility,
    createdAt: r.created_at,
    revokedAt: r.revoked_at ?? null,
    url: `/share/${r.token}`,
  }));
}

export function revokeShareOverview(
  token: string,
  ownerUserId: string,
): { ok: true } | { ok: false; reason: "not_found" | "forbidden" } {
  const d = getDb();
  const row = d.prepare(`SELECT owner_user_id, revoked_at FROM share_overviews WHERE token = ?`).get(token) as
    | { owner_user_id: string; revoked_at: string | null }
    | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.owner_user_id !== ownerUserId) return { ok: false, reason: "forbidden" };
  if (row.revoked_at) return { ok: true };
  d.prepare(`UPDATE share_overviews SET revoked_at = datetime('now') WHERE token = ?`).run(token);
  return { ok: true };
}

export function updateShareVisibility(
  token: string,
  ownerUserId: string,
  visibility: ShareVisibility,
): { ok: true } | { ok: false; reason: "not_found" | "forbidden" | "revoked" } {
  const d = getDb();
  const row = d.prepare(`SELECT owner_user_id, revoked_at FROM share_overviews WHERE token = ?`).get(token) as
    | { owner_user_id: string; revoked_at: string | null }
    | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.owner_user_id !== ownerUserId) return { ok: false, reason: "forbidden" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  d.prepare(`UPDATE share_overviews SET visibility = ? WHERE token = ?`).run(visibility, token);
  return { ok: true };
}

export function revokeShareOverviewsForNovel(ownerUserId: string, novelId: string): void {
  const d = getDb();
  d.prepare(
    `UPDATE share_overviews SET revoked_at = datetime('now')
     WHERE owner_user_id = ? AND novel_id = ? AND revoked_at IS NULL`,
  ).run(ownerUserId, novelId);
}
```

In `deleteNovel`, inside the transaction, **before or after** other deletes, call:

```ts
// Soft-revoke share links (keep rows for uniform 404; do not hard-delete)
d.prepare(
  `UPDATE share_overviews SET revoked_at = datetime('now')
   WHERE owner_user_id = ? AND novel_id = ? AND revoked_at IS NULL`,
).run(userId, id);
```

(Alternatively call `revokeShareOverviewsForNovel(userId, id)` but prefer inline SQL inside the same transaction so it is atomic with novel delete.)

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test
```

Expected: `share-store` all ✓.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts scripts/tests/share-store.test.ts scripts/run-tests.ts
git commit -m "feat(share): persist overview shares and revoke on novel delete"
```

---

### Task 3: Share API routes

**Files:**
- Create: `src/app/api/share/route.ts`
- Create: `src/app/api/share/[token]/route.ts`

**Interfaces:**
- Consumes: db share helpers, `getNovel`, `getStoryInfo`, `getCharacters`, `resolveAuth` / `getUserId`, payload helpers
- Produces: HTTP handlers as specified in design

- [ ] **Step 1: Implement `src/app/api/share/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  createShareOverview,
  getCharacters,
  getNovel,
  getStoryInfo,
  listShareOverviews,
} from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import {
  buildSharePayload,
  hasShareableContent,
  isShareVisibility,
  mintShareToken,
  type ShareVisibility,
} from "@/lib/share-payload";

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "share_list", { windowMs: 60_000, maxRequests: 60 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }
  const novelId = request.nextUrl.searchParams.get("novelId");
  if (!novelId) {
    return NextResponse.json({ error: "novelId required" }, { status: 400 });
  }
  const novel = getNovel(userId, novelId);
  if (!novel) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const includeRevoked = request.nextUrl.searchParams.get("includeRevoked") === "1";
  const shares = listShareOverviews(userId, novelId, { includeRevoked });
  return NextResponse.json({ shares });
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "share_create", { windowMs: 60_000, maxRequests: 20 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }
  let body: { novelId?: string; visibility?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const novelId = body.novelId?.trim();
  if (!novelId) {
    return NextResponse.json({ error: "novelId required" }, { status: 400 });
  }
  const visibility: ShareVisibility = isShareVisibility(body.visibility)
    ? body.visibility
    : "public";

  const novel = getNovel(userId, novelId);
  if (!novel) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const story = getStoryInfo(userId, novelId);
  const characters = getCharacters(userId, novelId);
  if (!hasShareableContent(story, characters)) {
    return NextResponse.json(
      { error: "empty", message: "请先完成故事或角色分析" },
      { status: 400 },
    );
  }

  const payload = buildSharePayload({
    title: novel.title,
    story,
    characters,
  });
  const token = mintShareToken();
  createShareOverview({
    token,
    ownerUserId: userId,
    novelId,
    visibility,
    payload,
  });
  const url = `/share/${token}`;
  return NextResponse.json({
    token,
    url,
    visibility,
    createdAt: new Date().toISOString(),
  });
}
```

Note: Prefer `getUserId` from `@/lib/auth` if re-exported; this codebase currently re-exports via `@/lib/rate-limit` in novels route — **match existing novels route import style**:

```ts
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
```

Check `rate-limit.ts` — if it re-exports `getUserId`, use that path for consistency with `api/novels/route.ts`.

- [ ] **Step 2: Implement `src/app/api/share/[token]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  getShareOverviewByToken,
  revokeShareOverview,
  updateShareVisibility,
} from "@/lib/db";
import { resolveAuth } from "@/lib/auth";
import { checkRateLimit, getUserId, rateLimitMessage } from "@/lib/rate-limit";
import { isShareVisibility } from "@/lib/share-payload";

type Ctx = { params: { token: string } };

export async function GET(request: NextRequest, { params }: Ctx) {
  const userId = getUserId(request);
  const rate = checkRateLimit(userId, "share_get", { windowMs: 60_000, maxRequests: 120 });
  if (!rate.allowed) {
    return NextResponse.json({ error: rateLimitMessage(rate) }, { status: 429 });
  }
  const token = params.token;
  if (!token) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const row = getShareOverviewByToken(token);
  if (!row || row.revokedAt) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.visibility === "auth") {
    const auth = resolveAuth(request);
    if (auth.kind !== "user") {
      return NextResponse.json({ error: "auth_required" }, { status: 401 });
    }
  }
  // Never return ownerUserId or novelId
  return NextResponse.json({
    payload: row.payload,
    visibility: row.visibility,
    createdAt: row.createdAt,
  });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const userId = getUserId(request);
  let body: { visibility?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isShareVisibility(body.visibility)) {
    return NextResponse.json({ error: "invalid_visibility" }, { status: 400 });
  }
  const result = updateShareVisibility(params.token, userId, body.visibility);
  if (!result.ok) {
    if (result.reason === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (result.reason === "revoked") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, visibility: body.visibility });
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const userId = getUserId(request);
  const result = revokeShareOverview(params.token, userId);
  if (!result.ok) {
    if (result.reason === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run build
```

Expected: compile succeeds (or only pre-existing unrelated errors). Fix any type errors in new files.

Manual smoke (optional if `npm run dev` available):

1. With analyzed novel, `POST /api/share` `{ "novelId":"...", "visibility":"public" }` → 200 + url  
2. `GET` that token → payload without novel id  
3. `DELETE` → then GET → 404  

- [ ] **Step 4: Commit**

```bash
git add src/app/api/share/route.ts src/app/api/share/[token]/route.ts
git commit -m "feat(share): add create/list/read/revoke share APIs"
```

---

### Task 4: Share page + presentational view

**Files:**
- Create: `src/components/share-overview-view.tsx`
- Create: `src/app/share/[token]/page.tsx`

**Interfaces:**
- Consumes: `ShareOverviewPayload`, `ShareCharacter` from `@/lib/share-payload`
- Produces: `<ShareOverviewView payload={...} />`; page handles fetch states

- [ ] **Step 1: Implement `share-overview-view.tsx`**

Client component showing:

1. Header: `payload.title`, subtitle「分享的小说概览」, `generatedAt` formatted  
2. If `payload.story`: plot summary, mainStoryline, themes chips, worldSetting fields (mirror structure of `StoryInfoPanel` detail — can be simpler inline sections, no need for OverviewDetailSheet if space allows; use sheets for long content if desired)  
3. Characters: horizontal cards; click opens detail sheet with whitelist fields only  
4. Footer: 「由小说创作工作台生成」+ `<Link href="/">返回首页</Link>`

Reuse CSS classes: `ov-card`, `ov-chip-ok`, `ov-section-label`, etc. from globals.

Skeleton structure:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { ShareCharacter, ShareOverviewPayload } from "@/lib/share-payload";
import OverviewDetailSheet from "@/components/overview-detail-sheet";
import { BookOpen, Globe, Users } from "lucide-react";

export default function ShareOverviewView({
  payload,
}: {
  payload: ShareOverviewPayload;
}) {
  // render as specified
}
```

For character cards, accept `ShareCharacter` (not full `CharacterProfile`).

- [ ] **Step 2: Implement `src/app/share/[token]/page.tsx`**

Prefer **client page** that fetches `GET /api/share/${token}` so auth cookie + login flow stay simple:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ShareOverviewView from "@/components/share-overview-view";
import type { ShareOverviewPayload } from "@/lib/share-payload";
import Link from "next/link";
import AuthBar from "@/components/auth-bar"; // only if already mountable; else prompt to use shell AuthBar + message

type State =
  | { kind: "loading" }
  | { kind: "ok"; payload: ShareOverviewPayload }
  | { kind: "not_found" }
  | { kind: "auth_required" };

export default function SharePage() {
  const params = useParams();
  const token = typeof params.token === "string" ? params.token : "";
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = () => {
    if (!token) {
      setState({ kind: "not_found" });
      return;
    }
    setState({ kind: "loading" });
    fetch(`/api/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.status === 404) {
          setState({ kind: "not_found" });
          return;
        }
        if (res.status === 401) {
          setState({ kind: "auth_required" });
          return;
        }
        if (!res.ok) {
          setState({ kind: "not_found" });
          return;
        }
        const data = await res.json();
        setState({ kind: "ok", payload: data.payload });
      })
      .catch(() => setState({ kind: "not_found" }));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Listen for focus after login: window focus → if auth_required, reload
  useEffect(() => {
    if (state.kind !== "auth_required") return;
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [state.kind, token]);

  if (state.kind === "loading") {
    return (
      <div className="flex-1 overflow-y-auto p-8 text-center text-fog text-sm">
        加载中…
      </div>
    );
  }
  if (state.kind === "not_found") {
    return (
      <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center justify-center gap-3">
        <p className="text-foreground font-medium">链接不存在或已失效</p>
        <Link href="/" className="text-sm text-primary">
          返回首页
        </Link>
      </div>
    );
  }
  if (state.kind === "auth_required") {
    return (
      <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center justify-center gap-3">
        <p className="text-foreground font-medium">需要登录后查看</p>
        <p className="text-sm text-fog">请使用右上角登录；登录成功后回到本页或刷新</p>
        <button
          type="button"
          className="text-sm text-primary"
          onClick={() => load()}
        >
          我已登录，重试
        </button>
        <Link href="/" className="text-sm text-fog">
          返回首页
        </Link>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-background">
      <ShareOverviewView payload={state.payload} />
    </div>
  );
}
```

(App shell already includes AuthBar in typical layout — verify `AppShell`; do not duplicate if present.)

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/components/share-overview-view.tsx src/app/share/[token]/page.tsx
git commit -m "feat(share): add public share overview page"
```

---

### Task 5: Share dialog + overview entry

**Files:**
- Create: `src/components/share-dialog.tsx`
- Modify: `src/app/novel/[id]/page.tsx`

**Interfaces:**
- Consumes: `/api/share` POST/GET, `/api/share/[token]` PATCH/DELETE  
- Produces: modal controlled by `open` / `onClose` / `novelId`

- [ ] **Step 1: Implement `share-dialog.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { ShareVisibility } from "@/lib/share-payload";
import { X, Copy, Check, Link2, Trash2 } from "lucide-react";

interface ShareItem {
  token: string;
  visibility: ShareVisibility;
  createdAt: string;
  revokedAt: string | null;
  url: string;
}

export default function ShareDialog({
  open,
  onClose,
  novelId,
}: {
  open: boolean;
  onClose: () => void;
  novelId: string;
}) {
  const [visibility, setVisibility] = useState<ShareVisibility>("public");
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!novelId) return;
    const res = await fetch(`/api/share?novelId=${encodeURIComponent(novelId)}`);
    if (!res.ok) return;
    const data = await res.json();
    setShares(data.shares || []);
  }, [novelId]);

  useEffect(() => {
    if (open) {
      setError("");
      refresh();
    }
  }, [open, refresh]);

  const absoluteUrl = (path: string) =>
    typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

  const copy = async (path: string) => {
    const full = absoluteUrl(path);
    try {
      await navigator.clipboard.writeText(full);
      setCopied(path);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("复制失败，请手动复制");
    }
  };

  const create = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novelId, visibility }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || data.error || "生成失败");
        return;
      }
      await copy(data.url);
      await refresh();
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const revoke = async (token: string) => {
    await fetch(`/api/share/${encodeURIComponent(token)}`, { method: "DELETE" });
    await refresh();
  };

  const toggleVis = async (item: ShareItem) => {
    const next: ShareVisibility = item.visibility === "public" ? "auth" : "public";
    await fetch(`/api/share/${encodeURIComponent(item.token)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: next }),
    });
    await refresh();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="关闭" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" />
            分享概览
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 mb-4">
          <p className="text-xs text-fog">生成当前故事与角色的只读快照链接（不含正文）。</p>
          <div className="flex gap-2">
            <label className="flex-1 text-sm flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="vis"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
              />
              公开链接
            </label>
            <label className="flex-1 text-sm flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="vis"
                checked={visibility === "auth"}
                onChange={() => setVisibility("auth")}
              />
              仅登录可见
            </label>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={create}
            className="w-full rounded-xl bg-primary text-primary-foreground text-sm font-medium py-2.5 disabled:opacity-50"
          >
            {loading ? "生成中…" : "生成并复制链接"}
          </button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium text-fog mb-2">已生成的链接</p>
          {shares.length === 0 ? (
            <p className="text-xs text-fog">暂无</p>
          ) : (
            <ul className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
              {shares.map((s) => (
                <li
                  key={s.token}
                  className="rounded-xl border border-border/60 px-3 py-2 text-xs flex flex-col gap-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="ov-chip-muted">
                      {s.visibility === "public" ? "公开" : "登录"}
                    </span>
                    <span className="text-fog truncate flex-1">{s.token.slice(0, 10)}…</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary"
                      onClick={() => copy(s.url)}
                    >
                      {copied === s.url ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      复制
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1 rounded-lg bg-secondary"
                      onClick={() => toggleVis(s)}
                    >
                      改为{s.visibility === "public" ? "登录" : "公开"}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary text-destructive"
                      onClick={() => revoke(s.token)}
                    >
                      <Trash2 className="w-3 h-3" />
                      撤销
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire overview page**

In `src/app/novel/[id]/page.tsx`:

1. Import `ShareDialog` and `Share2` (or `Link2`) from lucide-react.  
2. Add state: `const [shareOpen, setShareOpen] = useState(false);`  
3. In hero header (near title/meta), add button:

```tsx
<button
  type="button"
  onClick={() => setShareOpen(true)}
  className="mt-4 inline-flex items-center gap-1.5 text-sm rounded-xl border border-border/60 px-3 py-1.5 hover:bg-secondary transition-colors"
>
  <Share2 className="w-3.5 h-3.5" />
  分享概览
</button>
```

4. At end of component tree (inside outer wrapper):

```tsx
{novelId && (
  <ShareDialog
    open={shareOpen}
    onClose={() => setShareOpen(false)}
    novelId={novelId}
  />
)}
```

- [ ] **Step 3: Verify**

```bash
npm test
npm run build
```

Expected: all tests pass; build OK.

Manual acceptance (dev server):

1. Open novel with story/characters → 分享概览 → 生成并复制  
2. Incognito open public link → see title/story/chars, no body  
3. Create auth link → logged out sees 需登录  
4. Revoke → 失效  
5. Re-analyze novel → old link content unchanged  

- [ ] **Step 4: Commit**

```bash
git add src/components/share-dialog.tsx src/app/novel/[id]/page.tsx
git commit -m "feat(share): add overview share dialog and entry point"
```

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| Token snapshot table | 2 |
| Field-whitelist payload / no body / no secret | 1 |
| POST create + empty 400 | 3 |
| GET list by novelId | 3 |
| GET token public/auth/404 | 3 |
| PATCH visibility | 3 |
| DELETE revoke idempotent | 2 + 3 |
| deleteNovel revokes shares | 2 |
| Share page UI + states | 4 |
| Overview dialog entry | 5 |
| Acceptance criteria 1–7 | 1–5 combined |

## Self-review notes

- No TBD placeholders in tasks.  
- Types consistent: `ShareVisibility`, `ShareOverviewPayload`, store row shapes.  
- `getUserId` import: implementer must match existing re-export from `@/lib/rate-limit` vs `@/lib/auth` (novels route uses rate-limit).  
- StoryInfo full clone in payload is intentional per spec; only characters are whitelisted.
