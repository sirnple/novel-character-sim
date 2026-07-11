# 助手面板 — 统一 Agent 对话界面

**Date:** 2026-07-11
**Status:** draft

## Problem

Agent 交互是单向的：点按钮 → agent 生成 → 看结果。没有反馈循环。大纲 agent、Writer、审查 agent 各自独立，没有统一的对话入口。

## Goal

一个统一的"助手"面板，所有 agent 都是对话线程。人类可以作为创作搭档与任意 agent 对话、提反馈、迭代。

## Layout

右侧新增"助手" tab。中心阅读区只展示正文。if 线对比通过按钮弹窗。

```
┌─ 左栏 ───┬─ 中心（正文）──────┬─ 右栏 ──────────┐
│           │                    │ CODE | REVIEW | 助 │
│  写作大纲  │  原文 / 续写正文   │                   │
│           │                    │ ○ 大纲      ▸    │
│           │  [对比原文]  ←按钮  │ ○ Writer         │
│           │                    │ ○ 审查          │
│           │                    │                  │
│           │                    │ Agent: ...       │
│           │                    │ You: ...         │
│           │                    │ [输入]    [发送] │
└───────────┴────────────────────┴──────────────────┘
```

- 右栏 280px
- 中心只显示一种内容，对比用弹窗
- "对比原文"按钮仅在 prose 生成后出现

## Agent 线程

**大纲 Agent**：生成初稿 → 人类反馈 → 迭代修改 → 同步到左侧写作区
**Writer**：prose 生成 → 人类反馈改写
**审查 Agent**：审查结果 → 人类确认/驳回

## Data Model

```typescript
interface AgentThread {
  agentId: string;
  name: string;
  messages: { id, role, content, metadata? }[];
  status: "idle" | "generating";
}
```

## API

`POST /api/agent/chat` — SSE stream

## Files

| File | Change |
|------|--------|
| `src/app/page.tsx` | 右侧面板加 "助手" tab |
| `src/components/agent-panel.tsx` | 新建 |
| `src/app/api/agent/chat/route.ts` | 新建 |
| `src/core/agents/outline-chat.ts` | 新建 |
| `src/components/writing-workspace.tsx` | 对比改为弹窗，大纲同步 |

## Out of Scope

- 多轮对话记忆
- Agent 反问人类
- 同时多 agent 对话
- 历史持久化
