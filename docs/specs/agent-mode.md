# Agent Mode Design

## 架构

```
用户消息 → ReAct Loop (LLM 自主决策)
              ├─ 调 data tools (get_novel_context, get_characters)
              ├─ 调 agent tools (generate_outline, write_prose)
              └─ 回复文本给用户

write_prose 执行后 → 自动审查循环（硬编码）
                       ├─ 6 个 review agent **并行**执行
                       ├─ 汇总 findings → 发 summary chunk
                       ├─ 收敛判定 → 通过则结束
                       ├─ 停滞判定 → 连续 2 轮不减少则结束
                       └─ 否则 → write_prose 改写 → 重新审查
```

## 关键设计点

### 1. 审查并行

```typescript
// 之前：串行 ~30s
for (const rt of REVIEW_TYPES) {
  const r = await runAgent(rt, prose);
}

// 改为：并行 ~5s
const results = await Promise.all(
  REVIEW_TYPES.map(rt => runAgent(rt, prose))
);
// 汇总所有 results 的 findings
```

每个 review agent 独立审查同一段 prose 的不同维度，无依赖，天然可并行。

### 2. ReAct 循环

```typescript
while (maxSteps-- > 0) {
  for await (event of llm.chatWithTools(conversation, tools)) {
    if text_delta → sendChunk
    if tool_use   → 执行工具，结果塞回 conversation
  }
}
```

### 3. write_prose 特殊处理

LLM 调用 `agent(agent_type="write_prose", prompt="...")` 时：

```
runAgent("write_prose", prompt)
  ↓
自动审查循环:
  Promise.all([review_character, review_continuity, ..., review_pacing])
  → 汇总 findings
  → 收敛/停滞判断
  → 需要改: runAgent("write_prose", fixPrompt) → 重新审查
  → 通过: 结果塞回 conversation
```

### 4. System Prompt

```
你是小说创作主编。按以下流程工作：

续写流程:
1. 获取上下文: get_novel_context, get_characters
2. 规划大纲: agent(generate_outline)，prompt里放前文+角色+用户要求
3. 展示大纲，等待用户反馈（用户可要求修改）
4. 用户确认后: agent(write_prose)，prompt里放大纲+前文+角色
5. 写作后系统自动审查修改，完成后汇报

规则:
- 一次一个工具，prompt里放完整上下文
- 中文回复
```

### 5. 前端不变

SSE 协议: chunk, tool_chunk, tool_call, thinking, stopped
