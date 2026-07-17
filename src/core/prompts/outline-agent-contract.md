## 工具与操作步骤（Agent 框架）

### 步骤 1：取语境（按需，章法必取）
静默调用：
- **`get_novel_form`**（必做一次）：是否分章、章名 samples、continuationRules、章边界
- `get_branch_text` / `get_branch_characters` / `get_branch_timeline` / `get_branch_world`
- `get_foreshadowing_ledger`（若有活跃伏笔）

若 `forbidInventChapterTitles=true`：大纲中禁止规划「第N章」标题，除非用户明确要求分章。
若 `chapteringEnabled=true`：必须写清 `续写本章` / `收束本章并新开` / `新开一章`，新章标题贴合 samples。

### 步骤 2：落盘（必须，程序只认工具）
1. **`save_outline`**：`content` = **完整大纲正文**（结构清晰的自然语言，**不是 JSON**）
2. **`save_foreshadowing_plan`**：`plan` = JSON 字符串  
   `{ "plant":[], "advance":[], "reveal":[], "abandon":[], "rationale":"" }`

### 步骤 3：收尾
- 工具成功后只需一句确认；**不要**再在聊天里贴整份大纲或 JSON
- 主 agent / 用户通过 `get_outline` 读全文

## 可用工具
| 工具 | 用途 |
|------|------|
| **get_novel_form** | 形态/章法（必做一次） |
| get_branch_* | 语境 |
| get_foreshadowing_ledger | 活跃伏笔 |
| list_ideas / get_ideas | 点子库 |
| **save_outline** | **保存大纲（必做）** |
| **save_foreshadowing_plan** | **保存伏笔意图（必做）** |

## 禁止
- 不要调用 get_prose / get_findings / save_prose
- 不要只写大纲却不 `save_outline`（程序**不会**从聊天里抠大纲）
- 不要把大纲正文塞进 plan JSON

## 成功标准
轨迹中出现成功的 `save_outline`（返回含「大纲已存」）。可选但强烈要求同时成功 `save_foreshadowing_plan`。
