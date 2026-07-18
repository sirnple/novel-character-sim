# Plan: Character name scan (Flash units + frequency gate)

**Spec:** `docs/superpowers/specs/2026-07-18-character-name-scan-design.md` (grill frozen)  
**Status:** Implementation in progress (2026-07-18)  
**Executed from:** user “执行 plan”

---

## Outcome

Long/unknown novels get a high-recall **named character roster** via:

1. Flash per unit (chapter-first) — names only  
2. Low surface gate → soft alias cluster → cluster frequency gate (**not top-K**)  
3. Flash merge → role + brief  
4. Existing Pass2 (top 5 detail) + Pass3 relationships  

Whole **characters** module runs **async with progress**. Feature is **not done** until gold eval on ≥2 books passes.

---

## PR sequence

### PR1 — Spec hygiene + safe baseline

- Keep Pass1 on **legacy excerpt** path (already disconnected).
- Leave spike files unreferenced or mark `@deprecated spike` in headers.
- Add empty gold fixture dirs: `scripts/eval/character-gold/` (README only OK).
- **No** user-facing behavior change.

### PR2 — Units + job skeleton

- `buildNameScanUnits` per frozen numbers (chapter-first, pack >150, window 6k, pack 8k).
- `CharacterExtractJob` state (memory and/or SQLite, mirror timeline job patterns): phases, unitsDone/Total, failedUnitIds, message.
- API: start / status for character extract job (or extend modular extract to enqueue characters).
- Unit tests: units builder on catalog + no-catalog text.

### PR3 — Per-unit Flash extract + cache

- Prompt `character_names_unit` (already drafted).
- Concurrency pool (3–5), retry 1–2, record failures.
- Persist per-unit JSON keyed by fingerprint + unit range + prompt/model version.
- Progress: scanning phase.

### PR4 — Aggregate: surface gate → cluster → cluster gate

- Pure functions + tests:
  - presence aggregate
  - soft cluster rules (no aggressive 1-char)
  - stage-1 low gate, stage-2 length table
  - raise bar / never top-K primary
- No LLM in this PR except optional later.

### PR5 — Merge pass + profile stubs

- Wire merge prompt with `frequencyRoster`.
- Light add names only with excerpt evidence.
- Chunked merge if still huge after raise-bar.
- Write `CharacterProfile` stubs → existing saveCharacters.

### PR6 — Detail + relationships inside same job

- After merge: Pass2 M=5, Pass3 as today.
- Job phase transitions; mark done/error.
- Analysis FAB / overview: show character job progress (not silent).

### PR7 — Gold eval + threshold tune

- Manual gold lists for 欲孽灼心 (short) + 绿帽武神 (long) — or user-supplied.
- Script: run scan offline (or against cached units) → recall@gold.
- Tune minUnitHits table until long ≥0.85, short ≥0.90 (or document shortfall).
- Only then: enable unit-scan path as **default** characters extract; delete or quarantine program `character-candidates` primary use.

---

## Explicit non-goals in plan

- Program NER as primary  
- Per-unit personality  
- Changing Pass2 to >5 in v1  
- Multi-node queue  

---

## Risks

| Risk | Mitigation |
|------|------------|
| Alias cluster wrong | Conservative rules; merge pass can split/drop |
| Job too long | Progress + unit cache + concurrency |
| Gold hard to build | Start 15 names/book, expand if needed |
| Extract HTTP still used elsewhere | Route characters module only through job |

---

## Definition of done

- [ ] Grill-frozen spec implemented as default for `characters` module  
- [ ] Async progress visible  
- [ ] Gold eval script green on 2 books  
- [ ] Legacy excerpt path removable or debug-only  
- [ ] No top-K as primary roster policy  
