### Task 6: Spec status + verification gate

**Files:**
- Modify: `docs/specs/analysis-and-chaptering.md` §7 / §8 C checkboxes where true

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: all suites pass including `form-context`, `accept chapter meta`, `chapter-catalog`.

- [ ] **Step 2: Update spec §7 rows**

Set:

| Area | New status |
|------|------------|
| Agent tools load form/boundary | **done** (get_novel_form + get_branch_meta.form) |
| Outline/writer prompt text | **partial→improved** (tool-required; still no structured chapterPlan JSON) |
| Accept boundary + catalog | **partial** (tests cover happy paths; outline keyword still heuristic) |

Mark §8 C items checked only if truly done:

- [x] Outline/writer can read form via tool  
- [x] When chaptering disabled, writer prompts forbid inventing 第N章  

- [ ] **Step 3: Commit**

```bash
git add docs/specs/analysis-and-chaptering.md
git commit -m "docs(spec): mark agent form consumption P0 as implemented"
```

---

## Self-review (plan vs spec)

### Spec coverage (P0)

| Spec §9 P0 item | Task |
|-----------------|------|
| Tool: get_novel_form / extend get_branch_meta | Task 2 |
| Wire outline + writer to consume data | Task 3 |
| Automated tests: form enable/disable, accept boundary, tool payload | Tasks 1 + 4 |

| Spec §8 C | Task |
|-----------|------|
| Read continuationRules + samples + boundary | Tasks 1–3 |
| Disabled → forbid invent 第N章 | Tasks 1, 3 |

| Bonus (P1.6 light) | Task 5 form-before-timeline |

Not covered (correctly deferred): durable jobs, mobile rail, hierarchy tree, export TOC, overview card.

### Placeholder scan

No TBD/TODO steps; code blocks included for helpers, tools, tests, extract guard.

### Type consistency

- `FormAgentContext` / `buildFormAgentContext` / `formatFormAgentContextForTool` used consistently in Task 1–2.
- Tool name `get_novel_form` consistent across branch-tools, writer schemas, chat allowlist, agent-panel, prompts.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-07-18-analysis-form-agent-consume.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session, batch with checkpoints  

**Which approach?**
