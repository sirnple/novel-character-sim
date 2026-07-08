# Review-Rewrite Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rewrite step after review, turning review findings into actual prose corrections with visible before/after annotations.

**Architecture:** Five files changed. Types added to codex/types.ts and engine.ts. A `rewriteProse()` function added to review-orchestrator.ts. The engine inserts a rewrite step between review and scene_end, emitting new SSE events. The writing-workspace UI handles the new events and renders before/after annotations.

**Tech Stack:** Next.js App Router, React, TypeScript, SSE streaming, LLM (via factory)

---

### Task 1: Add types — ProseAnnotation and new event types

**Files:**
- Modify: `src/core/codex/types.ts`
- Modify: `src/core/simulation/engine.ts`

- [ ] **Step 1: Add `ProseAnnotation` type to codex/types.ts**

After the `ReviewReport` interface (after line 159), add:

```typescript
export interface ProseAnnotation {
  id: string;
  finding: ReviewFinding;
  originalSnippet: string;
  fixedSnippet: string;
}
```

Note: No `position` field. Instead of fragile character-offset matching, annotations are displayed as cards alongside the prose showing before/after text.

- [ ] **Step 2: Add new event types to engine.ts SimulationEvent**

Replace the `SimulationEvent` type (lines 14-20):

```typescript
export type SimulationEvent =
  | { type: "outline"; outline: SceneOutline; prompt?: { system: string; user: string } }
  | { type: "prose"; prose: string }
  | { type: "prompt"; systemPrompt: string; userPrompt: string }
  | { type: "review"; review: import("@/core/codex/types").ReviewReport }
  | { type: "rewriting"; status: string }
  | { type: "final_prose"; prose: string; annotations: import("@/core/codex/types").ProseAnnotation[] }
  | { type: "scene_end"; fullNovel: string }
  | { type: "error"; message: string };
```

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/codex/types.ts src/core/simulation/engine.ts
git commit -m "feat: add ProseAnnotation type and rewrite/final_prose events"
```

---

### Task 2: Add `rewriteProse()` and `generateAnnotations()` to review-orchestrator

**Files:**
- Modify: `src/core/codex/review-orchestrator.ts`

- [ ] **Step 1: Add imports**

At the top of the file, add the new type import. Change line 5 from:

```typescript
import type { WritersCodex, ReviewReport, ReviewFinding } from "./types";
```

to:

```typescript
import type { WritersCodex, ReviewReport, ReviewFinding, ProseAnnotation } from "./types";
```

- [ ] **Step 2: Add `rewriteProse()` function**

Add at the end of the file (after line 454, the closing of `reviewPacing`):

```typescript
/**
 * Rewrite prose to fix all auto-fixable review findings.
 * Returns corrected prose, or original if no auto-fixable findings exist.
 */
export async function rewriteProse(
  originalProse: string,
  findings: ReviewFinding[],
  _codex: WritersCodex
): Promise<string> {
  const autoFixable = findings.filter(f => f.autoFixable && f.snippet && f.suggestion);

  if (autoFixable.length === 0) {
    return originalProse;
  }

  const llm = createLLMProvider();
  const zh = isChinese(originalProse);

  const findingsText = autoFixable.map((f, i) =>
    `${i + 1}. [${f.dimension}] ${f.description}\n   问题片段: "${f.snippet}"\n   修改建议: ${f.suggestion}${f.fixedText ? `\n   建议修改为: "${f.fixedText}"` : ""}`
  ).join("\n\n");

  const prompt = zh
    ? `你是小说续写的修订编辑。请根据以下审查发现的问题，重写整段文字，修复所有标记的问题。

## 需要修复的问题
${findingsText}

## 原文
${originalProse}

## 修订要求
- 修复以上所有问题
- 保持叙事流畅、风格一致、角色声音不变
- 不修改与问题无关的内容
- 直接输出修订后的完整文字，不要用JSON包裹`
    : `You are a prose revision editor. Rewrite the text below fixing all flagged issues.

## Issues to Fix
${findingsText}

## Original Prose
${originalProse}

## Requirements
- Fix all issues listed above
- Maintain narrative flow and style consistency
- Do not change content unrelated to flagged issues
- Output the complete revised prose directly, no JSON wrapper`;

  const corrected = await llm.chat(
    [{ role: "user", content: prompt }],
    { temperature: 0.4, maxTokens: 16384 }
  );

  return corrected || originalProse;
}
```

- [ ] **Step 3: Add `generateAnnotations()` function**

Add after `rewriteProse()`:

```typescript
/**
 * Generate annotation cards from review findings.
 * Each annotation shows the original snippet vs corrected text.
 */
export function generateAnnotations(
  findings: ReviewFinding[]
): ProseAnnotation[] {
  return findings.map(f => ({
    id: Math.random().toString(36).slice(2, 10),
    finding: f,
    originalSnippet: f.snippet || "",
    fixedSnippet: f.fixedText || "",
  }));
}
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/codex/review-orchestrator.ts
git commit -m "feat: add rewriteProse and generateAnnotations functions"
```

---

### Task 3: Insert rewrite step into SimulationEngine

**Files:**
- Modify: `src/core/simulation/engine.ts`

- [ ] **Step 1: Add import for rewrite functions**

Change the import from review-orchestrator (line 8) from:

```typescript
import { runFullReview } from "@/core/codex/review-orchestrator";
```

to:

```typescript
import { runFullReview, rewriteProse, generateAnnotations } from "@/core/codex/review-orchestrator";
```

- [ ] **Step 2: Add import for ProseAnnotation**

Change the codex types import (line 10) from:

```typescript
import type { WritersCodex } from "@/core/codex/types";
```

to:

```typescript
import type { WritersCodex, ProseAnnotation } from "@/core/codex/types";
```

- [ ] **Step 3: Insert rewrite step after review**

In the `run()` method, replace the review block (lines 221-245) and the store-result block (lines 247-258) with the complete rewrite pipeline.

Replace from line 219 (`this.onEvent({ type: "prose", prose });`) through line 258 (`this.onEvent({ type: "scene_end", fullNovel: this.state.fullNovelOutput });`) with:

```typescript
      this.onEvent({ type: "prose", prose });

      let finalProse = prose;
      let annotations: ProseAnnotation[] = [];

      // --- Post-writing review ---
      if (this.runReview && this.codex) {
        try {
          const chapterNumber = (this.state.rounds?.length || 0) + 1;
          const review = await runFullReview({
            generatedProse: prose,
            codex: this.codex,
            chapterNumber,
          });
          this.onEvent({ type: "review", review });

          if (review.needsHumanReview.length > 0) {
            console.warn(
              `[Engine] ${review.needsHumanReview.length} issues need human review:`,
              review.needsHumanReview.map(f => `[${f.severity}] ${f.description}`).join("; ")
            );
          }

          // --- Rewrite with findings ---
          const autoFixable = review.findings.filter(f => f.autoFixable && f.snippet);
          if (autoFixable.length > 0) {
            this.onEvent({ type: "rewriting", status: "rewriting" });
            try {
              const corrected = await rewriteProse(prose, review.findings, this.codex);
              annotations = generateAnnotations(review.findings);
              finalProse = corrected;
            } catch (e) {
              console.warn("[Engine] Rewrite failed, using original prose:", e);
              annotations = generateAnnotations(review.findings);
            }
          }

          this.onEvent({ type: "final_prose", prose: finalProse, annotations });

          // Update codex for next chapter
          const outlineTitle = outline?.sceneTitle || "";
          this.codex = updateCodexAfterChapter(this.codex, review, chapterNumber, outlineTitle);
        } catch (e) {
          console.warn("[Engine] Review failed, continuing:", e);
        }
      }

      // --- Store result ---
      this.state.rounds.push({
        roundNumber: 1,
        directorAction: outline?.sceneGoal || "",
        channelMessages: [],
        characterResponses: [],
        proseOutput: finalProse,
      });

      this.state.fullNovelOutput = finalProse;
      this.state.status = "completed";
      this.onEvent({ type: "scene_end", fullNovel: this.state.fullNovelOutput });
```

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/simulation/engine.ts
git commit -m "feat: insert rewrite step between review and scene_end"
```

---

### Task 4: Update writing-workspace UI for new events and annotations

**Files:**
- Modify: `src/components/writing-workspace.tsx`

- [ ] **Step 1: Add annotation state**

After the existing `review` state (line 71), add:

```typescript
  const [annotations, setAnnotations] = useState<import("@/core/codex/types").ProseAnnotation[]>([]);
```

- [ ] **Step 2: Handle new events in startWriting**

In the `startWriting` function, in the switch statement handling SSE events (around lines 366-374), add cases for `rewriting` and `final_prose`:

Replace:
```typescript
                case "review": setReview(event.review); setShowReview(true); updateTask(activeTaskId!, { review: event.review }); break;
                case "scene_end": setStatus("completed"); onComplete?.(event.fullNovel); break;
```

with:
```typescript
                case "review": setReview(event.review); break;
                case "rewriting": setStatus("generating"); break;
                case "final_prose":
                  setOutputText(event.prose);
                  setAnnotations(event.annotations || []);
                  setReview(event.annotations?.length > 0 ? review : null);
                  setStatus("completed");
                  updateTask(activeTaskId!, {
                    output: event.prose,
                    review: review,
                    status: "completed",
                    savedToNovel: false,
                  });
                  break;
                case "scene_end": setStatus("completed"); onComplete?.(event.fullNovel); break;
```

Note: `review` is used before being updated in the `final_prose` case. To fix this, we need to store review into a local variable. In the `review` case, store it:

```typescript
                case "review": setReview(event.review); updateTask(activeTaskId!, { review: event.review }); break;
```

And in `final_prose`, use the review from the task or state. Actually, since review arrives before final_prose in the event stream, React state will be updated by the time final_prose arrives. But for safety, both set the state.

Let me simplify: keep the `review` case as-is (sets state + updates task). In `final_prose`, just focus on prose and annotations:

```typescript
                case "review": setReview(event.review); setShowReview(true); updateTask(activeTaskId!, { review: event.review }); break;
                case "rewriting": setStatus("generating"); break;
                case "final_prose":
                  setOutputText(event.prose);
                  setAnnotations(event.annotations || []);
                  setStatus("completed");
                  updateTask(activeTaskId!, { output: event.prose, status: "completed", savedToNovel: false });
                  break;
                case "scene_end": setStatus("completed"); onComplete?.(event.fullNovel); break;
```

- [ ] **Step 3: Add "rewriting" status to the header**

In the right panel header (around line 569-572), after the loading indicator for generating, add a rewriting indicator. Replace the status display section:

Replace:
```typescript
              {status === "completed" && !saved && <span className="text-[9px] text-orange-500/70 font-mono">有未保存内容</span>}
              {status === "completed" && saved && <span className="text-[9px] text-green-500/70 font-mono">已保存</span>}
              {status === "generating" && <span className="text-[9px] text-orange-500/70 font-mono flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />写作中...</span>}
```

with:

```typescript
              {status === "completed" && !saved && <span className="text-[9px] text-orange-500/70 font-mono">有未保存内容</span>}
              {status === "completed" && saved && <span className="text-[9px] text-green-500/70 font-mono">已保存</span>}
              {status === "generating" && outputText && <span className="text-[9px] text-orange-500/70 font-mono flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />修正中...</span>}
              {status === "generating" && !outputText && <span className="text-[9px] text-orange-500/70 font-mono flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />写作中...</span>}
```

- [ ] **Step 4: Render annotation cards after prose**

In the reader body, after the unsaved prose div (around line 636, after the closing `</>` of the `outputText && !saved` block), add annotation cards:

Immediately before the closing `</>` of the reader-render block (after line 649 `)}` — the one that closes the `{!initialFullNovel && !outputText && ... ? empty : (...)}` ternary), add:

```typescript
                  {/* Annotation cards — show before/after for each review finding */}
                  {annotations.length > 0 && saved === false && (
                    <div className="max-w-[800px] mx-auto mt-8 space-y-3">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="flex-1 h-px bg-neutral-700/50" />
                        <span className="text-xs text-neutral-500 font-mono shrink-0">审查修正 ({annotations.length} 处)</span>
                        <div className="flex-1 h-px bg-neutral-700/50" />
                      </div>
                      {annotations.map((a) => (
                        <div key={a.id} className={`p-3 rounded border text-xs ${
                          a.finding.severity === "critical" ? "border-red-500/30 bg-red-500/5" :
                          a.finding.severity === "major" ? "border-yellow-500/30 bg-yellow-500/5" :
                          "border-neutral-700 bg-neutral-800/20"
                        }`}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase ${
                              a.finding.severity === "critical" ? "bg-red-500/20 text-red-300" :
                              a.finding.severity === "major" ? "bg-yellow-500/20 text-yellow-300" :
                              "bg-neutral-600/30 text-neutral-400"
                            }`}>{a.finding.severity}</span>
                            <span className="text-neutral-500">{a.finding.dimension}</span>
                            {a.finding.autoFixable && <span className="text-green-500/70 ml-auto text-[9px] font-mono">已修正</span>}
                            {!a.finding.autoFixable && <span className="text-orange-500/70 ml-auto text-[9px] font-mono">待人工确认</span>}
                          </div>
                          <p className="text-neutral-300 leading-relaxed mb-2">{a.finding.description}</p>
                          {a.originalSnippet && (
                            <div className="space-y-1.5">
                              <div className="flex items-start gap-2">
                                <span className="text-[9px] text-red-400 font-mono shrink-0 mt-0.5">问题</span>
                                <span className="text-neutral-500 italic text-xs leading-relaxed">{a.originalSnippet}</span>
                              </div>
                              {a.fixedSnippet && (
                                <div className="flex items-start gap-2">
                                  <span className="text-[9px] text-green-400 font-mono shrink-0 mt-0.5">修正</span>
                                  <span className="text-neutral-300 text-xs leading-relaxed">{a.fixedSnippet}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {a.finding.suggestion && (
                            <p className="text-neutral-600 mt-2 text-xs leading-relaxed border-t border-neutral-700/50 pt-2">{a.finding.suggestion}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
```

- [ ] **Step 5: Remove old ReviewSection (optional, keep as fallback)**

The old `ReviewSection` component (lines 664-690) can remain as-is for now. It renders when `showReview` is true and `review` exists. Since the annotations section now renders the key information inline, the old review panel serves as the detailed view. No changes needed.

But update the review toggle button (around line 598-599) to show annotation count instead of finding count:

Replace:
```typescript
              {review && <button onClick={() => setShowReview(!showReview)} className={`...`}>
                <Shield className="w-3 h-3" />审查 ({review.findings.length})</button>}
```

with:
```typescript
              {review && <button onClick={() => setShowReview(!showReview)} className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${showReview ? "text-green-400" : "text-neutral-500 hover:text-green-400"}`}>
                <Shield className="w-3 h-3" />审查详情 ({review.findings.length})</button>}
```

- [ ] **Step 6: Verify build**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/writing-workspace.tsx
git commit -m "feat: handle rewrite events, render annotations with before/after cards"
```

---

### Post-Implementation Verification

- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] Generate prose in the writer → observe "修正中..." loading state
- [ ] After rewrite completes → final prose displayed with annotation cards below
- [ ] Annotation cards show before/after snippets with dimension and severity
- [ ] "保存为最新章节" saves the corrected prose
- [ ] When no auto-fixable findings exist → prose displayed without rewrite step
