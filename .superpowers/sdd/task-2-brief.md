### Task 2: Agent tools — `get_novel_form` + extend `get_branch_meta`

**Files:**
- Modify: `src/core/agents/agents/branch-tools.ts`
- Modify: `src/app/api/agent/chat/route.ts` (master allowlist)
- Modify: `src/components/agent-panel.tsx` (label map)

**Interfaces:**
- Consumes: `buildFormAgentContext`, `formatFormAgentContextForTool` from `@/core/form/form-context`; `getNovelForm`, `getBranchChapterMeta`, `getBranchProse` from `@/lib/db`
- Produces: tool names `get_novel_form`, enhanced `get_branch_meta` registered via existing `branchTools` array (auto-registered in `init.ts`)

- [ ] **Step 1: Extend `branch-tools.ts` imports**

At top of `src/core/agents/agents/branch-tools.ts`, change imports to:

```ts
import type { ToolDefinition } from "../types";
import {
  getBranchProse,
  getCharacters,
  getTimeline,
  getStoryInfo,
  getNovelForm,
  getBranchChapterMeta,
} from "@/lib/db";
import {
  buildFormAgentContext,
  formatFormAgentContextForTool,
} from "@/core/form/form-context";
import { formatCriticalMiss } from "../critical-miss";
```

- [ ] **Step 2: Replace `get_branch_meta` execute to include form context**

Keep the tool name `get_branch_meta`. Update description and execute:

```ts
{
  name: "get_branch_meta",
  description:
    "获取分支元信息：name/字数，以及形态/章法摘要（是否分章、章名样例、continuationRules、章开闭边界、目录条数）。大纲与写手续写前应调用。",
  parameters: {
    type: "object",
    properties: {
      novelId: { type: "string", description: "小说 ID" },
      branchId: { type: "string", description: "分支 ID（主线为 main）" },
    },
    required: ["novelId", "branchId"],
  },
  execute: async (args, ctx) => {
    const userId = ctx.userId || "guest";
    const novelId = (ctx.novelId || args.novelId || "") as string;
    const branchId = (ctx.branchId || args.branchId || "main") as string;
    const { text, branch } = getBranchProse(userId, novelId, branchId);
    if (!branch) return { content: "分支不存在", messages: [] };

    const form = getNovelForm(userId, novelId);
    const chapterMeta = getBranchChapterMeta(userId, novelId, branchId);
    const formCtx = buildFormAgentContext({
      form,
      chapterMeta,
      novelId,
      branchId,
    });

    return {
      content: JSON.stringify(
        {
          name: branch.name,
          parent_offset: branch.parent_offset,
          novel_id: branch.novel_id,
          total_chars: text.length,
          form: formCtx,
        },
        null,
        2,
      ),
      messages: [],
    };
  },
},
```

- [ ] **Step 3: Append new tool `get_novel_form` to `branchTools` array**

```ts
{
  name: "get_novel_form",
  description:
    "获取小说形态/章法（骨）：formType、是否分章、章名 samples、continuationRules、分支章边界与目录摘要。大纲与写手在规划章节前应调用；弱分章时必须遵守 forbidInventChapterTitles。",
  parameters: {
    type: "object",
    properties: {
      novelId: { type: "string", description: "小说 ID" },
      branchId: { type: "string", description: "分支 ID（用于边界/目录；主线 main）" },
    },
    required: ["novelId", "branchId"],
  },
  execute: async (args, ctx) => {
    const userId = ctx.userId || "guest";
    const novelId = (ctx.novelId || args.novelId || "") as string;
    const branchId = (ctx.branchId || args.branchId || "main") as string;
    if (!novelId) {
      return {
        content: formatCriticalMiss("novelId", "缺少 novelId，无法读取形态分析。"),
        messages: [],
      };
    }
    const form = getNovelForm(userId, novelId);
    const chapterMeta = getBranchChapterMeta(userId, novelId, branchId);
    const formCtx = buildFormAgentContext({
      form,
      chapterMeta,
      novelId,
      branchId,
    });
    return {
      content: formatFormAgentContextForTool(formCtx),
      messages: [],
    };
  },
},
```

- [ ] **Step 4: Master allowlist + UI label**

In `src/app/api/agent/chat/route.ts`, extend `MASTER_TOOL_ALLOW`:

```ts
"get_branch_text", "get_branch_characters", "get_branch_timeline", "get_branch_world", "get_branch_meta",
"get_novel_form",
```

In `src/components/agent-panel.tsx` tool name map, add:

```ts
get_novel_form: "获取形态/章法",
```

- [ ] **Step 5: Smoke-check TypeScript**

Run: `npx tsc --noEmit`  
(or `npm run build` if that is the project’s typecheck path)

Expected: no errors in touched files.

- [ ] **Step 6: Commit**

```bash
git add src/core/agents/agents/branch-tools.ts src/app/api/agent/chat/route.ts src/components/agent-panel.tsx
git commit -m "feat(agents): get_novel_form tool and form-aware branch meta"
```

---

