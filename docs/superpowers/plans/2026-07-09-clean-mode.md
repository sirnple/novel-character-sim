# Clean Mode Serial Review-Iteration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clean mode that iterates Writer→Review→Rewrite with full-text context until all 6 review agents converge, max 20 rounds.

**Architecture:** New `runFullReviewClean()` in review-orchestrator uses full novel text instead of codex. Engine gets a `cleanMode` flag and a serial review loop (writer→review→check convergence→rewrite). Stream route passes the flag. No codex, no structured data.

**Tech Stack:** TypeScript, Next.js, SSE streaming

---

### Task 1: Clean mode review functions in review-orchestrator

**Files:**
- Modify: `src/core/codex/review-orchestrator.ts`

- [ ] **Step 1: Add clean-mode review result type**

After the `ReviewResult` interface, add:

```typescript
interface CleanReviewResult {
  findings: ReviewFinding[];
  converged: boolean;
}
```

- [ ] **Step 2: Add `reviewCharacterConsistencyClean()` function**

Add after the existing `reviewCharacterConsistency` function. This version takes full novel text instead of codex:

```typescript
async function reviewCharacterConsistencyClean(
  fullNovelText: string,
  generatedProse: string,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<CleanReviewResult> {
  const prompt = zh
    ? `## 审查指南
你是角色一致性审查员。对照原文中角色的性格和说话方式，检查生成文字中是否有角色行为/语言偏离设定。只基于原文判断，不要凭空假设。

### 严重级别
- **critical** = 角色行为与其在原文中展现的核心人格彻底矛盾
- **major** = 说话风格明显偏离原文中该角色的习惯
- **minor** = 措辞微调问题

### 收敛判断
如果生成文字中的角色表现与原文高度一致、没有任何偏离，设置 converged: true。
即使有 minor 级别的问题，如果它们不影响角色整体一致性，也可以设置 converged: true。

## 原文（角色在原文中的全部表现）
${fullNovelText.slice(0, 60000)}

## 生成文字
${generatedProse.slice(0, 8000)}

请输出你的审查发现和收敛判断。没有发现则返回空数组并设置 converged: true。`

    : `## Review Guidelines
You are a character consistency reviewer. Check the generated prose against how characters behave and speak in the original text. Judge only from the original text, don't assume.

### Severity
- **critical** = Character acts completely contrary to core personality shown in original
- **major** = Speaking style noticeably deviates from patterns in original
- **minor** = Minor diction refinement

### Convergence
If character portrayal in generated prose is highly consistent with original, set converged: true.
Even with minor issues that don't affect overall consistency, you can set converged: true.

## Original Text (all appearances of characters)
${fullNovelText.slice(0, 60000)}

## Generated Prose
${generatedProse.slice(0, 8000)}

Output your findings and convergence judgment. Return empty findings and converged: true if nothing to report.`;

  const schema = {
    name: "character_review_clean",
    parameters: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              severity: { type: "string", enum: ["critical", "major", "minor"] },
              location: { type: "string" },
              description: { type: "string" },
              suggestion: { type: "string" },
              snippet: { type: "string" },
            },
            required: ["severity", "description", "suggestion"],
          },
        },
        converged: { type: "boolean" },
      },
      required: ["findings", "converged"],
    },
  };

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
    schema,
    { temperature: 0.2, maxTokens: 4096 }
  );

  return {
    findings: (result.findings || []).map((f: any) => ({
      dimension: "character" as const,
      severity: f.severity,
      location: f.location || "",
      description: f.description,
      suggestion: f.suggestion,
      snippet: f.snippet,
    })),
    converged: result.converged ?? (result.findings || []).length === 0,
  };
}
```

- [ ] **Step 3: Add the other 5 clean review functions**

Add `reviewContinuityClean()`, `reviewForeshadowingClean()`, `reviewStyleClean()`, `reviewWorldBuildingClean()`, `reviewPacingClean()` following the same pattern. Each takes `(fullNovelText, generatedProse, llm, zh)` and returns `CleanReviewResult`.

The key difference from codex mode: each agent gets `fullNovelText.slice(0, 60000)` as context instead of structured codex data. The `converged` field is standard across all 6.

For continuity:
```typescript
async function reviewContinuityClean(
  fullNovelText: string,
  generatedProse: string,
  llm: ReturnType<typeof createLLMProvider>,
  zh: boolean
): Promise<CleanReviewResult> {
  const prompt = zh
    ? `## 审查指南
你是连贯性审查员。检查生成文字是否与原文中已建立的事实存在逻辑矛盾。

### 严重级别
- **critical** = 关键事实与原文矛盾（已死角色出现、事件链断裂）
- **major** = 信息凭空出现、角色知道不该知道的信息
- **minor** = 细节不一致但不影响情节逻辑

### 收敛判断
如果生成文字与原文在所有事实上一致，设置 converged: true。

## 原文
${fullNovelText.slice(0, 60000)}

## 生成文字
${generatedProse.slice(0, 8000)}

请输出你的审查发现和收敛判断。`
    : `## Review Guidelines
You are a continuity reviewer. Check the generated prose against established facts in the original text.

### Severity
- **critical** = Key facts contradict original
- **major** = Info appears from nowhere
- **minor** = Minor inconsistencies that don't affect plot logic

### Convergence
If the generated prose is factually consistent with the original, set converged: true.

## Original
${fullNovelText.slice(0, 60000)}

## Generated Prose
${generatedProse.slice(0, 8000)}

Output your findings and convergence judgment.`;

  const schema = {
    name: "continuity_review_clean",
    parameters: {
      type: "object",
      properties: {
        findings: { type: "array", items: { type: "object", properties: { severity: { type: "string", enum: ["critical", "major", "minor"] }, location: { type: "string" }, description: { type: "string" }, suggestion: { type: "string" }, snippet: { type: "string" } }, required: ["severity", "description", "suggestion"] } },
        converged: { type: "boolean" },
      },
      required: ["findings", "converged"],
    },
  };

  const result = await llm.chatWithTool<any>(
    [{ role: "user", content: prompt }],
    schema,
    { temperature: 0.1, maxTokens: 4096 }
  );

  return {
    findings: (result.findings || []).map((f: any) => ({ dimension: "continuity" as const, severity: f.severity, location: f.location || "", description: f.description, suggestion: f.suggestion, snippet: f.snippet })),
    converged: result.converged ?? (result.findings || []).length === 0,
  };
}
```

(Implement the remaining 4 — foreshadowing, style, world, pacing — with their domain-specific instructions but the same structure.)

- [ ] **Step 4: Add `runFullReviewClean()` orchestrator**

```typescript
export async function runFullReviewClean(
  fullNovelText: string,
  generatedProse: string,
  onEvent?: (event: any) => void
): Promise<{ allConverged: boolean; allFindings: ReviewFinding[] }> {
  const llm = createLLMProvider();
  const zh = isChinese(generatedProse);

  const agentDefs = [
    { id: "review_char", name: "角色一致性", fn: reviewCharacterConsistencyClean },
    { id: "review_cont", name: "连贯性", fn: reviewContinuityClean },
    { id: "review_fore", name: "伏笔追踪", fn: reviewForeshadowingClean },
    { id: "review_style", name: "风格", fn: reviewStyleClean },
    { id: "review_world", name: "世界观", fn: reviewWorldBuildingClean },
    { id: "review_pace", name: "节奏", fn: reviewPacingClean },
  ];

  const results = await Promise.all(
    agentDefs.map(async (def) => {
      if (onEvent) onEvent({ type: "agent", agentId: def.id, name: def.name, status: "running" });
      const r = await def.fn(fullNovelText, generatedProse, llm, zh);
      if (onEvent) onEvent({
        type: "agent", agentId: def.id, name: def.name, status: "done",
        messages: [{ role: "assistant" as const, content: JSON.stringify({ findings: r.findings, converged: r.converged }) }],
      });
      return r;
    })
  );

  const allFindings = results.flatMap(r => r.findings);
  const allConverged = results.every(r => r.converged);

  return { allConverged, allFindings };
}
```

- [ ] **Step 5: Verify build and commit**

```bash
npx tsc --noEmit
git add src/core/codex/review-orchestrator.ts
git commit -m "feat: add clean mode review functions with convergence check"
```

---

### Task 2: Serial review loop in engine

**Files:**
- Modify: `src/core/simulation/engine.ts`

- [ ] **Step 1: Add `cleanMode` flag and `fullNovelText` to constructor**

In the constructor, add after `allowAdult`:

```typescript
    allowAdult = false,
    cleanMode = false,
    fullNovelText?: string
```

And store:

```typescript
    this.allowAdult = allowAdult;
    this.cleanMode = cleanMode;
    this.fullNovelText = fullNovelText || "";
```

Add the fields to the class:

```typescript
  private allowAdult: boolean;
  private cleanMode: boolean;
  private fullNovelText: string;
```

- [ ] **Step 2: Import `runFullReviewClean`**

```typescript
import { runFullReview, rewriteProse, generateAnnotations, buildSharedReviewSystemPrompt, runFullReviewClean } from "@/core/codex/review-orchestrator";
```

- [ ] **Step 3: Add clean mode loop in `run()` method**

After the Writer generates prose, add a branch. Find the `// --- Post-writing review ---` section (line 228) and add clean mode logic before it:

```typescript
      // --- Clean mode: serial review loop ---
      if (this.cleanMode) {
        let currentProse = prose;
        let allConverged = false;
        const maxRounds = 20;

        for (let round = 1; round <= maxRounds; round++) {
          debugLog("Engine", `Clean mode round ${round}/${maxRounds}: reviewing...`);
          
          const reviewResult = await runFullReviewClean(
            this.fullNovelText,
            currentProse,
            this.onEvent
          );

          allConverged = reviewResult.allConverged;
          
          this.onEvent({
            type: "review_round",
            round,
            findings: reviewResult.allFindings,
            converged: allConverged,
          });

          if (allConverged || round === maxRounds) {
            finalProse = currentProse;
            annotations = generateAnnotations(reviewResult.allFindings);
            break;
          }

          // Not converged — rewrite
          this.onEvent({ type: "rewriting", status: `round_${round}` });
          debugLog("Engine", `Clean mode round ${round}: rewriting with ${reviewResult.allFindings.length} findings`);

          const findingsText = reviewResult.allFindings.map((f, i) =>
            `${i + 1}. [${f.dimension}][${f.severity}] ${f.description}\n   修改建议: ${f.suggestion}${f.snippet ? `\n   问题片段: "${f.snippet}"` : ""}`
          ).join("\n\n");

          const llm = createLLMProvider();
          const rewritePrompt = `你是小说续写的修订作家。请根据审查反馈重写以下文字。

## 原文（续写前的全文）
${this.fullNovelText.slice(-30000)}

## 当前生成的 prose
${currentProse}

## 审查反馈
${findingsText}

## 要求
- 修复以上所有问题
- 保持叙事流畅和风格一致
- 直接输出修订后的完整文字`;

          const corrected = await llm.chat(
            [{ role: "user", content: rewritePrompt }],
            { temperature: 0.5, maxTokens: 16384 }
          );
          currentProse = corrected || currentProse;
          this.onEvent({ type: "prose", prose: currentProse });
        }

        // Emit final prose with annotations
        this.onEvent({ type: "final_prose", prose: finalProse, annotations });

        // skip codex review block
      } else {
        // existing codex review block stays here
        // --- Post-writing review --- (existing code)
```

- [ ] **Step 4: Wrap existing codex review in else branch**

Indent the existing review block to be inside the `else { }` of the clean mode branch. Make sure `final_prose` emission in the codex path still works.

- [ ] **Step 5: Verify build and commit**

```bash
npx tsc --noEmit
git add src/core/simulation/engine.ts
git commit -m "feat: add clean mode serial review loop in engine"
```

---

### Task 3: Wiring — stream route + UI

**Files:**
- Modify: `src/app/api/simulation/stream/route.ts`
- Modify: `src/components/writing-workspace.tsx`

- [ ] **Step 1: Pass `cleanMode` and `fullNovelText` from stream route to engine**

In `src/app/api/simulation/stream/route.ts`, destructure `cleanMode` from body:

```typescript
    allowAdult,
    cleanMode,
  }: {
    // ... existing types
    allowAdult?: boolean;
    cleanMode?: boolean;
  } = body;
```

Pass to engine constructor:

```typescript
      const engine = new SimulationEngine(
        novelTitle || "Untitled",
        characters,
        scene,
        sendEvent,
        writingStyle,
        timelineContext,
        lastChapterStatesStr,
        codex,
        !outlineOnly,
        continueFromOffset ? dbNovelText.slice(0, continueFromOffset) : undefined,
        allowAdult || false,
        cleanMode || false,
        cleanMode ? dbNovelText : undefined
      );
```

- [ ] **Step 2: Add `review_round` event to SimulationEvent**

In `src/core/simulation/engine.ts`:

```typescript
  | { type: "review_round"; round: number; findings: ReviewFinding[]; converged: boolean }
```

- [ ] **Step 3: Handle `review_round` in writing-workspace UI**

In the SSE event switch, add:

```typescript
case "review_round":
  setReview({ findings: event.findings, needsHumanReview: event.findings.filter((f: any) => f.severity === "critical") });
  setShowReview(true);
  break;
```

- [ ] **Step 4: Verify build and commit**

```bash
npx tsc --noEmit
git add src/app/api/simulation/stream/route.ts src/components/writing-workspace.tsx src/core/simulation/engine.ts
git commit -m "feat: wire clean mode through stream route and UI"
```

---

### Post-Implementation Verification

- [ ] `npx tsc --noEmit` passes
- [ ] Clean mode: Writer generates prose → review rounds appear → prose converges → `final_prose` emitted
- [ ] Codex mode still works (no regression)
- [ ] `finalNovel` ends with converged prose
