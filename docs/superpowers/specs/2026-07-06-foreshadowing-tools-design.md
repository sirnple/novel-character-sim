# Foreshadowing Tools — 三层混合架构

**日期**: 2026-07-06
**状态**: 设计已确认，待实现

## 概述

大纲 Agent 和 Writer Agent 需要能够查询和更新伏笔账本，确保长篇小说的伏笔能够被正确埋入、推进和回收。

## 三层混合架构

| 层级 | 范围 | 方式 | 说明 |
|------|------|------|------|
| 1. Prompt 注入 | Writer 每轮创作时 | Codex 段 5 | 当前活跃伏笔列表直接注入提示词 |
| 2. API 查询工具 | Writer 需要精确查找时 | `foreshadowing_search(query)` | 语义检索特定伏笔 |
| 3. API 更新工具 | 任何 Agent 发现新的伏笔 | `foreshadowing_add / foreshadowing_update / foreshadowing_resolve` | CRUD 操作伏笔账本 |

## 工具定义

### `foreshadowing_search(query: string)`

语义搜索活跃伏笔。返回匹配的伏笔列表（id、描述、埋入章节、建议回收窗口、当前状态）。

### `foreshadowing_add(entry: NewForeshadowing)`

添加新伏笔。参数：type、description、plantedChapter、suggestedRevealWindow。

### `foreshadowing_update(id: string, patch: Partial<ForeshadowingEntry>)`

更新伏笔状态。例如将状态改为 "advancing"。

### `foreshadowing_resolve(id: string, revealedAt: string)`

标记伏笔已回收。

## 数据流

```
Writer/Outline Agent
  ├─ 写入前：Prompt 注入当前活跃伏笔列表（已有）
  ├─ 写入中：Agent 可调用 foreshadowing_search 查找特定伏笔
  ├─ 写入后：Agent 可调用 foreshadowing_add 注册新伏笔
  └─ 审查后：foreshadowing_resolve 标记已回收
```

## 实现

| 文件 | 作用 |
|------|------|
| `src/core/codex/foreshadowing.ts` | 伏笔 CRUD 工具实现 |
| `src/app/api/foreshadowing/route.ts` | REST API 端点 |
| `src/components/admin/foreshadowing-panel.tsx` | 管理页面伏笔面板 |

## 为什么不需要数据库

当前伏笔数据存储在内存中（Codex 对象内），随 session 持续。对于单个写作会话而言足够了。如果未来需要跨会话持久化，可以序列化到 `codex_data` 表。
