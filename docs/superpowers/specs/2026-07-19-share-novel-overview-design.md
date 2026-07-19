# Share Novel Overview — Design Spec

**Date:** 2026-07-19  
**Branch / worktree:** `feature/share-novel-overview` (`.worktrees/share-novel-overview`)  
**Status:** Approved for implementation planning

## Problem

Users can build a rich novel overview inside the app (`/novel/[id]`): story/world, characters, themes. There is no way to share that overview with others without granting access to the private workspace or the full novel text.

## Goals

- Generate a **shareable overview page** for a single novel.
- Default **public link**; optional **login-required** visibility.
- Content is a **snapshot** taken at generation time (does not auto-update when the owner re-analyzes).
- Links are **permanent until revoked**; owner can revoke and create new links.
- **Never** expose full novel body text on the share surface.

## Non-goals (v1)

- Timeline, chapter form/catalog, relationship graph canvas on the share page
- Sharing body text, branches, drafts, or simulations
- Auto-refresh of shared content when analysis changes
- Link expiry TTLs or open-count limits
- Password / one-time codes
- Polished OG image cards or external short-link services
- Simplified AppShell chrome for share pages (acceptable follow-up)
- Treating guest cookies as “logged in” for `auth` visibility

## Decisions (summary)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Audience | Public by default + optional `auth` | External share + optional semi-private |
| Content depth | Full overview: story/world + character cards (summary-level); no body | Matches current overview value without leaking text |
| Freshness | Snapshot at generate | Predictable for recipients |
| Lifecycle | Permanent + revocable; multi-link per novel | Simple mental model; owner control |
| Architecture | Opaque token + `share_overviews` table | Avoids enumerable `novelId` URLs; clean revoke |

## Architecture

```
[Overview /novel/id] --POST--> Share API --build--> SQLite share_overviews
                                      ^
[/share/token] ----read payload-------+
```

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| Share store (`db`) | Create / get / list / revoke / patch visibility | SQLite |
| Snapshot builder | Assemble redacted payload from story + characters + novel meta | `getStoryInfo`, characters, novel meta |
| Share API | Owner CRUD + public/auth read | auth + store + builder |
| Share page UI | Read-only render; 404 / auth-required states | Share API or server store read |
| Share dialog | Generate, copy, list, revoke, change visibility | Share API |

## Data model

### Table `share_overviews`

| Column | Type | Notes |
|--------|------|--------|
| `token` | TEXT PK | Unpredictable url-safe token (≥108 bits, e.g. 18 random bytes base64url) |
| `owner_user_id` | TEXT NOT NULL | Creator / manager |
| `novel_id` | TEXT NOT NULL | For owner list & cascade revoke; **never** in public URL or public API body |
| `visibility` | TEXT NOT NULL | `'public'` \| `'auth'` |
| `payload` | TEXT NOT NULL | JSON snapshot |
| `created_at` | TEXT NOT NULL | ISO or SQLite datetime |
| `revoked_at` | TEXT NULL | Non-null ⇒ revoked |

**Index:** `(owner_user_id, novel_id)` for list/manage.

**Cascade:** When a novel is deleted for a user, revoke all shares for that `(owner_user_id, novel_id)` (set `revoked_at`).

### Payload shape (version 1)

```ts
interface ShareOverviewPayload {
  version: 1;
  title: string;
  language?: string;
  generatedAt: string; // ISO
  story: StoryInfo | null;
  characters: ShareCharacter[];
}

/** Summary-level character fields only (whitelist). */
interface ShareCharacter {
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
    // deliberately omit: secret, fear, weakness, etc. if product wants tighter privacy
    motivation?: string;
    fear?: string;
  };
  relationships?: Array<{
    characterName: string;
    type: string;
    description?: string;
  }>;
}
```

**Hard exclusions from payload and public responses:**

- `novels.text` / any branch full text
- drafts, simulations, chat history
- timeline / chapter form modules (v1)
- `owner_user_id`, `novel_id` on public read API

**Character privacy:** Do **not** include `drive.secret` (or equivalent hidden fields) in `ShareCharacter`. Prefer a field whitelist in `buildSharePayload` rather than cloning full `CharacterProfile`.

## API

| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| `POST` | `/api/share` | Owner | Create snapshot; body `{ novelId, visibility }` |
| `GET` | `/api/share?novelId=` | Owner | List shares for novel (default active only; `includeRevoked=1` optional) |
| `GET` | `/api/share/[token]` | Per visibility | Return payload; no owner/novel ids |
| `PATCH` | `/api/share/[token]` | Owner | Update `visibility` only (no resnapshot) |
| `DELETE` | `/api/share/[token]` | Owner | Revoke; **idempotent** success if already revoked |

### POST details

1. Resolve user; ensure novel belongs to user.
2. Load title/language, story info, characters.
3. If both story and characters are empty → `400` with clear error (nothing to share).
4. Build payload, mint token, insert row.
5. Response: `{ token, url: "/share/{token}", visibility, createdAt }`.  
   Absolute URL is composed on the client via `window.location.origin`.

### GET by token

| Condition | Status | Body |
|-----------|--------|------|
| Missing or revoked | 404 | `{ error: "not_found" }` (do not distinguish revoked vs unknown) |
| `auth` and not formally logged in | 401 | `{ error: "auth_required" }` — guest cookie does **not** count |
| OK | 200 | `{ payload, visibility, createdAt }` |

### Ownership errors

- Non-owner PATCH/DELETE → `403`
- List/create for foreign novel → `403` or `404` consistent with other novel APIs in this codebase

### Rate limiting

Optional in v1: reuse existing user rate-limit helpers for `POST` if convenient; not a launch blocker.

## Frontend

### Entry: `/novel/[id]`

- Control: **「分享概览」** on the overview header/actions.
- Opens `ShareDialog`:
  - Visibility: public (default) / auth-only
  - Primary action: generate + copy link
  - List of active links: copy, revoke, change visibility
  - Empty-analysis error messaging

### Page: `/share/[token]`

- Read-only overview layout (same design tokens / `ov-*` patterns).
- Sections: title + generated time → story/world → character cards (sheet for detail).
- Footer: product attribution + link home; **no** private novel deep-link.
- States: loading, 404, auth-required (prompt login, then reload), success.
- Prefer server-side load of payload when practical (fewer round-trips; future OG metadata).

### Suggested files

| Path | Role |
|------|------|
| `src/lib/share-payload.ts` | Types + `buildSharePayload` |
| `src/lib/db.ts` | Table + CRUD helpers |
| `src/app/api/share/route.ts` | POST + list GET |
| `src/app/api/share/[token]/route.ts` | GET / PATCH / DELETE |
| `src/app/share/[token]/page.tsx` | Public page |
| `src/components/share-dialog.tsx` | Owner management UI |
| `src/components/share-overview-view.tsx` | Presentational payload renderer |

Adapt or lightly generalize `StoryInfoPanel` / character preview for subset types without breaking existing overview behavior.

## Security

- High-entropy tokens; no sequential ids.
- Uniform 404 for missing/revoked.
- Field whitelist for characters; never full-text.
- Public JSON must not leak `novel_id` or owner id.
- `auth` visibility requires real session user, not guest.

## Testing

- Unit: `buildSharePayload` omits text and secrets; maps character whitelist.
- API: owner create/list/revoke; non-owner forbidden; public read; auth gate; revoked → 404.
- Optional: page smoke that title renders for a known token.

## Acceptance criteria

1. Owner can generate a link for a novel that has story and/or characters; clipboard gets `/share/{token}`.
2. Incognito open of a `public` link shows title + story/character overview, not body text.
3. `auth` link shows login requirement when logged out; visible after formal login.
4. After revoke, any access shows not-found/expired messaging.
5. Changing in-app analysis after share does not change old link content.
6. Non-owners cannot PATCH/DELETE others’ tokens.
7. Public API responses and payload builder never include novel full text.

## Open questions

None remaining for v1 (resolved in design dialogue).

## Implementation note

Implement on branch `feature/share-novel-overview` in worktree `.worktrees/share-novel-overview`. Next step after spec approval: detailed implementation plan under `docs/superpowers/plans/`.
