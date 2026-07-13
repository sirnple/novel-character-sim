# Spec — 子 agent 通过工具存储互传中间数据

## 背景

Spec A 让子 agent（outline/writer/review_*）各自跑 tool-loop；主编通过 LLM 决定调度、把 prompt 传给子 agent、把子 agent 的 `tool_result` 当做传递给子 agent 的信息载体。

问题：
- 主编看到子 agent 的 `tool_result` 被 SSE 截到 5000 字后误判"工具返回不完整"，反复重调大纲 agent。
- 主编转发 `prose + 审查 findings` 给 write_prose 时，prompt 拼错或漏传 findings，下一轮 write 看不到审查结果。
- 审查 6 个 review_* 当前并行写在同一个 tool 卡上，互相覆盖。

根本原因：子 agent 之间的信息传递走"主编转发"路线，主编成为必经瓶颈，且每次转发都可被 LLM 误解 / SSE 截断。

## 改造目标

子 agent 的产出（大纲、prose、审查 findings）改用**工具存取**传递，主 agent 不再转发内容，只调度。

- 大纲 agent 写完 → 调 `save_outline` 工具把大纲存进进程内 cache（按 `novelId+branchId` 隔离），返回给主 agent 的 content 是 hint："大纲已生成，可用 get_outline 获取"。
- writer agent 开工 → 自调 `get_outline` 拿大纲；写完整段 prose 后调 `save_prose`。修改模式自调 `get_findings` 拿审查发现。
- review_* agent 跑完 → 调 `save_findings` 存入；content 返回 hint。
- 主 agent 系统 prompt 说明：写作后调 6 个 review_*，审查完成后再调 write_prose（让其改），调度只看 tool_result hint "done"。

## 架构

### 数据流（改后）

```
主 agent → get_branch_*（自取语境）
主 agent → agent(generate_outline)：
  outline agent 内部 chatWithTools → 必要时自取语境 → text_delta 产出大纲 →
  → tool_use(save_outline {novelId, branchId, content: 大纲正文}) →
  → 返回主 agent：{ content: "大纲已生成（已存储）。可用 get_outline 工具获取正文或直接进入写作。", messages: <trail> }
主 agent → 展示给用户，等用户回 "继续"
主 agent → agent(write_prose, prompt)：
  writer agent 内部 → tool_use(get_outline) → 拿到正文大纲 → 写正文 → tool_use(save_prose) → 返回 "正文已生成（已存储）。"
主 agent → 调 6 个 review_*（独立 tool 卡）：
  每个 review 内部 → tool_use(get_branch_text 取原文) → tool_use(get_prose 取待审) → 审查 → tool_use(save_findings) →
  → 返回 "{dimension}: N findings，已存储"
主 agent → 看完所有 hint → agent(write_prose, "按审查发现修改正文")：
  writer 内部 → tool_use(get_findings) → 拿 findings → 改 → tool_use(save_prose) → 返回 "正文已修改"
主 agent → 汇报用户
```

### 中间存储 `src/core/agents/intermediate-store.ts`（已初稿）

进程内 Map，按 `novelId::branchId` 隔离。提供：`saveOutline/getOutline`、`saveFindings/getFindings/clearFindings`、`saveProse/getProse`。**进程重启即丢失**（一次续写流程内足够）。

### 工具（新增到 branch-tools.ts 或单开文件）

加 `save_outline`、`get_outline`、`save_prose`、`get_prose`、`save_findings`、`get_findings`、`clear_findings` 七个工具。每个 execute 接 `ctx.novelId`/`ctx.branchId`（来自 `chat/route` 注入），互操作 `intermediate-store`。

## 组件改动清单

### `src/core/agents/agents/intermediate-tools.ts`（新增）

希望与 branch-tools 分开，存放这 7 个互操作工具（branch-tools 查 DB，互操作存内存 cache）。

### `src/core/agents/init.ts`
- 把 `intermediateTools` 一起注册。`buildToolSchemas` 覆盖主编能看到这些工具。

### `src/core/agents/agents/outline.ts`
- 用 `runToolLoop` 跑完后，**prompt 内置一条 system hint** 让 LLM 调 `save_outline`（参数 content=大纲正文）。
- `execute` 返回 content 改为：`"大纲已生成（已存储）。后续 writer 可用 get_outline 工具获取。大纲摘要：<前 200 字>..."`，让主 agent 能向用户转述要点。messages 仍返回 trail（前端 tool 卡展示用）。

### `src/core/agents/agents/writer.ts`
- 系统 prompt 指示 writer：
  - 写正文前，调用 `get_outline` 取大纲。
  - 修改模式（prompt 含"改"或"修复"）下，调用 `get_findings` 取要修的问题。
  - 写完 / 改完，必须调用 `save_prose` 工具存当前正文。
- `execute` content 返回 hint："正文已更新（已存储）。"

### `src/core/agents/agents/review.ts`
- 系统 prompt 指示：调用 `get_branch_text` / `get_prose` 取证；产出 findings 后必须调用 `save_findings`。
- `execute` content 返回 hint：`"{dimension}: {N} 个 finding（已存储），writer 可用 get_findings 获取"`。

### `src/app/api/agent/chat/route.ts`
- 删除 write_prose 内联的"自动审查 5 轮循环"（line 167-235 整段）。审查改为"先写后审再改"被主编显式调度。
- 主 agent 系统 prompt 加流程：`写作完成 → 调 6 个 review_* → 全部 done → 调 write_prose("按审查发现修改正文")`。
- runAgent 仍独立 toolCallId（已修）。

## 数据契约

- outline 工具入参：`{ content: string }`（大纲正文）。
- prose 工具入参：`{ content: string }`。
- findings 工具入参：`{ findings: [{dimension,severity,description,suggestion}...] }`，出参也同形。
- 所有工具都从 `ctx` 隐式取 `novelId` + `branchId`（route 注入）——但工具 schema 不要求 LLM 传 novelId/branchId，避免污染 LLM 输入；与 branch-tools 的双参约定不同（branch-tools 是给主 agent 显式跨分支查的；互操作只在本分支 scope 内、隐式绑定）。

## 错误处理

- `get_outline` 在还没存过时返回 content"大纲未生成"，writer 收到这一信号停止写并报错 hint。
- `get_findings` 无审查结果时返回空数组 JSON `[]`。
- `save_*` 任何失败由 tool execute 内 catch 转成 content 提示，不抛异常 crash 主流程。

## 测试（手动）

- 续写一遍：
  - tool 卡看到 outline agent 调用 `save_outline`。
  - 主 agent 收到 hint 不再重调大纲。
  - writer agent 看 tool 卡可见 `get_outline` + 产出 + `save_prose`。
  - 6 个 review_* 各自独立卡片、各自调 `get_branch_text` + `get_prose` + `save_findings`。
  - 第二次 write_prose 看到它调 `get_findings`，并基于 findings 修改。
  - `tsc --noEmit` 通过。

## 范围外

- DB schema 不动（中间数据不持久化）。
- 前端 tool 卡 UI 不动（继续按 messages trail 渲染，互操作工具会作为子消息 trail 内一条 user/tool 出现，自然渲染）。
- writing-workspace 的 `/api/simulation/stream` 继续 Spec B 已修，本 spec 不涉及。

## 风险

- LLM 不主动调 `save_outline` / `save_prose` / `save_findings`——靠 system prompt 强约束。如果 LLM 偶尔不调 save_outline，writer 的 `get_outline` 拿不到、报错。需要 prompt 写明"必须先 save_outline 再结束"。
- 内存 cache 在 hot-reload 重启 server 时丢，开发中若 server 重启导致丢失中途数据属正常。
- 主 agent prompt 可能仍重调大纲——需在 prompt 写明确："不要重调同工具除非 hint 明确报错"。已在原 prompt 加此条，可在 plan 保留。