# Agent 提示词管理页面

**日期**: 2026-07-04
**状态**: 已实现

## 概述

为小说角色模拟器添加一个独立的管理后台页面（`/admin`），允许查看和编辑所有 LLM Agent 的 System Prompt 和 User Prompt Template。

## 架构

```
/admin（独立页面，与主应用 step flow 解耦）
  ├── PasswordGate（密码验证弹窗）
  ├── AgentList（左侧 270px 侧栏，按 category 分组）
  └── PromptEditor（右侧编辑器）
      ├── System Prompt textarea
      ├── User Prompt Template textarea
      ├── 语言切换 (zh/en)
      ├── 变量提示
      └── 保存/重置按钮

API: /api/admin/auth      → POST 验证密码
API: /api/admin/prompts   → GET 列表/单个, PUT 保存, POST 重置

DB:  agent_prompts 表（SQLite）
     └── 仅存储用户修改过的提示词，未修改时使用硬编码默认值
```

## 数据模型

```sql
CREATE TABLE agent_prompts (
  agent_id   TEXT PRIMARY KEY,
  language   TEXT DEFAULT 'zh',
  name       TEXT NOT NULL,
  description TEXT,
  category   TEXT DEFAULT 'extraction',  -- extraction|simulation|review
  system_prompt         TEXT,            -- NULL = 使用硬编码默认
  user_prompt_template  TEXT,            -- NULL = 使用硬编码默认
  is_modified INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

## 13 个注册的 Agent

| agent_id | 名称 | 分类 |
|----------|------|------|
| `character_list` | 角色列表提取 (Pass 1) | extraction |
| `character_detail` | 角色详情提取 (Pass 2) | extraction |
| `relationships` | 关系网络提取 (Pass 3) | extraction |
| `chapter_end_states` | 末章状态提取 | extraction |
| `story_info` | 故事信息提取 | extraction |
| `timeline` | 时间线提取 | extraction |
| `outline_writer` | 剧本大纲编写器 | simulation |
| `director` | 导演/调度者 | simulation |
| `character_agent` | 角色扮演代理 | simulation |
| `recorder` | 记录者/叙事者 | simulation |
| `continuity_reviewer` | 连贯性审查员 | review |
| `character_reviewer` | 角色一致性审查员 | review |
| `literary_reviewer` | 文学品质审查员 | review |

## 权限控制

- 默认密码 `admin`，通过 `.env.local` 的 `ADMIN_PASSWORD` 覆盖
- 内存 session token，服务器重启后失效
- 前端存在 `sessionStorage`，页面刷新后需重新输入

## 提示词存储策略

- **渐进式迁移**：Agent 的提示词模板当前仍硬编码在源码中，运行时优先读数据库（`is_modified = 1`），未修改则走原始路径
- 模板变量使用 `{{变量名}}` 占位符语法
- 每个 Agent 的 `variables[]` 元数据记录了可用变量列表
- `system_prompt` 和 `user_prompt_template` 为 NULL 时表示使用默认值

## 视觉设计

- 暗色终端风格，搭配项目原有的橙色（`--primary: 24 95% 53%`）作为点缀
- 主应用亮色 / 管理后台暗色，形成清晰的"前台/后台"边界
- 等宽字体用于代码区和元数据，衬线字体用于中文描述
- 侧栏选中态用橙色左边框 + 微弱背景点亮指示
- 修改过的 Agent 在列表中以橙色圆点标记

## 涉及文件

| 文件 | 作用 |
|------|------|
| `src/core/prompts/registry.ts` | Agent 元数据注册表 |
| `src/core/prompts/admin-auth.ts` | 密码验证和 token 管理 |
| `src/lib/db.ts` | agent_prompts 表 + CRUD 函数 |
| `src/app/admin/page.tsx` | 管理页面 UI |
| `src/app/api/admin/auth/route.ts` | 认证 API |
| `src/app/api/admin/prompts/route.ts` | 提示词 CRUD API |
| `src/app/globals.css` | 暗色滚动条样式 |

## 未来扩展方向

- 修改历史记录
- 提示词版本对比 (diff)
- 测试按钮（直接用当前提示词调 LLM）
- Agent 运行时实际接入 PromptRegistry 替换硬编码提示词
