### Task 3: Wire outline + writer tools and prompts

**Files:**
- Modify: `src/core/agents/agents/writer.ts` (CREATE_TOOLS / REWRITE_TOOLS schemas)
- Modify: `src/core/prompts/outline-system.md`
- Modify: `src/core/prompts/outline-agent-contract.md`
- Modify: `src/core/prompts/writer-create-system.md`
- Modify: `src/core/prompts/writer-rewrite-system.md`
- Modify: `src/core/prompts/writer-create-user.md` (if it lists tools)
- Note: `outline.ts` already spreads full `branchTools` — after Task 2 it already includes `get_novel_form`. Still update prompts.

**Interfaces:**
- Consumes: tool names `get_novel_form`, `get_branch_meta` from Task 2
- Produces: prompt instructions that force load-before-plan/write; no new TypeScript types

- [ ] **Step 1: Writer CREATE_TOOLS include form tools**

In `src/core/agents/agents/writer.ts`, change CREATE_TOOLS schema list:

```ts
const CREATE_TOOLS = [
  ...schemas([
    "get_outline",
    "get_branch_text",
    "get_branch_characters",
    "get_branch_timeline",
    "get_branch_world",
    "get_branch_meta",
    "get_novel_form",
  ]),
  ...FS_READ,
  SAVE_SCHEMA,
];
```

Optionally add `get_novel_form` to REWRITE_TOOLS as well (recommended — rewrite must not invent chapters either):

```ts
const REWRITE_TOOLS = [
  ...schemas(["get_prose", "get_findings", "get_branch_text", "get_novel_form"]),
  ...FS_READ,
  SAVE_SCHEMA,
];
```

- [ ] **Step 2: Update `outline-agent-contract.md` steps**

In step 1 tools list, require form:

```markdown
### 步骤 1：取语境（按需，章法必取）
静默调用：
- **`get_novel_form`**（必做一次）：是否分章、章名 samples、continuationRules、章边界
- `get_branch_text` / `get_branch_characters` / `get_branch_timeline` / `get_branch_world`
- `get_foreshadowing_ledger`（若有活跃伏笔）

若 `forbidInventChapterTitles=true`：大纲中禁止规划「第N章」标题，除非用户明确要求分章。
若 `chapteringEnabled=true`：必须写清 `续写本章` / `收束本章并新开` / `新开一章`，新章标题贴合 samples。
```

Update the tools table to include `get_novel_form`.

- [ ] **Step 3: Update `outline-system.md` 篇幅与章节规划**

Ensure the chapter strategy section explicitly says:

```markdown
- **先调用 `get_novel_form`（或读 `get_branch_meta.form`）** 再写章节规划
- 若 `chapteringEnabled=false` / `forbidInventChapterTitles=true`：不要编造「第N章」，用场景/段落规划即可
- 若 `chapteringEnabled=true`：新章标题必须贴近 `chapterTitleSamples` 的格式；并遵守 `continuationRules`
- 必须使用可检索关键词之一写清策略：`续写本章` / `收束本章` / `新开一章`（accept 边界启发式依赖这些词）
```

- [ ] **Step 4: Update `writer-create-system.md`**

Replace the soft “章标题” section with a hard step:

```markdown
### 2b. 形态/章法（必做一次）
- 调用 `get_novel_form`（或 `get_branch_meta` 中的 form）
- 若 `forbidInventChapterTitles=true`：**禁止**在正文中写「第N章…」标题行，除非用户 prompt 明确要求分章
- 若 `chapteringEnabled=true`：
  - 大纲写「新开」→ 正文以与 `chapterTitleSamples` 一致的标题起笔（独占一行）
  - 大纲写「续写本章」→ **不要**无故新起章标题
  - 遵守 `continuationRules` 全文
```

Also list `get_novel_form` in the tools table.

- [ ] **Step 5: Update `writer-rewrite-system.md`**

Add constraint block:

```markdown
## 章法
改写时调用 `get_novel_form` 一次。若 `forbidInventChapterTitles=true`，不要新增「第N章」标题行。若原草稿已有章标题，保持格式一致，勿改成另一种编号体系。
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`  
Expected: clean.

```bash
git add src/core/agents/agents/writer.ts src/core/prompts/outline-system.md src/core/prompts/outline-agent-contract.md src/core/prompts/writer-create-system.md src/core/prompts/writer-rewrite-system.md src/core/prompts/writer-create-user.md
git commit -m "feat(agents): outline/writer consume novel form chaptering rules"
```

---

