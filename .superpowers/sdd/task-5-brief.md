### Task 5: Hard dependency — form before timeline job units

**Files:**
- Modify: `src/core/extractor/run-modular-extract.ts`
- Optional log-only; no new public API required

**Interfaces:**
- Consumes: existing `analyzeNovelForm`, `want("form")`, `want("timeline")`, `startTimelineJob`
- Produces: when user selects timeline without form cache, form is analyzed before job starts so units can use chapters

- [ ] **Step 1: Read current phase1/phase2 ordering**

Confirm: form and other modules run in `Promise.all` phase1; timeline starts in phase2. If user checks **only timeline** and form is missing, job falls back to scene/window units (OK). If user checks **form + timeline** in parallel, form might still be finishing when… actually form is in same phase1 Promise.all, so when phase1 completes, form is saved before phase2. Soft ordering already exists **if form is selected**.

Gap: user selects timeline only, no form cache → no chapters. Spec P1.6: “Ensure form runs before timeline when both selected” — already soft. Strengthen to:

**When `want("timeline")` and no usable form (`!getNovelForm` or forceRefresh form empty), auto-run form once before `startTimelineJob`.**

- [ ] **Step 2: Implement auto form-before-timeline**

In phase2 block of `run-modular-extract.ts`, before `startTimelineJob`:

```ts
if (want("timeline")) {
  let form = result.form || getNovelForm(userId, novelId);
  if (!form || forceRefresh) {
    // Hard dependency: units need form/catalog when possible (D7)
    console.log("[Extract] timeline requires form first — analyzing form...");
    const llm = createLLMProvider();
    const formResult = await runWithTokenContext({ agentId: "extract_form" }, () =>
      analyzeNovelForm(novelId, text, llm),
    );
    saveNovelForm(userId, novelId, formResult.profile);
    ensureMainBranch(userId, novelId);
    if (formResult.profile.chaptering.enabled && formResult.catalog.length > 0) {
      const existing = getBranchChapterMeta(userId, novelId, branchId);
      saveBranchChapterMeta(userId, {
        ...existing,
        novelId,
        branchId,
        chapters: formResult.catalog,
        chapterBoundary: existing.chapterBoundary || "closed",
      });
    }
    result.form = formResult.profile;
    result.chapterCatalogCount = formResult.catalog.length;
    if (!result.ran.includes("form")) result.ran.push("form");
    form = formResult.profile;
  }
  // ... then startTimelineJob as today
}
```

Avoid double-running form when phase1 already ran it: only enter this block when `!result.form && !result.ran.includes("form")` or when form missing in DB.

Refined guard:

```ts
if (want("timeline")) {
  if (!result.form) {
    result.form = getNovelForm(userId, novelId);
  }
  if (!result.form) {
    // auto form as above
  }
  // start job...
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/core/extractor/run-modular-extract.ts
git commit -m "fix(extract): analyze form before timeline job when missing"
```

---

