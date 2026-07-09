# Clean Mode — Serial Review-Iteration Pipeline

**Date:** 2026-07-09
**Status:** draft

## Problem

The current codex-based pipeline has 3 issues:
1. Codex compresses 200K chars into ~3K chars of summaries — significant information loss
2. 6 review agents run in parallel, producing conflicting findings for the rewrite agent
3. `autoFixable` was removed, but rewrite still only gets one pass at fixing

## Goal

A "clean mode" that uses full-text context for all agents and runs a serial review-rewrite loop until convergence. No codex, no structured data preprocessing.

## Design

### Pipeline

```
1. Writer gets FULL NOVEL TEXT (up to continuation point) + outline (optional)
   → generates prose

2. 6 review agents run IN PARALLEL on (full novel text + prose)
   → each produces findings[] + converged flag

3. If ALL agents return converged=true → done

4. Otherwise:
   → Writer gets full novel text + prose + ALL findings
   → rewrites prose
   → goto step 2

5. Max 20 rounds, then force stop
```

### Convergence

Each review agent returns `{ findings, converged: boolean }`. The review is converged when ALL 6 agents return `converged: true`. 

If any agent has `findings.length > 0` AND `converged = false`, the loop continues.

### Agent Changes

#### Writer (rounds 2+)

Input: full novel text + previous prose + all review findings

```
你是小说续写的修订作家。请根据审查反馈重写以下文字。

## 原文（续写前的全文）
<fullNovelText>

## 上一轮生成的 prose
<previousProse>

## 审查反馈
<findings from all 6 agents>

## 要求
- 修复所有标记的问题
- 保持叙事流畅和风格一致
- 直接输出修订后的完整文字
```

#### Review Agents

Each review agent gets:
- Full novel text (for context)
- The current prose (to review)
- Its dimension-specific instruction (same as current)

No codex. No structured data. Just text + instruction.

### Engine Changes

New mode flag: `cleanMode?: boolean`

When `cleanMode = true`:
1. Skip codex building in stream route
2. Run the serial review loop
3. `final_prose` event emitted after convergence
4. Each round emits `review_round` event with findings

### SSE Events (clean mode only)

```
"prose"         → first draft (like before)
"review_round"  → { round, findings[], converged }
"rewriting"     → between rounds
"final_prose"   → final prose after convergence
```

### Configuration

- Max rounds: 20 (configurable)
- Convergence: all 6 agents return `converged: true`

### Files Changed

| File | Change |
|------|--------|
| `src/core/simulation/engine.ts` | Add clean mode branch with serial review loop |
| `src/core/codex/review-orchestrator.ts` | Add clean mode review function using full text |
| `src/app/api/simulation/stream/route.ts` | Pass cleanMode flag, skip codex when enabled |
| `src/components/writing-workspace.tsx` | Handle `review_round` event |

### Out of Scope

- Removing codex mode (both coexist)
- UI toggle for clean mode (default to codex, can switch via config)
