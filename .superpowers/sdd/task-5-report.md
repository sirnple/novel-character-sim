# Task 5 Report: Hard dependency — form before timeline job units

## Status
**Done**

## What changed
In `src/core/extractor/run-modular-extract.ts` phase2 (before `startTimelineJob`):

1. Resolve form: `result.form || getNovelForm(userId, novelId)`.
2. If still missing, auto-run form once (`analyzeNovelForm` → `saveNovelForm` → seed branch catalog when chaptering enabled), then set `result.form` / `chapterCatalogCount` and push `"form"` to `result.ran` if needed.
3. Then start timeline job as before.

## Double-run avoidance
- Phase1 form success sets `result.form` → auto block skipped.
- Form already in DB (timeline-only, prior run) → `getNovelForm` fills `result.form` → auto block skipped.
- Only timeline-only with empty form cache triggers auto form.

## Typecheck
`npx tsc --noEmit` — **pass** (exit 0)

## Commit
`fix(extract): analyze form before timeline job when missing`

## Concerns
None. Soft phase1 form+timeline ordering unchanged; this only covers missing form when timeline is selected.
