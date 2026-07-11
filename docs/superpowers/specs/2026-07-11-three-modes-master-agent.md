# 三种创作模式 + 主编 Agent 设计

**Date:** 2026-07-11
**Status:** draft

## Problem

现在的流程是固定的：点小说 → 创建任务 → 大纲 → Writer → 审查。没有灵活的选择。

## Three Modes

### 主线创作
- 从小说**末尾**续写
- 不创建分支，直接 append 到 `novels.text`

### IF线创作
- 从小说**任意位置**分叉
- 固定续写点（点击位置确定），保存到 `branches` 表

### 自由创作
- **不固定续写点**，用户选中文本 → 发给主编 agent
- 保存到新 `drafts` 表（临时草稿，可升级为分支）
- 可以是一句话续写、段落改写、场景拓展

### Mode Selection

创建任务时选择模式：

```
┌─ 新建写作任务 ──────────────────┐
│ 续写点：第12章 · 偏移3421字      │
│ 上下文预览：...                 │
│                                 │
│ 模式：                          │
│ ○ 主线（从末尾续写）            │
│ ○ IF线（从此处分叉）            │
│ ○ 自由（选中即创作）            │
│                                 │
│ 任务名称：[____]               │
└─────────────────────────────────┘
```

## Master Agent

### 架构

右侧面板一个主编 agent 对话线程。主编 agent 是真正的 **tool-call 型 LLM**，根据用户意图自动决定调用哪些子 agent 或数据 tool。

### Tool 定义

**子 Agent 调用（8 个）：**

| Tool | 作用 |
|------|------|
| `generate_outline` | 生成/修改续写大纲 |
| `write_prose` | 根据大纲撰写正文 |
| `review_character` | 角色一致性审查 |
| `review_continuity` | 连贯性审查 |
| `review_foreshadowing` | 伏笔追踪 |
| `review_style` | 风格审查 |
| `review_world` | 世界观审查 |
| `review_pacing` | 节奏审查 |

**数据查询（5 个）：**

| Tool | 作用 |
|------|------|
| `get_novel_context` | 续写点之前的全文（或截断片段） |
| `get_characters` | 角色档案列表 |
| `get_timeline` | 前文章节摘要 |
| `get_codex` | 世界观 + 伏笔 + 风格指纹 |
| `get_world_bible` | 世界观详细设定 |

### UI

- 单线程对话，子 agent 调用结果以**可展开卡片**显示
- 卡片显示：tool 名称 + 运行状态 + 返回内容
- 子 agent 的 prompt 仍可通过右下角浮点查看
- 文本选择 → "发给助手 ▸" 按钮

## `drafts` Table

```sql
CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'guest',
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  parent_offset INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

## Files Changed

| File | Change |
|------|--------|
| `src/lib/db.ts` | Add `drafts` table + CRUD |
| `src/types/index.ts` | Add `Draft` type, `CreationMode` type |
| `src/components/writing-workspace.tsx` | Three-mode task creation, remove left panel, text selection |
| `src/components/agent-panel.tsx` | Rewrite as single master agent chat with tool cards |
| `src/app/api/agent/chat/route.ts` | Master agent with tool-call loop |
| `src/app/page.tsx` | Mode param wiring |
