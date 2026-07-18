# Spec: 角色名分段扫描（Flash）· 频次阈值 · 名单合并

**Status:** Accepted design (grill frozen); implementation **not started** (spike disconnected)  
**Date:** 2026-07-18  
**Authoring context:** Long novels miss characters when Pass1 only sees a few context chunks. Program/heuristic name scan was rejected (poor transfer, easy to overfit one book). Direction: **DeepSeek V4 Flash (analysis role) scans units for names only**, then **frequency filter (not top-N)**, then **one merge pass** for roster + roles. Personality / relationships / world stay out of the unit loop.

**Spike note:** Files `character-name-*.ts` were a thin spike. **Pass1 is disconnected** (legacy excerpt path) until planned PRs land.

### Grill freeze log

| Round | Date | Decisions |
|-------|------|-----------|
| G1 | 2026-07-18 | Units: chapter-first, pack when too many. Mentions: scheme C. Runtime: full characters async+progress. Ship: gold eval ≥2 books. |
| G2 | 2026-07-18 | Presence 0/1 per unit. Pass2 M=5 fixed. Unit fail → degrade+warn. Merge may lightly add names with excerpt evidence. |
| G2e | 2026-07-18 | Eng defaults: CN-first prompts (en files ok). Merge overload: raise bar then chunked merge. Pack N=150, window ~6k, pack target ~8k. |

---

## 1. Goals

1. **High recall of named characters** on unknown long Chinese web novels (and short books) without book-specific rules.
2. Use **analysis model (Flash)** for unit name extraction and final roster merge; keep cost in the “few RMB per long book” band when possible.
3. Keep **unit task thin**: names (+ light aliases in-unit) only — not personality, goals, relationships, worldview.
4. Filter by **appearance frequency policy**, not a fixed top-K (e.g. not “top 80”).
5. Integrate with existing analysis UX: progress, cancel/failure, cache, no silent multi-ten-minute hang on HTTP extract.
6. Leave Pass2 (detail top-N) and Pass3 (relationships) as separate stages on the **final roster**.

## 2. Non-goals (this phase)

- Program/regex/surname frequency as primary name discovery (may remain debug-only or deleted later).
- Per-unit full character cards (personality, drive, speaking style, etc.).
- Per-unit relationship graphs or world bible extraction.
- Perfect alias resolution without any LLM merge (string equality alone is insufficient; merge is required).
- Replacing story / form / timeline modules.
- Multi-machine job queue (Redis); single-process progressive job is OK (same class as timeline).
- Guaranteeing every one-scene named extra appears in the final roster.

## 3. Problem statement

### Current failure mode

- Pass1 uses `buildNovelContext` (few representative chunks) → **coverage holes** on long books.
- One-shot “list all characters from excerpts” under-recalls mid/late cast.

### Rejected approach

- Full-text **program** candidates: high noise, surname-table bias, narrative style breaks speech patterns; tuning one book does not transfer.

### Chosen direction (pending grill freeze)

- **Unit-wise LLM name mentions** → aggregate → **frequency gate** → **merge to CharacterProfile stubs** → existing detail/relationship passes.

---

## 4. Definitions (must be precise)

### 4.1 Extraction unit

A contiguous text span with `unitId`, `label`, `startOffset`, `endOffset`, `text`.

**Unit construction policy (G1 frozen):**

| Condition | Unit strategy |
|-----------|----------------|
| Catalog exists and usable | Prefer **one unit ≈ one chapter**; **pack** only when chapter count is very large or bodies are tiny |
| Catalog missing / disabled / unusable | **Fixed windows** (~6–8k chars, newline-aware break) |
| Leading text before first chapter | Own unit “文首” if large enough |

**Frozen numbers (G2e engineering defaults, tunable after gold eval):**

- Pack when catalog chapters **> 150** or mean chapter body very small.
- Window size when no catalog: **~6000** chars (newline-aware).
- Pack target when packing chapters: **~8000** chars.

### 4.2 Mention (unit-level)

One **surface form** of a person name (or clear person-referring alias) that the unit model asserts appears in the unit text.

- **Not** places, orgs, techniques, items, anonymous “那人”.
- Unit output: `{ surface: string, aliasesInUnit?: string[] }`  
- **G2 frozen: presence-only (0/1 per surface per unit)** — do not ask the model for in-unit counts.

### 4.3 Name key vs display form

- **Surface**: exact string returned for a unit (e.g. `雪棠`, `洛雪棠`, `洛总`).
- **Cluster / person entity**: set of surfaces judged to be the same character (merge pass or clustering).
- **Canonical name**: display name chosen for the cluster (usually longest formal name).

**Critical:** Frequency **must not** permanently under-count a person because surfaces never merged before the gate.  
See §6 for proposed order: **gate after soft cluster** or **gate per surface then merge with inheritance**.

### 4.4 Frequency metrics (cluster-level, after soft merge)

| Metric | Meaning |
|--------|---------|
| `unitHits` | Number of distinct units where **any** surface of the cluster appeared |
| `mentionScore` | Sum over units of (presence or approx count) for the cluster |
| `span` | firstUnit..lastUnit (optional secondary signal) |

### 4.5 Frequency gate (not top-K)

- Keep **all** clusters that pass absolute (and optional relative) thresholds.
- **No** “sort by score and take top 80” as the primary policy.
- Soft safety for merge prompt size: if still too many, **raise the absolute bar** (e.g. minUnitHits += 1), still frequency-based — document max raise and what happens if still huge.

### 4.6 Final roster

Output of merge pass: list of `{ name, aliases[], role, briefDescription }` compatible with today’s Pass1 schema → feeds Pass2/Pass3.

---

## 5. Pipeline (logical)

```
fullText
  → buildUnits()
  → for each unit: Flash extract surfaces   [parallel, limited concurrency]
  → persist unit results (cache)
  → soft-cluster surfaces (rules light +/or cheap model)
  → compute unitHits / mentionScore per cluster
  → frequencyGate(clusters)   // not top-K
  → mergePass(Flash): roles + alias finalize + drop non-characters
  → CharacterProfile stubs
  → Pass2 detail (top M by role/priority — separate decision)
  → Pass3 relationships
```

### 5.1 Unit extract (Flash)

- Model: `createLLMProvider("analysis")` → deepseek-v4-flash when configured.
- Input: unit label + unit text (hard cap length).
- Output: characters surfaces only.
- Failure: mark unit `error`, **do not** pretend empty without recording; decide retry policy.

### 5.2 Soft cluster — **required (G1: scheme C)**

Without this, `雪棠`×50 and `洛雪棠`×40 fail or pass independently and merge is too late.

**G1 frozen order: low surface gate → soft cluster → cluster gate**

1. **Stage-1 surface gate (low):** drop pure one-off noise (e.g. single unit, single presence) with a **low** bar.
2. **Rule soft-cluster (deterministic first):**  
   - same string after normalize  
   - A is suffix/prefix of B, both length ≥ 2, plus surname or co-occurrence support  
   - explicit alias edges from unit `aliasesInUnit`
3. **Do not** invent cross-person merges by aggressive single-char substring.
4. Optional: Flash only on **ambiguous** surface pairs/groups.
5. **Stage-2 cluster gate:** book-length table on `unitHits` / `mentionScore` of the **cluster**.

### 5.3 Frequency gate (cluster stage)

**Numbers are placeholders until gold calibration (G1: must eval before done):**

| Book length (chars) | minUnitHits | minMentionScore (presence-only ≈ unitHits) |
|---------------------|-------------|-----------------------------------------------|
| < 50k | 1 | 2 |
| 50k–150k | 1–2 | 2 |
| 150k–500k | 2 | 3 |
| 500k–1.5M | 2–3 | 4 |
| ≥ 1.5M | 3 | 5 |

- Short unit counts (≤3 units): relax multi-unit requirement.
- **Ship bar (G1):** post-merge gold recall target on ≥1 short + ≥1 long book; tune table then freeze.

### 5.4 Merge pass (Flash)

- Input: frequency-qualified clusters (name + unitHits + sample evidence snippets optional) + short novelContext (existing builder OK).
- Task: drop non-characters, finalize aliases, assign role + one-line brief.
- **Not** full personality.
- **G2:** May **lightly add** names missing from the gated list **only if** supported by the provided novel excerpts (no free invention).
- **G2e merge overload:** If clusters still ≫ ~120 after raising the cluster bar: **chunked merge** (merge batches, then union + optional reconcile), not silent top-K truncate.

### 5.5 Downstream

- Pass2: deep dive **M = 5** fixed (G2) — priority order protagonist → antagonist → supporting (existing).
- Pass3: relationships among final names (cap list for tokens if needed; separate from name gate).

---

## 6. Alias / frequency ordering — **G1 frozen: C**

| Option | Status |
|--------|--------|
| A. Cluster then gate | rejected for v1 |
| B. Gate surfaces only then late cluster | rejected (alias under-count) |
| **C. Low surface gate → cluster → cluster gate** | **accepted** |

---

## 7. Runtime / product integration

### 7.1 Async — **G1 frozen: whole `characters` module async + progress**

Timeline lesson applies. For long books, **the entire characters extraction** (name scan → gate → merge → detail → relationships) runs as an **async job** with phases:

`queued | scanning | clustering | merging | detail | relationships | done | error | cancelled`

Progress fields (min): `phase`, `unitsDone`, `unitsTotal`, `message`.

Reuse patterns from timeline job + analysis FAB job state. Sync HTTP one-shot is **not** the long-book path.

### 7.2 Cache

- Key: `novelId + content fingerprint + unit offsets hash + prompt version + model id`.
- Cache **per-unit** results so forceRefresh can be “merge only” vs “full rescan”.
- Cache final roster in existing `characters` table as today.

### 7.3 Cancel / partial failure

- User cancel: stop scheduling new units; persist partial unit cache; status `error` or `cancelled`.
- Unit failures (**G2**): retry 1–2 with backoff; if still fail, record `failedUnitIds`; **job continues** (degraded) with warning in message; gate runs on available units.

### 7.4 Concurrency

- Configurable pool (e.g. 3–5) to respect DeepSeek limits without serializing 500 calls.

### 7.5 Cost / latency expectations (order of magnitude)

- Flash pricing ~$0.14/M in, $0.28/M out (official ballpark; verify live docs).
- Long book (~2M chars, ~300–500 units): roster-scan often **≪ $1** if unit outputs stay small; wall time dominates (minutes), not dollars.
- Product copy should set expectation: long book character analysis can take several minutes.

---

## 8. What we measure (acceptance)

### 8.1 Offline eval — **G1 frozen: required before “done”**

≥2 novels (short + long), local or fixtures:

- **Gold set:** 10–30 must-find names each (manual; include mid/late cast, aliases).
- Metrics: post-gate and post-merge **Recall@gold**; noise rate; alias cohesion sample.
- **Pass bar (proposal, tune in grill R2 if needed):** post-merge recall ≥ **0.85** on long-book gold; short-book ≥ **0.90**.

### 8.2 Product acceptance

- Progress visible; no multi-minute silent spinner without phase text.
- forceRefresh rescans; cache hit skips unit LLM.
- Completing characters module still enables write gate together with story + catalog (existing product rules).

---

## 9. Spike disposal

| Artifact | Action after freeze |
|----------|---------------------|
| `character-name-units.ts` / `aggregate.ts` / `scan.ts` | Rewrite to match frozen spec or delete |
| Pass1 hook to `scanNamesByUnits` | **Disconnected in draft phase** (see implementation note) |
| `character-candidates.ts` (program) | Out of scope for primary path; delete or debug-only later |
| Unit tests for “not top-N” | Keep idea; retarget to frozen gate math |

---

## 10. Grill questions — all resolved

| # | Topic | Decision |
|---|--------|----------|
| 1 | Units | Chapter-first; pack if >150 or tiny; else ~6k windows |
| 2 | Mention grain | Presence 0/1 per surface per unit |
| 3 | Alias / gate order | C: low surface gate → cluster → cluster gate |
| 4 | Async | Whole characters module async + progress |
| 5 | Eval | Gold on ≥2 books (short+long) before done; long recall ≥0.85 target |
| 6 | Pass2 M | Fixed 5 |
| 7 | Unit failure | Retry then degrade + warn |
| 8 | English | v1 Chinese-first; keep en prompt files for parity |
| 9 | Merge overload | Raise frequency bar, then chunked merge |
| 10 | Merge add names | Allowed lightly with excerpt evidence |

---

## 11. Key decisions

| ID | Decision | Status | Rationale |
|----|----------|--------|-----------|
| K1 | Flash unit scan for names, not program rules | draft→G1 lean-in | Transfer; thin task |
| K2 | Frequency gate, not top-K | **G1** | User requirement |
| K3 | No per-unit personality/relations | draft lean-in | Cost, merge hell |
| K4 | Soft cluster scheme C | **G1** | Alias under-count |
| K5 | Whole characters module async + progress | **G1** | Timeout/UX |
| K6 | Gold eval ≥2 books before done | **G1** | No theater |
| K7 | Chapter-first units, pack when needed | **G1** | Align “按章” + scale |
| K8 | Presence 0/1 per unit | **G2** | Simple, stable |
| K9 | Pass2 M=5 | **G2** | Cost bound |
| K10 | Degrade on unit failure | **G2** | Don’t fail whole book |
| K11 | Merge light add with evidence | **G2** | Threshold safety valve |

---

## 12. PR Plan (after grill freeze — provisional)

| PR | Scope | Depends |
|----|--------|---------|
| PR1 | Spec freeze + disconnect spike + eval harness stubs (gold lists optional) | — |
| PR2 | Units builder + per-unit cache schema + job progress API | PR1 |
| PR3 | Unit name extract (Flash) + retries + concurrency | PR2 |
| PR4 | Soft cluster + frequency gate (pure functions + tests) | PR1 |
| PR5 | Merge pass + wire CharacterExtractor / modular extract | PR3, PR4 |
| PR6 | UI progress for character phase; forceRefresh semantics | PR2, PR5 |
| PR7 | Gold eval run on 2 books; tune thresholds; docs | PR5 |

---

## 13. Implementation note (draft phase)

Until this document is **Status: Accepted (grill frozen)**:

- Production Pass1 should use **legacy excerpt-based list** (or previous stable behavior), **not** the unit-scan spike.
- Spike code may remain in tree for reference but must not be the default path.

---

## 14. References

- Product analysis modules: `docs/specs/analysis-and-chaptering.md`
- Dual models: analysis = Flash, write = Pro (`createLLMProvider`)
- Timeline async precedent: `timeline-job` / analysis FAB job state
