# Spec: 分析（肉/骨）· 章法 · 时间线 · 阅读竖轨

**Status:** Accepted design (grill frozen); implementation **partial**  
**Last updated:** 2026-07-18  
**Related commits (implementation so far):**  
`1c4441c` form/catalog/rail · `04578b1` async timeline job · `6758ba5` UI 分析 rename · earlier perf CoW/virtual scroll  

This document is the source of truth for product + engineering. Chat history is not.

---

## 1. Goals

1. Give users a low-cognition entry named **「分析」** that prepares a novel for continuation.
2. Separate conceptually (internally):
   - **肉 (extraction):** characters, events, world facts
   - **骨 (form):** unit hierarchy, chaptering, narrative skeleton
   - **肌理 (style):** language/texture (文笔)
3. Support **chapter-aware continuation**: chapter title style, open/closed chapter boundary, catalog with offsets.
4. Support **human QA of continuations** via a vertical timeline/catalog rail in the reader.
5. Scale to long novels: async timeline, program-first catalog, no dual-write of full text on every list.

## 2. Non-goals (this phase)

- Full literary theory UI (users never see “fabula/syuzhet”).
- Perfect automated literary quality scoring.
- Multi-instance shared job queue (Redis) — single-process async is acceptable interim.
- Forcing every prose/essay into fake “第 N 章” structure.
- Replacing branch CoW / virtual scroll (already specified elsewhere; only referenced here).

---

## 3. Frozen product decisions (grill)

| # | Topic | Decision |
|---|--------|----------|
| D1 | Naming | User-facing: **「分析」** only. Internal may use form/extract. |
| D2 | Analysis UI | Checkbox center + **smart defaults**. Default on: story, characters, form, style. **Timeline default off**. |
| D3 | Uncertain form | **Conservative:** `chaptering.enabled = false` (no forced chapter titles). |
| D4 | Chapter boundary after accept | **Hybrid:** outline intent first; if conflicts with prose evidence, **prose wins**. |
| D5 | Storage layers | **Form profile @ novel**. **Boundary + `chapters[]` catalog @ branch** (copy on fork). |
| D6 | Catalog build | **Program-first** (regex/heuristics). **LLM only audits the list** (cheap). |
| D7 | Timeline order | **Only after unit segmentation**. |
| D8 | No chaptering | Segment by **scene breaks first**, fallback **fixed char windows**. Never invent “第 N 章”. |
| D9 | Timeline scale | **Async full run** (no hard cap for product reasons; user wants full view for QA). Progressive save. |
| D10 | Timeline UI | **Vertical rail in reader**, clickable like TOC. |
| D11 | Scroll sync | Rail **highlights current unit** from scroll position. |

---

## 4. Domain model

### 4.1 Novel-level: `NovelFormProfile` (骨)

Stored: `novel_form` table (`user_id`, `novel_id`, JSON).

Key fields (see `src/types/index.ts`):

- `formType`: web_novel | trad_novel | essay_prose | …
- `unitHierarchy`: volume / chapter / section presence
- `chaptering`: enabled, confidence, numbering, samples, avg length, …
- `narrativeArchitecture`: primaryTemplate, pov, time scheme, evidenceNotes
- `continuationRules[]`: short rules for agents

**Rule:** If `chaptering.confidence` is low → force `enabled=false` (D3).

### 4.2 Branch-level: `BranchChapterMeta`

Stored: `branch_chapter_meta` table.

- `chapterBoundary`: `open` | `closed`
- `openChapter` / `lastClosedChapter` (optional)
- `chapters[]`: `{ id, number?, title, startOffset, endOffset?, source }`

**On fork:** copy meta snapshot to new branch.

### 4.3 Narrative units (for timeline)

Unified unit (not always a “chapter”):

```ts
{
  unitId, unitKind: "chapter"|"scene"|"window"|…,
  startOffset, endOffset, label
}
```

### 4.4 Timeline

- **Product:** async job per novel+branch, progressive `saveTimeline`.
- **Current code risk:** timeline rows may still be keyed only by `novelId` (branch isolation incomplete) — see §7.

---

## 5. User flows

### 5.1 Analyze

1. User opens novel **概览**.
2. Panel **「分析」** with checkboxes (smart defaults).
3. Run → modules execute; timeline starts **background job** if checked.
4. Result summary line (modules ran / skipped / form note / job id).

### 5.2 Read + QA

1. User opens **阅读**.
2. Left **vertical rail**: catalog and/or timeline units.
3. Click node → scroll toward offset.
4. Scroll body → active node highlight (D11).
5. If job running, rail shows pending/done and partial summaries.

### 5.3 Continue writing

1. Outline states chapter plan (continue / close / new + titles).
2. Writer respects chaptering samples when opening new chapter.
3. Accept → append prose → update boundary (D4) + rebuild/increment catalog.

---

## 6. Pipelines

### 6.1 Form + catalog

```
full text
  → program extractChapterCatalog
  → infer chaptering + confidence (D3)
  → optional LLM: architecture + catalog QA (list only)
  → save NovelFormProfile (novel)
  → if enabled: seed BranchChapterMeta.chapters (branch)
```

### 6.2 Timeline (async)

```
ensure units:
  if chaptering.enabled && catalog.length → use chapters
  else segmentNarrativeUnits (scene → window) (D8)
for each unit (async job D9):
  LLM events + end states
  progressive saveTimeline
  update job unit status for rail poll
```

### 6.3 Accept chapter meta (D4)

```
if !chaptering.enabled → skip
outline keywords → intended open/closed
prose head matches chapter title pattern → prefer closed / new chapter
rebuild catalog from full branch text (program)
save BranchChapterMeta
```

---

## 7. Implementation status

Legend: **done** | **partial** | **todo**

| Area | Status | Notes |
|------|--------|--------|
| Types + DB tables | **done** | `novel_form`, `branch_chapter_meta` |
| Program catalog | **done** | `chapter-catalog.ts` + tests |
| Form analyzer + LLM QA | **partial** | Works; QA not a separate strict schema contract |
| Analysis UI rename + defaults | **done** | 分析 / DEFAULT_ANALYSIS_MODULES |
| Outline/writer prompt text | **partial** (improved) | Tool-required form context; still no structured chapterPlan JSON |
| Accept boundary + catalog | **partial** | Tests cover happy paths; outline keyword still heuristic |
| **Agent tools load form/boundary** | **done** | `get_novel_form` + `get_branch_meta.form` |
| Reader rail + click + scroll-sync | **partial** | Desktop + mobile drawer; jump still ratio-based (documented) |
| Async timeline job | **done** | Progressive unit job; SQLite status; restart → mark error, re-run |
| Timeline **per branch** storage | **done** | `timelines` / `chapter_states` PK includes `branch_id` |
| Job durable in SQLite | **done** | `timeline_jobs` table; no mid-unit resume after crash |
| Mobile rail | **done** | 目录 drawer on small screens |
| Overview form summary UI | **done** | FormSummaryCard: formType / chaptering / catalog / boundary |
| Per-unit retry UI | **done** | Rail error + retry → POST retry_unit |
| Export TOC in TXT | **done** | prependTocToTxt on branch download (toc=0 to skip) |
| E2E / integration acceptance tests | **todo** | Unit tests cover catalog/segments only |

---

## 8. Acceptance criteria (must pass before “design complete”)

### A. Analysis UX
- [ ] Overview panel title and primary button say **分析**, never 拆解.
- [ ] Default selection includes form + story + characters + style; **not** timeline.
- [ ] Running with form on a clearly chaptered sample yields `chaptering.enabled=true` and non-empty catalog for main.
- [ ] Running form on a no-heading long prose sample yields `chaptering.enabled=false`.

### B. Catalog & boundary
- [ ] Program finds `第1章`…`第N章` with correct increasing `startOffset`.
- [ ] Fork copies chapter meta; child edits do not rewrite parent catalog.
- [ ] Accept after draft starting with `第K章 …` updates catalog and boundary per D4.
- [ ] Accept on non-chaptering novel does not force new chapter titles in meta.

### C. Agents (P0 — form consumption)
- [x] Outline and/or writer path can **read** form.continuationRules + chaptering.samples + boundary (tool or injected context).
- [x] When chaptering disabled, writer system constraints forbid inventing 第N章 unless user asks.

### D. Timeline async
- [x] Selecting timeline returns quickly with `timelineJobId` (no multi-minute HTTP).
- [x] Job progresses unit-by-unit; partial timeline readable before done.
- [x] Reader rail shows pending/done and summaries while job runs.
- [x] Job status survives restart in SQLite; in-flight jobs mark error and ask re-run (no mid-unit resume).

### E. Reader rail
- [x] Click jumps near unit start (documented precision: char-offset ratio).
- [x] Scroll updates active highlight.
- [x] Mobile can open the same rail (drawer).

---

## 9. Priority backlog (implementation order)

### P0 — Continuation actually uses 骨
1. Tool or context injection: `get_novel_form` / extend `get_branch_meta` with form + branch chapter meta.
2. Wire outline + writer prompts to **consume** that data (not only static markdown).
3. Automated tests: form enable/disable, accept boundary, tool payload shape.

### P1 — Timeline QA product
4. ~~Persist timeline jobs (SQLite) + optional cancel.~~ **done**
5. ~~Branch-scoped timeline storage.~~ **done**
6. ~~Ensure form runs before timeline when both selected.~~ **done** (P0 hard dep + soft-fail)
7. ~~Mobile rail drawer; improve jump accuracy.~~ **done** (drawer + ratio note; geometry map still MVP)

### P2 — Polish
8. ~~Overview card: form summary + catalog count + boundary.~~ **done**
9. ~~Per-unit retry; error affordances on rail.~~ **done**
10. ~~Export TXT with TOC from `chapters[]`.~~ **done**

---

## 10. Risks

| Risk | Mitigation |
|------|------------|
| Agents ignore form | P0 tools + tests; do not rely on prompt memory alone |
| Regex catalog false positives | Density heuristics + LLM drop indices; conservative enable |
| Async job lost on restart | Document; then SQLite jobs (P1) |
| IF branch timeline clobber | Branch-scoped timeline (P1) |
| Scroll jump imprecise | Accept as MVP; later map offset→chunk geometry |
| User confuses 分析 modules | Keep one word 分析; hints stay short |

---

## 11. Out of scope references

- Long-novel perf (CoW, virtual scroll, list metadata): see commits under `perf(long-novel)`.
- Foreshadowing ledger / accept realized-only: existing accept path; only chapter meta is new side effect.

---

## 12. Sign-off

| Role | Note |
|------|------|
| Product decisions | Frozen in §3 (user confirmed grill + “确认”) |
| Spec document | This file |
| Implementation | Track §7–§9; do not treat chat as checklist |

**Next engineering step:** Execute **§9 P0** only after this Spec is treated as blocking; or update this file first if any decision changes.
