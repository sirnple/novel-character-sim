# Spec A — Agent Panel 分支绑定 + 主线分支 + 子 agent tool-loop

## 背景

现状：`agent-panel` 给 `/api/agent/chat` 传 body 时把整段 `novelText`（可能几十万字）+ `characters` + `novelTitle` + `continueFromOffset`/`continueFromLabel` 全部 dump 进 `context`。后端主编 agent 和所有子 agent、所有 data tools 都直接从这个 `context` 读数据。

问题：续写本质上绑定分支，但 agent panel 完全没有分支概念。续写产出该绑哪个分支、IF 线怎么续、不同分支续写同一上下文怎么做——都缺位。

本次改造目标（Spec A）：

1. 主线在导入小说时即落库为一个真分支（id=`"main"`），分支表是续写唯一的上下文载体。
2. agent panel（指令链路 `/api/agent/chat`）只传 `branchId` + `novelId` 给后端，**不再 dump 正文/角色**。
3. 主编 + 所有子 agent 共享统一一套"分支查询工具"，按 `novelId` + `branchId` 双参自己查 DB（通过工具，不直接 import DB）。
4. 子 agent（outline/writer/review_*）改用 `chatWithTools` 跑 tool-loop，自行决定调哪个分支工具。

Spec B（独立）：writing-workspace 主线也存为分支、原 `novels.text` 不再权威。本 spec 不动 workspace 的保存链路；但 DB 层的 `main` 分支行约定必须和 Spec B 兼容。

## 架构

### 数据流（改后）

```
前端 agent-panel
   └─ POST /api/agent/chat  body: { messages, branchId, novelId }
       └─ 建主编对话 [{system: SYSTEM_PROMPT(含 branchId/novelId)}, ...messages]
          └─ llm.chatWithTools(对话, 统一分支工具集)
             └─ 主编 tool_use(agent=get_outline, prompt="续写 novelId=xxx branchId=main")
                └─ runAgent(get_outline, prompt)
                   └─ outlineAgent.execute({novelId, branchId, prompt}, llm, onChunk)
                      └─ outlineAgent 内部 chatWithTools(对话, 分支工具集)
                         └─ tool_use(get_branch_text, {novelId, branchId}) → 调工具 → DB → result
                         └─ tool_use(get_branch_characters, {novelId, branchId}) → 调工具 → DB → result
                         └─ 主编产出大纲文本 → 返回 content + messages trail
```

### 主编与子 agent 共享的"分支查询工具集"

全部按 **`novelId` + `branchId` 双参** 取语境（联合查规避同 id="main" 在多部小说的冲突）。工具内部从 `branches` 表用 `(novel_id, id, user_id)` 拿 `branch.text`，再用 `novel_id` 查 characters/timeline/storyInfo/worldBible。worldBible 来自 codex 构建或返回空。

- `get_branch_text(novelId, branchId)` → 该分支当前正文（合理截断最近若干字）
- `get_branch_characters(novelId, branchId)` → 角色档案（按 novel_id 查）
- `get_branch_timeline(novelId, branchId)` → 章节时间线（按 novel_id 查）
- `get_branch_world(novelId, branchId)` → 世界观设定（codex 或 storyInfo）
- `get_branch_meta(novelId, branchId)` → 分支元信息：name/parentOffset/novelId/总字数

**旧 data-tools 全部下线**：`get_novel_context`/`get_characters`/`get_timeline`/`get_codex`/`get_world_bible` 从 `init.ts` 注册删除、从 `data-tools.ts` 移除或归档。route 的 `buildToolSchemas` 只注册新分支工具集。主编和子 agent（含 outline/writer/review_*）全部只使用新分支工具集。

### 主线分支

约定：每部小说必有一行 `branches` 记录代表主线：
- `id = "main"`（不是 `main_${novelId}`；id 列固定字符串 `"main"`）
- `name = "主线"`、`parent_offset = 0`、`text = novels.text`、`novel_id` 指向所属小说。

PK 语义改变：`branches` 表当前 `PRIMARY KEY (id, user_id)` 在多部小说各自都叫 `main` 时会冲突。所有分支查询/保存改走 `(novel_id, id, user_id)` 联合查——即"查询/工具调用同时带 novelId + branchId"。导入小说入库时同步建 `main` 主线分支行。if 缺失（老数据），用 `ensureMainBranch(userId, novelId)` 兜底（Idempotent）。

## 组件改动清单

### `src/lib/db.ts`
- 新增 `ensureMainBranch(userId, novelId)`：SELECT branches WHERE `novel_id=? AND id='main' AND user_id=?`，无则 INSERT 一行（id=`"main"`、name=`主线`、text=novels.text、parent_offset=0）。
- 分支查询/保存函数从 PRIMARY KEY `(id, user_id)` 改为按 `(novel_id, id, user_id)` 联合查。`getBranch`/`appendBranchContent`/`saveBranch` 等签名相应增加 `novelId` 入参。现有调用点（branches route、writer/save route）同步改造——属于本 spec 范围内。
- `branches` 表的 `PRIMARY KEY` 是否改 schema？倾向**保留**现有 PK 但查询走 `(novel_id, id, user_id)`；避免迁移。但 PK 会让 id="main" 在不同 novel 间因 (id,user_id) 重复而插入失败。需在 plan 阶段裁决：要么改 schema 加 `novel_id` 进 PK，要么 PK 改 `(novel_id, id, user_id)`。

### 导入小说的 API
- 入库 novels 行后立即 `ensureMainBranch`。需定位导入路径（`novel/parse` 或 novel create 路由），在写入 novels 后调用。

### `src/core/agents/agents/branch-tools.ts`（新增）
- 5 个 `ToolDefinition`（上一节列出的）。
- 每个 execute 接 `args.novelId` + `args.branchId`、调 DB（通过已存在的 db 函数，签名改为联合查），不直接读 ctx 文本字段。
- 工具拿 `userId` 怎么办？ctx 引入 `userId` 字段（route 拿得到），工具用之查 DB。

### `src/core/agents/init.ts`
- 注册新分支查询工具替代旧 data-tools。

### `src/app/api/agent/chat/route.ts`
- `context` 改为 `{ branchId, novelId, userId }`，去掉 novelText/characters/continueFromOffset/continueFromLabel。
- `SYSTEM_PROMPT` 注入「当前分支 branchId=xxx, novelId=yyy」。
- `buildToolSchemas` 用新分支工具集。
- `runAgent` 传给 `execute` 的 ctx 精简为 `{ novelId, branchId, userId, prompt }`。
- 旧的 `runDataTool` 继续用——但调的是分支工具、按 args.novelId+branchId 查。主编调用时自行拼 novelId/branchId 到 args。

### `src/core/agents/types.ts`
- `ToolContext`/`AgentContext` 改为承 `{ novelId, branchId, userId, prompt }`（保留 prompt）。删除 novelText/characters/timeline/worldBible/continueFromOffset/continueFromLabel 这些字段。

### 子 agent 改 tool-loop（`outline.ts` / `writer.ts` / `review.ts`）
- **全部**子 agent（含 review_* ）统一改 tool-loop，全部用新分支工具集。
- `execute(ctx, llm)` 内部：
  - 组一个只有 system + user 的初始对话（system 用该 agent 既有 system prompt，user 用 ctx.prompt + 「novelId=xxx, branchId=yyy」信息）。
  - `chatWithTools(对话, 分支工具集)` 跑循环：
    - 收到 `tool_use` 事件 → 调对应工具 execute（同步把 novelId/branchId 带入 args）→ 把 tool_result 推回对话 → 继续 stream。
    - 收到 text_delta → onChunk 转发。
    - 收到 done / 无更多 tool_use → 退出。
  - 返回 final text + `messages` trail（完整对话，包括工具调用过程）。
- review agent 走同一 tool-loop：审查指南仍作为 system prompt，loop 中自调 `get_branch_text` 拿正文做对照；最终用 `chatWithTool` 收尾产出 JSON findings 或在 loop 末尾让 LLM 输出 JSON。倾向 loop 末双轨：tool-loop 取信息 + 一次 `chatWithTool` 拿结构化 JSON。

### 子 agent `chatWithTools` loop 实现
- 抽一个通用函数 `runToolLoop(llm, conversation, tools, onChunk)`：返回 final text + 完整 messages trail。主编 route 现有循环逻辑可作参考实现复用之（避免两边各写一遍）。位置：新文件 `src/core/agents/tool-loop.ts` 或挂在 types 旁。
- 主编 route 和子 agent 都用同一函数 → 消除重复。

### `src/components/agent-panel.tsx`
- `buildOutgoingMessages` body `context` 字段从 `{novelTitle, characters, novelText, continueFromOffset, continueFromLabel}` 改为 `{branchId, novelId}`。
- 新增 props `branchId?: string`, `novelId?: string`。

### `src/app/novel/[id]/layout.tsx`（或其下游 wrapper）
- 把 `activeBranchId`（write 页已管理）回写到 layout 层共享、或通过 novel-context 暴露 `activeBranchId`，传给 AgentPanel。
- 主线选中时传 `branchId = "main"`（+ `novelId`）。

### `src/app/novel/[id]/write/page.tsx`
- 选主线按钮也按"主线分支"处理（`activeBranchId = "main"`），不再走 null=主线的旧路径——保证 AgentPanel 总有非 null branchId。`sessionContinueLabel` 等照旧计算但 AgentPanel 不再消费。

## 数据流细节

- 主编第一次拿到对话：`[{system: SYSTEM_PROMPT ⊇ branchId/novelId}, ...history]`，调 `chatWithTools`。
- 主编根据用户指令选 agent，args.prompt 里包含 novelId+branchId（"续写 novelId=xxx branchId=main"）。
- `runAgent` 把 ctx（含 novelId+branchId）传给子 agent `execute`；子 agent 内 chatWithTools 自调 `get_branch_text(novelId, branchId)` 等。

## 错误处理

- 工具收到未知 branchId → execute 返回 `content: "分支不存在"` + messages: []，不抛异常（避免一次单条工具失败整轮崩）。
- `chatWithTools` 末轮 tool-call 解析失败的现有逻辑沿用（最近修的 `tool_call_id` 配对修复继续生效）。
- `ensureMainBranch` 失败 → API 直接 500（小说未入库属异常）。

## 未决 / 需在 plan 阶段定

1. **branches 表 PK 改不改**：现状 PK `(id, user_id)` 与多部小说各自 id="main" 冲突。倾向改 PK 为 `(novel_id, id, user_id)` 并加迁移；plan 决定。
2. **主编 route 的对话重建**：`buildOutgoingMessages` 修过 tool_call_id 配对，没动；与 ctx 简化无关、保持。
3. **worldBible 工具实现**：worldBible 不在 DB 表，是 codex 运行时构建。工具返回空 vs 拉 codex 构建——倾向返回空 + 注明"暂无"，避免在工具里塞 codex 重构。
4. **ensureMainBranch 的 userId**：guest 默认。多用户不在 scope 内、沿用现状。
5. **review agent 收尾 JSON**：loop 后用 `chatWithTool` 还是 loop 内直接产出。倾向 loop 后接 `chatWithTool`。
6. **tool-loop 失败降级**：子 agent 多轮调用失败时是否回退到现状的 single-shot 拼好 prompt 的方式。倾向不降级，失败就报错（YAGNI）。

## 测试

无自动化测试框架（package.json 无 test script）。本次以手动验证为主：

- 新建小说→确认 branches 表立即有 id=`"main"`（multi-novel 共存、按 novel_id 区分）的行。
- agent panel 选主线、说"续写"→主编读到 branchId/novelId、调 outline 子 agent、子 agent 在 prompt 卡片展示中能看到它调用了 `get_branch_text` 等工具。
- 旧小说（无 main 分支行）→ panel 触发 `ensureMainBranch` 兜底后续写通畅。
- `tsc --noEmit` 通过（已存 50 行错误照旧 baseline）。

## 范围外（留给 Spec B）

- writing-workspace `/api/simulation/stream` 保存改为全走分支表。
- `/api/writer/save` 保存逻辑改造。
- `novels.text` 是否完全退役由 Spec B 决定（本 spec 仍维护其作 main 分支的内容来源）。

## 风险

- 子 agent tool-loop 引入 LLM 多轮调用，成本/延迟/失败率上升。Plan 阶段考虑 max iterations、降级（loop 失败回落到现状 single-shot 的现拼 prompt）。
- DeepSeek `chatWithTools` 历史上有 tool_call 流式拼装脆弱点（最近修过）。子 agent 引入更多 loop 会放大脆弱面。
- 主线分支自动创建是 DB schema 之上的约定，没有迁移即用——但现有数据需在首次访问触发兜底切实生效。