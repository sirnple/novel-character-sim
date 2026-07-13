# 子 agent 共享存储实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 子 agent 通过 save/get 工具与进程内 cache 互传大纲、prose、findings；主 agent 不再转发内容，只调度；删 write_prose 内联自动审查循环。

**Architecture:** 进程内 `intermediate-store.ts`（按 `novelId::branchId` 隔离）提供 outline/prose/findings 存取。新增 7 个工具注册到 init。outline/writer/review 子 agent 调用这些工具写入并返回 hint 给主 agent。chat/route 删自动审查循环、改 system prompt 为"先写后审再改"显式流程。

**Tech Stack:** TypeScript · Next.js 14 App Router · 进程内 Map（不持久化）· Node:assert 单元测试。

## 关键设计决策（Grill 产出）

| # | 决策 | 选择 |
|---|------|------|
| Q1 | save_outline 调时自动清同分支 store（prose+findings）| A — store.saveOutline 内置清逻辑 |
| Q2 | save_findings 按 dimension 覆盖（同维度再调替换旧批）| A — store.saveFindings 实现 |
| Q3 | get_outline 返回 "大纲未生成" 纯字符串信号 | B |
| Q4 | 6 个 review_* 主编串行调度 | A — LLM 每次一个 agent |
| Q5 | outline agent 不给摘要，content 仅 hint："大纲已生成，可用 get_outline 获取" | 不要摘要 |
| Q6 | 大纲由主编调 get_outline 后流式展示给用户（chat 主线）| A |
| Q7 | 审查完主编汇报问题数、等用户确认"改"再进 write_prose 修改 | C |
| Q8 | 主 agent maxSteps=3000 | 3000 |
| Q9 | system prompt 加"不要重调生成类 agent"规则 | A |
| Q10 | write_prose 模式切用 `[MODE:rewrite]` / `[MODE:create]` prompt 标签 | A |
| Q11 | 用户说"算了"不清 store，保留未决态可反悔 | A |
| Q12 | toolCallId 串行+LLM 唯一 id 够，不动 | A |
| Q13 | 前端 tool 卡 UI 不动 | A |
| Q14 | store 内对象数组、工具入参 string | A |
| Q15 | dimension 覆盖在 store.saveFindings 内实现 | A |
| Q16 | saveOutline 内部自动清 prose+findings | A |
| Q17 | 加 `scripts/test-shared-store.ts` 单测脚本 + npm script `test:store` | 新增 |
| Q18 | 主编审完调 get_findings 取全量汇总给用户 | A |
| Q19 | 主 agent "可用工具"区加 get_outline/get_prose/get_findings | A |

---

## File Structure

**新增**
- `src/core/agents/agents/intermediate-tools.ts` — 7 个互操作 ToolDefinition。

**已存在（commit a85b0ba 草稿）**
- `src/core/agents/intermediate-store.ts` — 已写过 save/get/saveProse/getProse/clearFindings 等助手。Plan Task 1 会复检与工具签名一致。

**修改**
- `src/core/agents/agents/branch-tools.ts` — 不动（保持 DB 工具，独立分支作用不混入互操作）。
- `src/core/agents/init.ts` — 注册 intermediateTools。
- `src/core/agents/agents/outline.ts` · `writer.ts` · `review.ts` — 改 system prompt 强约束 save_*；execute 返回 hint content。
- `src/app/api/agent/chat/route.ts` — 删 write_prose 内联审查循环；改 system prompt 包含新工具流程。

---

## Task 1: 补齐 intermediate-store (dimension 覆盖 + outline reset)

**Files:**
- Verify/Modify: `src/core/agents/intermediate-store.ts`

commit a85b0ba 已写了 store draft。需要补：

- `saveFindings` 按 dimension 覆盖（Q2/Q15 决定）：加入同 dimension 则 filter 旧条目、再 concat 新 batch。
- `saveOutline` 自动清同分支 prose+findings（Q1/Q16 决定）：第一步清 findings 数组、清 prose 为 undefined，再 set outline。

- [ ] **Step 1: 读 intermediate-store.ts 确认当前实现**

Run: `cat src/core/agents/intermediate-store.ts`

- [ ] **Step 2: 补 dimension 覆盖 + outline reset**

如 saveFindings 仍是纯 concat、补 filter。如 saveOutline 无双重清、补。

---

## Task 2: 新增 intermediate-tools.ts

**Files:**
- Create: `src/core/agents/agents/intermediate-tools.ts`

- [ ] **Step 1: 写工具文件**

```ts
import type { ToolDefinition } from "../types";
import {
  saveOutline, getOutline, saveProse, getProse,
  saveFindings, getFindings, clearFindings,
} from "../intermediate-store";

export const intermediateTools: ToolDefinition[] = [
  {
    name: "save_outline",
    description: "把生成好的大纲正文存起来供后续 write_prose 获取。生成大纲后必须调用一次，content 参数为大纲全文。",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "大纲正文（结构化文本）" },
      },
      required: ["content"],
    },
    execute: async (args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      saveOutline(novelId, branchId, args.content as string);
      return { content: `大纲已存（${(args.content as string).length} 字）。后续 writer 可用 get_outline 获取。`, messages: [] };
    },
  },
  {
    name: "get_outline",
    description: "获取已经存好的大纲正文。writer 写正文前必须先 get_outline 拿到轮廓。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      const o = getOutline(novelId, branchId);
      return { content: o ? (o as string) : "大纲未生成", messages: [] };
    },
  },
  {
    name: "save_prose",
    description: "把当前正文存起来供审查员读取。写完或改完一段正文后必须调用一次。content 参数为完整正文。",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "完整 prose 正文" },
      },
      required: ["content"],
    },
    execute: async (args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      saveProse(novelId, branchId, args.content as string);
      return { content: `正文已存（${(args.content as string).length} 字）。`, messages: [] };
    },
  },
  {
    name: "get_prose",
    description: "获取要被审/改的当前正文。审查员 review_* 与修改模式 writer 必读。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      const p = getProse(novelId, branchId);
      return { content: p || "正文未生成", messages: [] };
    },
  },
  {
    name: "save_findings",
    description: "把审查发现存起来供 writer 修改时参考。每个 review_* 完成后必须调用一次。findings 参数为 JSON 数组字符串。",
    parameters: {
      type: "object",
      properties: {
        dimension: { type: "string", description: "审查维度名（如 character / continuity）" },
        findings: { type: "string", description: "JSON 数组字符串：[{severity,description,suggestion}, ...]" },
      },
      required: ["dimension", "findings"],
    },
    execute: async (args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      let parsed: any[] = [];
      try { parsed = JSON.parse((args.findings as string) || "[]"); } catch { parsed = []; }
      saveFindings(novelId, branchId, parsed.map(f => ({
        dimension: args.dimension as string,
        severity: String(f.severity || "minor"),
        description: String(f.description || ""),
        suggestion: String(f.suggestion || ""),
      })));
      return { content: `${args.dimension}: ${parsed.length} findings 已存。`, messages: [] };
    },
  },
  {
    name: "get_findings",
    description: "获取所有审查维度的累积 findings。writer 修改模式必须先调它拿问题清单。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      return { content: JSON.stringify(getFindings(novelId, branchId), null, 2), messages: [] };
    },
  },
  {
    name: "clear_findings",
    description: "清空已存 findings。修改完成下次重审前可调一次。",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const novelId = (ctx as any).novelId as string;
      const branchId = (ctx as any).branchId as string;
      clearFindings(novelId, branchId);
      return { content: "已清空 findings。", messages: [] };
    },
  },
];
```

- [ ] **Step 2: type-check**

Run: `npx tsc --noEmit 2>&1 | grep "intermediate-tools" | head`
Expected: 无 error。

- [ ] **Step 3: commit**

```bash
git add src/core/agents/agents/intermediate-tools.ts
git commit -m "feat(agents): intermediate-tools (save/get outline/prose/findings)"
```

---

## Task 3: 注册 intermediateTools 到 init

**Files:**
- Modify: `src/core/agents/init.ts`

- [ ] **Step 1: 在 init.ts 加 import 与注册**

读过 init.ts（commit 历史里已见 branchTools 注册）。在文件顶部 import 区追加：

```ts
import { intermediateTools } from "./agents/intermediate-tools";
```

在 `for (const tool of branchTools) { register(tool); }` 之后追加：

```ts
  for (const tool of intermediateTools) {
    register(tool);
  }
```

- [ ] **Step 2: type-check**

Run: `npx tsc --noEmit 2>&1 | grep "init.ts" | head`
Expected: 无 error。

- [ ] **Step 3: commit**

```bash
git add src/core/agents/init.ts
git commit -m "feat(agents): register intermediate tools"
```

---

## Task 4: outline agent 改用 save_outline

**Files:**
- Modify: `src/core/agents/agents/outline.ts`

- [ ] **Step 1: 重写 outline.ts**

替换整文件：

```ts
import type { AgentDef } from "../types";
import { renderPrompt } from "@/core/prompts/renderer";
import { runSubAgentToolLoop } from "../tool-loop";
import { branchTools } from "./branch-tools";
import { intermediateTools } from "./intermediate-tools";

const TOOLS = [...branchTools, ...intermediateTools].map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

export const outlineAgent: AgentDef = {
  execute: async (ctx, llm, onChunk) => {
    const baseSys = renderPrompt("outline-system.md", {});
    const sys = `${baseSys}

## 输出契约（必读）
1. 你必须以完整的大纲正文结尾。
2. 输出大纲后必须**立刻调用 save_outline 工具**（content 参数为大纲全文）。不调 save_outline 视为未完成。
3. 这是产出大纲给后续 write_prose 用，writer 会单独 get_outline，不要把 bypass 路径走完就退。`;

    const uc = `${ctx.prompt}\n\n## 当前绑定分支\nnovelId=${ctx.novelId}, branchId=${ctx.branchId}\n\n如需前文/角色/时间线，请调用 get_branch_* 工具自取（参数 novelId 与 branchId 同上）。`;

    const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, TOOLS, ctx, onChunk);

    return {
      content: "大纲已生成（已存储）。writer 可用 get_outline 工具获取。",
      messages: trail,
    };
  },
};
```

- [ ] **Step 2: type-check**

Run: `npx tsc --noEmit 2>&1 | grep "outline.ts" | head`
Expected: 无 error。

- [ ] **Step 3: commit**

```bash
git add src/core/agents/agents/outline.ts
git commit -m "feat(outline): generate -> save_outline, return hint to master"
```

---

## Task 5: writer agent 改用 get_outline / get_prose / get_findings / save_prose

**Files:**
- Modify: `src/core/agents/agents/writer.ts`

- [ ] **Step 1: 重写 writer.ts**

替换整文件：

```ts
import type { AgentDef } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { branchTools } from "./branch-tools";
import { intermediateTools } from "./intermediate-tools";

const TOOLS = [...branchTools, ...intermediateTools].map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

export const writerAgent: AgentDef = {
  execute: async (ctx, llm, onChunk) => {
    const isRewrite = ctx.prompt.includes("[MODE:rewrite]");

    const modeBlock = isRewrite
      ? `## 修改模式
1. 调 get_prose 工具取当前正文（要被改）。
2. 调 get_findings 工具取审查发现的问题清单。
3. 基于问题清单精确修改正文：只改列出的问题，不动其它。
4. 改完**必须调用 save_prose 工具**保存修改后完整正文。`
      : `## 创作模式
1. 调 get_outline 工具取大纲。
2. 必要时调 get_branch_text / get_branch_characters 补充前文。
3. 按大纲创作完整正文。
4. 写完**必须调用 save_prose 工具**保存完整正文。`;

    const baseSys = `你是小说执行写手。
${modeBlock}

## 文风铁律
- 严格遵循大纲（创作模式）或问题清单（修改模式）
- 禁止编造大纲/清单里没有的事件、人物、道具
- 创造力用在文字表现：氛围感官、对话节奏、心理层次、动作画面
- 直接输出正文，不要"以下是续写"之类引导语`;

    const sys = `${baseSys}

## 输出契约（必读）
- 必须最终调用 save_prose 工具存入产出正文，content 参数为完整正文。不调 save_prose 视为未完成。`;

    const uc = `${ctx.prompt}\n\n## 当前绑定分支\nnovelId=${ctx.novelId}, branchId=${ctx.branchId}`;

    const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, TOOLS, ctx, onChunk);

    return {
      content: isRewrite ? "正文已按审查意见修改（已存储）。" : "正文已创建（已存储）。摘要：" + (finalText || "").slice(0, 200) + "...",
      messages: trail,
    };
  },
};
```

- [ ] **Step 2: type-check**

Run: `npx tsc --noEmit 2>&1 | grep "writer.ts" | head`
Expected: 无 error。

- [ ] **Step 3: commit**

```bash
git add src/core/agents/agents/writer.ts
git commit -m "feat(writer): get outline/findings, save_prose; mode-branch + hint return"
```

---

## Task 6: review agent 改用 get_prose / save_findings

**Files:**
- Modify: `src/core/agents/agents/review.ts`

- [ ] **Step 1: 重写 review.ts**

替换整文件：

```ts
import type { AgentDef } from "../types";
import { runSubAgentToolLoop } from "../tool-loop";
import { branchTools } from "./branch-tools";
import { intermediateTools } from "./intermediate-tools";

const TOOLS = [...branchTools, ...intermediateTools].map(t => ({
  name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown>,
}));

function makeReviewAgent(dimensionName: string, dimensionCode: string, guideline: string): AgentDef {
  return {
    execute: async (ctx, llm) => {
      const sys = `${guideline}

## 输出契约（必读）
1. 调 get_prose 工具取当前正文。
2. 必要时调 get_branch_text 工具取原文比对（审 character/continuity/world 必读）。
3. 用 JSON 数组汇总问题：[{severity, description, suggestion}, ...]。无问题返回 []。
4. **必须调用 save_findings 工具**（dimension="${dimensionCode}"，findings=JSON 数组字符串）。不调 save_findings 视为未完成。`;

      const uc = `${ctx.prompt}\n\n## 当前绑定分支\nnovelId=${ctx.novelId}, branchId=${ctx.branchId}\n\n请审查 get_prose 取到的正文，按维度 "${dimensionName}" 给出 findings。`;

      const { finalText, trail } = await runSubAgentToolLoop(llm, sys, uc, TOOLS, ctx);

      let count = 0;
      try { count = JSON.parse(finalText || "[]").length; } catch { count = 0; }

      return {
        content: `${dimensionName}: ${count} findings，已存储。writer 可用 get_findings 获取。`,
        messages: trail,
      };
    },
  };
}

export const reviewCharacterAgent = makeReviewAgent("角色一致性", "character", "你是角色一致性审查员。对照原文角色性格/说话方式，检查生成正文是否有偏离。");
export const reviewContinuityAgent = makeReviewAgent("连贯性", "continuity", "你是连贯性审查员。检查生成正文是否与原文事实矛盾。");
export const reviewForeshadowingAgent = makeReviewAgent("伏笔", "foreshadowing", "你是伏笔追踪审查员。检查伏笔是否被合理推进或回收。");
export const reviewStyleAgent = makeReviewAgent("风格", "style", "你是风格审查员。检查正文是否维持原文文风。");
export const reviewWorldAgent = makeReviewAgent("世界观", "world", "你是世界观审查员。检查正文是否与原文世界观一致。");
export const reviewPacingAgent = makeReviewAgent("节奏", "pacing", "你是节奏审查员。检查正文叙事节奏是否合理。");
```

注意 dimensionCode 跟 store 里 dimension 字符串对齐——review_ 前缀在主编 route 用枚举名（如 `review_character`），但 store 里存 dimension keyword（不带 review_）。Summary 仍按维度名显示；不带 review_ 的维度关键字。

- [ ] **Step 2: type-check**

Run: `npx tsc --noEmit 2>&1 | grep "review.ts" | head`
Expected: 无 error。

- [ ] **Step 3: commit**

```bash
git add src/core/agents/agents/review.ts
git commit -m "feat(review): get_prose + save_findings, return hint to master"
```

---

## Task 7: chat/route 删自动审查循环 + 改 system prompt

**Files:**
- Modify: `src/app/api/agent/chat/route.ts`

- [ ] **Step 1: 读当前文件**

Run: `cat src/app/api/agent/chat/route.ts`

定位：`if (agentType === "write_prose") { ... 审查循环 ... } else { ... }` 块（由早期 commit 已知结构）。当前状态可能含 7406f3a 修过的 rewrite 分支错误变量；不动它们、直接整块替换。

- [ ] **Step 2: 把 write_prose 分支改成普通分支**

把整个 `if (agentType === "write_prose") { ... } else { ... }` 替换为：

```ts
                // 任一 agent_type 都走同样路径：跑 runAgent 取 hint，写 tool_result
                const result = await runAgent(agentType, prompt, toolId);
                conversation.push({
                  role: "user",
                  content: [{ type: "tool_result", tool_use_id: toolId, content: result.content.slice(0, 5000) }],
                });
```

即删掉 `write_prose` 内联的 5 轮审查循环 + 自动 review，所有 agent_type 共用同一段——包括 write_prose、generate_outline、review_*。审查由主编显式调度。

- [ ] **Step 3: 改 system prompt 流程**

替换 sysPrompt 中的"续写流程"段为：

```ts
## 续写流程
1. 必要时调 get_branch_text / get_branch_characters 了解当前分支
2. 规划大纲: agent(agent_type="generate_outline")，prompt 里写用户要求 + 分支标识
3. 展示大纲给用户、等反馈。用户"改"重调、"写"/"继续"/"确认"进入下一步
4. 写正文: agent(agent_type="write_prose")，prompt 里写用户要求。writer 内部会自己 get_outline
5. 审查（顺序无所谓并行）：6 个 agent(agent_type="review_xxx")，每个 prompt 简单传"请审查":
   review_character, review_continuity, review_foreshadowing, review_style, review_world, review_pacing
6. 审查完毕后再调 agent(agent_type="write_prose")，prompt 含"按审查发现修改正文"。writer 内部会自己 get_findings
7. 汇报用户

## 重要
- 工具的 tool_result 是该子 agent 已经存好产出后给的 hint（如"大纲已存"、"N findings 已存"），不是产出本体——产出已存进程内，下一个子 agent 用工具自取。**不要因 tool_result 短就重调同工具**。
- 一次一个 agent。
- 子 agent 之间不要由你转发 prompt 里的具体内容（如大纲全文、prose 全文、findings 清单）——它们会自己调 get_* 工具取。让你的 agent prompt 简短（如"开始审查"、"按审查意见修改"即可）。
- 中文回复。
```

(系统 prompt 其余字段如"可用工具"区域不动；把上面整段流程嵌入 sysPrompt 模板字符串、替换原"续写流程"段。)

- [ ] **Step 4: 也要删掉未再使用的 REVIEW_TYPES 常量、checkAbort 在分支里**

REVIEW_TYPES 常量（line 17-20）现在不再被代码引用——保留无害但 clean 一点可以删。可删可不删。倾向保留供后续回溯，但加注释 deprecated？——简单删之。

Run: `grep -n "REVIEW_TYPES" src/app/api/agent/chat/route.ts`
Expected: 只剩定义、无引用。删定义几行。

- [ ] **Step 5: type-check**

Run: `npx tsc --noEmit 2>&1 | grep "api/agent/chat" | head`
Expected: 无 error。

- [ ] **Step 6: commit**

```bash
git add src/app/api/agent/chat/route.ts
git commit -m "feat(route): remove inline review loop; prompt sub-agents self-fetch via shared store"
```

---

## Task 8: manual 验证

**Files:**
- 无源码改动

- [ ] **Step 1: dev 3000 已起，在 agent panel 触发一次"续写"**

预期链路：
- generate_outline 子 agent card：对话记录里看到它调 `save_outline`。
- 主 chat 显示"大纲已生成（已存储）。摘要：..."。
- 让用户回"继续"，主编调 write_prose。
- write_prose 子 agent card：对话记录可见它调 `get_outline`，产生正文，调 `save_prose`。
- 主编反应后调用 6 个 review_*（按 prompt 流程）。每个 review_* card 可见调 `get_prose`、必要时 `get_branch_text`、调 `save_findings`。
- 主编再调 write_prose 改：可见 `get_findings` + 改 + `save_prose`。

把任何错的链贴回。

- [ ] **Step 2: tsc 总错数**

Run: `npx tsc --noEmit 2>&1 | grep "error TS" | wc -l`
Expected: 0。

---

## Self-Review

- **Spec 覆盖**：Task 1 store / Task 2 工具 / Task 3 注册 / Task 4 outline 写存 / Task 5 writer 取存 / Task 6 review 取存 / Task 7 主编流程 + 删循环 / Task 8 验证。spec §"组件改动清单" 7 项全覆盖。
- **Placeholder**：无 TBD/TODO；所有代码块完整。
- **类型一致**：所有 `(ctx as any).novelId` 因 ctx = ToolContext 已含 novelId（Spec A Task 4 改过）——其实可去掉 `as any`，但保留无害；倾向去免 lint warn？保留以匹配 branch-tools 已有的写法。如 tsc 报，回退去 `as any`。

## 附录 A：intermediate-store 补全模板

若 Task 1 校验发现导出缺失，用以下补全（来自 commit a85b0ba）：

- 确保 `saveOutline(novelId, branchId, outline)` 存 lambda
- `getOutline(novelId, branchId)` 返回 outline
- `saveProse` / `getProse`
- `saveFindings(novelId, branchId, findingsArr)` 追加；`getFindings(novelId, branchId)` 返回数组
- `clearFindings(novelId, branchId)`

commit a85b0ba 草稿应已含全部。