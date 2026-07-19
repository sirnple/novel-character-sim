# 全书分析：主 Agent + 域子 Agent 体系

**日期：** 2026-07-20  
**状态：** Spec（Grill 核心已冻结 2026-07-20；时间线域内算法后议）  
**范围：** UI「分析」整段 —— **故事/世界、章法、角色、时间线**（及可选文风/点子）—— 改为 **主分析 Agent 编排 + 域子 Agent**；Admin/md prompt 控制行为；工具查文与落盘。  
**前置：** 方案 A（角色先消解后计次）、有向关系模型（2026-07-19）、现有 `runModularExtract` 模块划分、`runSubAgentToolLoop` / outline 模式。  
**取代：** 初稿「仅角色主 Agent」表述；角色仍是最重子树，但是主 Agent 的一等公民模块之一。

---

## 0. 核心修正（相对初稿）

| 初稿 | 修正 |
|------|------|
| 主 Agent = `character_analysis`，只管角色 | 主 Agent = **`novel_analysis`（全书分析）**，编排全部分析域 |
| 子 Agent 只有 roster/detail/rels | 另有 **story/world、form、timeline** 等域级子 Agent；角色域内部再拆二级子 Agent |
| Job 直接调角色流水线 | Job/API 主要调 **主分析 Agent**；主 Agent 再调各域 |

---

## 1. 问题陈述

### 1.1 现状

`runModularExtract` 用 **程序并行/串行** 调多个函数式 LLM 模块：

| 模块 | 现状实现 | 问题 |
|------|----------|------|
| story | `StoryExtractor` chatWithTool | 难多轮查文；与 Admin prompt 绑定弱 |
| form（章法） | `analyzeNovelForm` | 章目录/单元切分影响 timeline |
| characters | async char job + 多段 LLM | 曾函数式；指代消解需真 agent |
| timeline | async timeline job | 依赖 form + 角色名 |
| style / ideas | 函数式提取 | 可挂主 Agent，P0 可选 |

用户目标：

1. **整个分析阶段**是 Agent 体系，不是硬编码 Promise 图。  
2. **一个主分析 Agent**，可调度：角色列表/详情/关系、**故事世界、时间线、章法** 等。  
3. 各阶段 **prompt 在 Admin**，工具查原文与落盘。  
4. 本文件为 **spec**（prompt 骨架 + 工具表），先 grill 再实现。

### 1.2 设计原则

1. **主 Agent 管编排与重试**；域子 Agent 管质量。  
2. **落盘只认工具**（`submit_*` / `finish_*`），聊天正文不是结果。  
3. **依赖显式化**：timeline 依赖 form（单元）与角色名；主 Agent prompt + 工具返回表达依赖，程序工具可 soft-fail 兜底。  
4. **角色身份**：surface → 消解实体 → 再计次（禁止字符串聚类当指代消解）。  
5. **与写作侧同构**：`registerAgent` + `runSubAgentToolLoop` + trail。  
6. **模块可跳过**：主 Agent 可根据 `modules[]` 或已有缓存跳过（工具 `get_analysis_status`）。

---

## 2. 总体架构

```
                         ┌──────────────────────────────────────┐
                         │   novel_analysis（全书分析主 Agent）    │
                         │   prompt: novel_analysis_master        │
                         │   工具: status / 调域子 agent / finish  │
                         └──────────────────┬───────────────────┘
            ┌───────────────┬───────────────┼───────────────┬───────────────┐
            ▼               ▼               ▼               ▼               ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐
     │ story_     │  │ form_      │  │ character_ │  │ timeline_  │  │ style /  │
     │ world      │  │ analysis   │  │ domain     │  │ analysis   │  │ ideas    │
     │ 故事·世界  │  │ 章法       │  │ 角色域     │  │ 时间线     │  │ （可选） │
     └────────────┘  └────────────┘  └─────┬──────┘  └────────────┘  └──────────┘
                                           │
                     ┌─────────────────────┼─────────────────────┐
                     ▼                     ▼                     ▼
              character_roster      character_detail    character_relationships
              名单+指代消解           详情                 有向关系
```

### 2.1 Agent 注册表

| 层级 | agentId | Admin 显示名 | 职责 |
|------|---------|--------------|------|
| **主** | `novel_analysis` | 全书分析主 Agent | 编排全分析；调域子 agent；最终确认完成 |
| 域 | `story_world` | 故事与世界分析 | 情节摘要、主线、世界观、章节概要等 `StoryInfo` |
| 工具（非 agent） | `run_form_analysis` | 章法 | 包装 `analyzeNovelForm` → catalog/units（G3） |
| 域 | `character_domain` | 角色域编排（可选薄壳） | 也可由主 Agent **直接**调三级角色子 agent（见 G1） |
| 三级 | `character_roster` | 角色名单与指代消解 | name/aliases/surfaces/role/brief |
| 三级 | `character_detail` | 角色详情 | profile 深字段 |
| 三级 | `character_relationships` | 角色关系网 | 有向边 |
| 域 | `timeline_analysis` | 时间线分析 | 章事件时间线、可选末章状态 |
| 域（P1） | `style_extract` / `idea_extract` | 文风 / 点子 | 保持现库表，agent 化可后置 |

**命名：** 主 Agent **不要**叫 `character_analysis`，避免与角色域混淆。

### 2.2 角色调度方式（**G1 已冻结：A 直调**）

| 方案 | 说明 | 决定 |
|------|------|------|
| **A. 主 Agent 直调三级** | `run_character_roster_agent` / detail / rels 挂在主 Agent 工具上 | **采用** — 更灵活，主 Agent 可只重跑详情、跳过关系等 |
| **B. 角色域壳 Agent** | 主 Agent 只调 `character_domain` | 不采用（除非日后主 prompt 过长再议） |

---

## 3. 依赖与默认顺序

与现 `runModularExtract` 对齐的 **推荐契约**（主 Agent 应遵循；程序工具可强制校验）：

```
1. ensure_text_ready              # workspace 挂 fullText
2. run_form_analysis（**工具**；要单元/目录时必跑）
3. run_story_world（可与 form 并行意图；实现上可先后）
4. run_character_pipeline
     scan_character_mentions → roster → frequency_gate → detail → relationships
5. run_timeline_*（**硬依赖章法结果**；域内怎么抽事件后议）
6. style / ideas（**P0 纳入**）
7. finish_novel_analysis
```

**硬依赖（工具层 enforce）：**

| 动作 | 前置 |
|------|------|
| **timeline** | **章法已成功**（form/units 就绪）；角色名列表按后议算法需要 |
| character detail/rels | roster（+ gate）已 kept |
| character roster | surface catalog 已建（扫名完成） |

**可并行（主 Agent 策略）：**

- `story_world` ∥ `form_analysis`（无数据依赖）  
- `style` ∥ `ideas` ∥ 角色扫名（P1）

程序 **不再** 在 HTTP 里写死 `Promise.all([story, form, charJob…])` 作为唯一编排；可由主 Agent 调工具触发同等并行（工具内 `Promise.all` 可选优化）。

---

## 4. 共享 Analysis Workspace

```ts
interface NovelAnalysisWorkspace {
  jobId?: string;
  userId: string;
  novelId: string;
  branchId: string;
  fullText: string;
  modules: ExtractModule[];      // 本次要跑的模块
  forceRefresh: boolean;

  // form
  form?: NovelFormProfile | null;
  units?: TextUnit[];             // 章/窗单元（扫名与 timeline 共用）

  // characters
  unitHits?: UnitNameHit[][];
  catalog?: SurfaceCatalog;
  entities?: ResolvedEntity[] | null;
  kept?: NameAggregate[] | null;
  profiles?: Map<string, Partial<CharacterProfile>>;
  relationships?: DirectedRel[];

  // story
  storyInfo?: StoryInfo | null;

  // timeline
  timeline?: ChapterTimeline | null;
  lastChapterStates?: CharacterChapterState[];

  // optional
  style?: WritingStyle | null;
  ideas?: IdeaLibraryEntry[];

  errors: { module: string; message: string }[];
  updatedAt: string;
}
```

Key：`userId::novelId::branchId`（P1 可加 jobId 防并发）。

---

## 5. 主分析 Agent（`novel_analysis`）

### 5.1 元数据

| 字段 | 值 |
|------|-----|
| agentId | `novel_analysis` |
| Admin 名 | 全书分析主 Agent |
| 模型 | analysis（可配置）；步骤多时 maxSteps ≥ 40 |
| 调用方 | `runModularExtract` / 分析 API / 未来 master `agent(novel_analysis)` |

### 5.2 System prompt 骨架

```markdown
你是「全书分析」主 Agent。目标：对当前小说完成用户要求的分析模块并落库。

## 分析域
1. 章法 form — 章节结构、切分单元（影响扫名与时间线）
2. 故事/世界 story_world — 情节、主线、世界观、章概要
3. 角色 — 名单指代消解、详情、有向关系（先消解后计次）
4. 时间线 timeline — 章事件轴（依赖章法单元与角色名）
5. （可选）文风、点子

## 原则
- 按 modules 与 get_analysis_status 跳过已完成且未 forceRefresh 的域
- 尊重依赖：timeline 前确保 form + 角色名；角色详情前确保名单
- 落盘只通过工具；不要用长回复代替 submit
- 子 agent 失败可重试一次并收紧任务说明
- 角色 name=真实姓名，封号进 aliases（如孙悟空 / 齐天大圣）

## 工具
get_analysis_status, ensure_text_ready,
run_form_analysis_agent, run_story_world_agent,
scan_character_mentions, run_character_roster_agent, apply_entity_frequency_gate,
run_character_detail_agent, run_character_relationships_agent,
run_timeline_analysis_agent,
（可选 run_style_agent / run_ideas_agent）
finish_novel_analysis

## 完成
所请求 modules 均已成功或显式 skipped（缓存）；finish 返回成功。
```

### 5.3 User prompt 骨架

```markdown
novelId={{novelId}} branchId={{branchId}}
modules={{modules}} forceRefresh={{forceRefresh}}
任务：{{prompt}}
（默认：按 modules 做完整分析。）
先 get_analysis_status，再按依赖调用域工具。
```

### 5.4 主 Agent 工具表

| 工具 | 类型 | 说明 |
|------|------|------|
| `get_analysis_status` | 读 | 各模块是否已有缓存/workspace 结果、依赖是否满足、errors |
| `ensure_text_ready` | 写 | 确认 fullText 已挂载 |
| `run_form_analysis` | **程序工具** | 包装 `analyzeNovelForm`；非重型子 agent（G3） |
| `run_story_world_agent` | 子 agent | 故事/世界 |
| `scan_character_mentions` | 程序/并行 | 分段扫名 + 建 catalog（P0 程序 map） |
| `run_character_roster_agent` | 子 agent | 名单消解 |
| `apply_entity_frequency_gate` | 程序 | 实体计次门槛 |
| `run_character_detail_agent` | 子 agent | args: focusNames / mode |
| `run_character_relationships_agent` | 子 agent | 关系 |
| `run_timeline_analysis_agent` | 子 agent | 时间线 |
| `run_style_agent` / `run_ideas_agent` | 子 agent | P1 |
| `get_kept_roster` | 读 | 角色 kept 摘要 |
| `finish_novel_analysis` | 写 | 校验 modules 完备 → 各 save_* 若尚未持久化则刷盘；OK：`全书分析已完成` |

**域内并行优化（P1）：** `run_phase1_parallel` 一次触发 form+story+name_scan，减少主 agent 步数。

---

## 6. 域子 Agent：故事与世界（`story_world`）

### 6.1 产出

对齐现 `StoryInfo` / `story_info` prompt：主线、摘要、世界观设定、重要章节概要等（以当前类型为准）。

### 6.2 System 骨架

```markdown
你是故事与世界分析 Agent。根据正文提炼故事信息与世界观，禁止无据扩写。

## 工具
list_text_units / get_unit_text / lookup_offset / get_novel_excerpt（代表性切片）
submit_story_world

## 必须
submit_story_world(story_json=...)
```

### 6.3 工具

| 工具 | 说明 |
|------|------|
| `list_text_units` | 若有 form catalog 则列章；否则固定窗 |
| `get_unit_text` | 按 unitIndex 取正文 |
| `get_novel_excerpt` | 兼容现 `buildNovelContext` 代表性节选 |
| `lookup_offset` | 精读 |
| `submit_story_world` | 写 workspace + 可选立即 `saveStoryInfo`；OK：`故事世界已存` |

### 6.4 Admin

- agentId：`story_world`（可自现 `story_info` 迁并）  
- 变量：prompt, novelId, novelContext（若预填节选）

---

## 7. 章法：工具包装（非重型子 Agent）

### 7.1 产出

`NovelFormProfile`、章节目录、单元切分；供扫名 units 与 **时间线** 共用。

### 7.2 G3 已冻结 — 包装成工具

现网 **`analyzeNovelForm()`** 足够简单 → **不做成多轮子 Agent**。

| 工具 | 说明 |
|------|------|
| `run_form_analysis` | args: `forceRefresh?`；内部 `analyzeNovelForm()` → workspace.form + `saveNovelForm` + 重建 `units`；OK：`章法已存` |
| `get_form_status` | 读：是否已有 catalog、unit 数 |

主 Agent 编排里调用 `run_form_analysis` 即可；Admin **不必**单独「章法子 Agent」prompt（除非以后重做）。

---

## 8. 角色域（三级子 Agent）

> 细节与初稿角色节一致，此处为在全书架构下的位置说明。完整字段/西游记约定见下。

### 8.1 程序步骤

| 步骤 | 执行者 |
|------|--------|
| `scan_character_mentions` | **程序并行** unit Flash（`character_names_unit` prompt） |
| `apply_entity_frequency_gate` | **程序**（消解后计次） |

### 8.2 `character_roster`（名单 + 指代消解）

| | |
|--|--|
| **name** | 真实姓名（孙悟空，非齐天大圣） |
| **aliases** | 封号/外号/简称 |
| **surfaces** | 计次用表面串全集 |
| **工具** | `list_surface_candidates`, `lookup_surface`, `lookup_offset`, `submit_character_roster` |
| **OK** | `角色名单已存` |
| **Admin** | 替代主路径上的 `character_list` / `character_entity_resolve` |

### 8.3 `character_detail`

| **工具** | `get_character_focus`, `build_character_context`, `lookup_surface`, `list_focus_queue`, `submit_character_detail` |
| **OK** | `角色详情已存` |
| **焦点** | 主 Agent 按 mentions 指定；可 hardCap |

### 8.4 `character_relationships`

| **工具** | `get_kept_roster`, `get_cooccurrence_pairs`, `build_relationship_context`, `get_relationship_type_catalog`, `submit_character_relationships` |
| **模型** | 有向边 + symmetry / valence / visibility（2026-07-19） |
| **OK** | `角色关系已存`（允许 `[]`） |

---

## 9. 域子 Agent：时间线（`timeline_analysis`）

### 9.1 产出

`ChapterTimeline`、可选 `CharacterChapterState`（末章状态）；对齐现 timeline job。

### 9.2 System 骨架

```markdown
你是时间线分析 Agent。按章/单元梳理事件顺序与因果，角色名须与名单一致。

## 前置
- 已有 units（章法）
- 已有角色名列表（kept 或 roster）

## 工具
list_text_units / get_unit_text / get_kept_roster /
submit_timeline_events / submit_chapter_end_states（可选）

## 必须
submit_timeline_events(timeline_json=...)
```

### 9.3 工具

| 工具 | 说明 |
|------|------|
| `list_text_units` | 章列表 |
| `get_unit_text` | 章正文（cap） |
| `get_kept_roster` | 合法角色名 |
| `submit_timeline_events` | saveTimeline；OK：`时间线已存` |
| `submit_chapter_end_states` | 可选末状态 |

### 9.4 时间线与章法的关系（**G2 已冻结依赖；域内算法后议**）

| 已定 | 说明 |
|------|------|
| **依赖** | 时间线分析 **依赖章法分析结果**（units / catalog）。章法未完成前，`run_timeline_*` 必须失败并提示先跑章法工具。 |
| **未定（后议）** | 拿到章法结果之后，时间线是同步多轮 agent、异步 job、还是分批 — **本轮不冻结**，实现角色/主 Agent 骨架时再开小节。 |

主 Agent 契约顺序保持：`run_form_analysis`（工具）→ … → `run_timeline_*`（接口先占位或薄封装）。

---

## 10. 文风 / 点子（**P0 纳入**，G7 已冻结）

| agentId | 工具 | 落盘 |
|---------|------|------|
| `style_extract` | excerpt + `submit_style` | upsertExtractedStyle |
| `idea_extract` | excerpt + `submit_ideas` | replaceExtractedIdeas |

主 Agent modules 默认含 style/ideas；可与 story/form 并行策略调度。

---

## 11. 工具总表（按域）

### 11.1 全局 / 主 Agent

`get_analysis_status` · `ensure_text_ready` · `finish_novel_analysis`  
`run_form_analysis_agent` · `run_story_world_agent` · `run_timeline_analysis_agent`  
`scan_character_mentions` · `run_character_roster_agent` · `apply_entity_frequency_gate`  
`run_character_detail_agent` · `run_character_relationships_agent`  
`get_kept_roster` ·（P1 `run_style_agent` / `run_ideas_agent` / `run_phase1_parallel`）

### 11.2 查文（多域共享）

`list_text_units` · `get_unit_text` · `get_text_slice` / `lookup_offset`  
`get_novel_excerpt` · `list_surface_candidates` · `lookup_surface`

### 11.3 落盘 submit

| 工具 | OK 标记 |
|------|---------|
| `submit_story_world` | 故事世界已存 |
| `submit_form_analysis` | 章法已存 |
| `submit_character_roster` | 角色名单已存 |
| `submit_character_detail` | 角色详情已存 |
| `submit_character_relationships` | 角色关系已存 |
| `submit_timeline_events` | 时间线已存 |
| `finish_novel_analysis` | 全书分析已完成 |

---

## 12. Admin / Prompt 文件规划

| agentId | 建议文件 | 主要变量 |
|---------|----------|----------|
| `novel_analysis` | `novel-analysis-master-system.md` + user | prompt, modules, novelId, branchId, forceRefresh |
| `story_world` | 自 `story-info-system.md` 演进 + user | prompt, novelId |
| `form_analysis` | `form-analysis-system.md` + user | prompt, novelId |
| `character_roster` | 自 entity-resolve 演进 | prompt, surfaceCount, unitCount |
| `character_detail` | `character-detail-system.md` 加工具契约 | focusNames, prompt |
| `character_relationships` | `relationships-system.md` 升格 | focusNames, prompt |
| `timeline_analysis` | 自 `timeline-system.md` 升格 | prompt, novelId |
| `character_names_unit` | 保持 unit 扫名 | unitLabel, unitText |

**废弃主路径：** `character_list`（Admin 标注：请用 roster / 主分析）。  
**合并：** `character_entity_resolve` → `character_roster`。

---

## 13. 与现系统的映射

| 现模块 | Agent 化后 |
|--------|------------|
| `runModularExtract` Phase1/2 | 主 Agent + 工具（过渡期可双轨） |
| `StoryExtractor` | `story_world` |
| `analyzeNovelForm` | `form_analysis`（先包装） |
| `startCharacterExtractJob` | 主 Agent 角色段 或 仍可 debug 直调角色工具链 |
| `startTimelineJob` | `timeline_analysis` 或 async 工具 |
| style/ideas extractors | P1 agent |

**UI：** 「分析」按钮 → 启动 analysis job → 跑 `novel_analysis`；进度展示主 Agent phase + 子 agent 名。

---

## 14. 实现分期

| 阶段 | 内容 |
|------|------|
| **PR0** | Workspace 广义化；`get_analysis_status`；文档与 Admin 注册名 |
| **PR1** | `character_roster` 真 agent + 查文（已有基础上收口命名） |
| **PR2** | `character_detail` / `character_relationships` agent |
| **PR3** | `story_world` agent + **`run_form_analysis` 工具包装** |
| **PR4** | 时间线：先保证依赖章法；**域内算法后开**（可暂包装现 job） |
| **PR5** | **`novel_analysis` 主 Agent**；`runModularExtract` 改为调主 Agent |
| **PR6** | style/ideas（P0）、并行、trail |

---

## 15. Grill 冻结板

### 15.1 已冻结

| # | 决定 |
|---|------|
| **范围** | 主 Agent = 全书分析：故事/世界、**章法（工具）**、角色、时间线、文风、点子 |
| **G1** | 主 Agent **直接**调角色三级子 agent（roster / detail / rels），无 domain 壳 |
| **G2** | 时间线 **依赖章法结果**；域内算法后议 |
| **G3** | 章法 = **`run_form_analysis` 工具包装**，非重型子 Agent |
| **G7** | style / ideas **进 P0** |
| **编排顺序** | **① 章法 → ② 角色 → ③ 故事∥时间线∥文风∥点子（互不依赖、并行）**；主 Agent 只组织 |
| 角色 | 消解真 agent + 查文；计次在消解后；name=真名 |
| 机制 | Admin/md prompt；落盘认工具 |

### 15.2 仍可后议（不挡主骨架）

| # | 议题 |
|---|------|
| 时间线域内 | 同步多轮 agent / 异步 job / 分批 — **后开** |
| G4 | story 与 form 是否并行工具 |
| G5 | 扫名 P0 程序 map（默认倾向是） |
| G6 | 域内 save vs 仅 finish |
| G8 | 主模型 Flash vs Pro |

---

## 16. 验收（Spec 级）

1. 主 Agent agentId 为 `novel_analysis`，Admin 可改其 prompt 影响编排话术/策略。  
2. 一次「完整分析」可依次（或并行策略下）产生 story、form、characters、timeline 四类落库结果（modules 全开时）。  
3. 角色路径：lookup 工具出现在 roster trail；计次日志在 roster submit 之后。  
4. timeline 在 form/角色未就绪时工具返回明确错误，而非静默空结果。  
5. 旧 `character_list` 不在主分析调用栈。

---

## 17. 附录：角色约定（西游记）

| name | aliases 示例 |
|------|----------------|
| 孙悟空 | 齐天大圣、美猴王、悟空、孙行者 |
| 猪八戒 | 天蓬元帅、猪悟能 |
| 沙悟净 | 卷帘大将、沙僧 |
| 陈玄奘 | 唐三藏、唐僧 |

---

## 18. 附录：主 Agent 伪代码

```ts
// runModularExtract / analysis job
beginNovelAnalysisWorkspace({ fullText, modules, forceRefresh })
const agent = getAgent("novel_analysis")
const r = await agent.execute({
  prompt: "按 modules 完成全书分析",
  novelId, branchId, userId,
}, llm)
// expect finish_novel_analysis OK
```

---

**下一步：** 确认 §15 Grill（尤其 G1/G2/G3）→ 按 §14 从 PR1 角色名单 agent 收口，PR5 再挂主 Agent。  
**本文档为 spec，不含实现代码。**
