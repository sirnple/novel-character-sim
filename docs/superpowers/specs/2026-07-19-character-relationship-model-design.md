# 人物关系模型：调研与设计

日期：2026-07-19  
范围：角色提取 / 关系图 / **续写注入** / 是否引入图数据库  
状态：**Grill 冻结已开干**（清库 + 格式器 + 大纲/Writer/审查注入；需重抽角色才有关系数据）

---

## 0. Grill 冻结决定（2026-07-19）

| # | 议题 | 决定 |
|---|---|---|
| 1 | 完成定义 | **B**：抽取+注入同一轮；图/卡片可弱但须最低可读 |
| 2 | 注入面 | **无导演**。P0 = **大纲 + Writer/成文 + 审查**（Codex/角色一致性等） |
| 3 | 注入策略 | **A**：一个格式器 + 三种 options |
| 4 | 回边 | **B**：出边 + 本边上 reverse 摘要；P0 不实时查对方 profile |
| 5 | 旧数据 | **D 加强**：原有 relationships **一律非法，直接删除**；无现网，不做兼容/version 门闩 |
| 6 | 判定就绪 | 因整库清空，**有新抽取边即注入**；无边则跳过关系块 |
| 7 | 删除时机 | **立即/上线时清空**，不保留旧 JSON |
| 8 | 截断 | **A**：大纲在场每角色 cap5 drama；Writer 在场 cap6 drama；审查不截断或 cap20、不按在场滤 |
| 9 | drama 序 | **A**：不对称 > 单向负/矛盾/工具或隐秘 > 冲突型 type > 其它单向 > 双向硬冲突 type > 其余 |
| 10 | 约束句 | **A**：大纲开、Writer 开、审查关 |
| 11 | type 展示 | **D**：按小说语言中文标签，否则英文 id |
| 12 | UI 本轮 | **B**：卡片 `→`+类型+对称性；图有向+箭头；不打磨编辑大礼包 |
| 13 | 类型枚举 | **B**：目录优先，否则 `other`，禁止任意自由串进库 |
| 14 | 证据锚点 | **A**：P0 不做 evidence |
| 15 | 人称 | **B**：全第三人称 `A→B`（主路径多角色上帝叙事） |
| 16 | 实现顺序 | **A**：先清库+有向抽存 → 再接线注入 |

**实现顺序细化**

1. 删除全部已存 `relationships`（及若有的关系专用缓存）  
2. 抽取/落库按有向+symmetry+类型目录（非法 type→other）  
3. UI 最低可读  
4. `formatRelationshipsForPrompt` + 大纲/Writer/审查接入

---

## 1. 问题陈述

当前产品里「关系」容易被做成：

- **一个扁平 type 标签**（朋友/恋人/敌人…）
- **无向镜像**（A、B 各贴同一段文案）
- 因而 **类型空间窄 → 边也少**
- **续写侧**即便已有 `relationships[]`，注入格式仍是扁平字符串，模型看不到单向/不对称/隐秘

用户目标：

1. 从专业角度定义「关系该怎么分、怎么存、怎么画」  
2. 判断 **图数据库是否必要**  
3. 明确 **有向关系如何注入续写**（大纲 / 导演 / 角色扮演 / Codex），使人际戏与一致性受益  

**原则：只改存储不改注入 = 续写几乎无感；注入规格必须写进本设计，再动手。**

---

## 2. 调研结论（学术 + 工程）

### 2.1 文学计算：Character Network 是什么

Labatut & Bost（*Extraction and Analysis of Fictional Character Networks*, ACM CSUR 2019 / arXiv:1907.02704）将 **character network** 定义为：

- **顶点** = 角色  
- **边** = 叙事中的 **interaction**（互动）

互动在文献里通常 **不是**「社会关系类型本体」，而是可抽取的 **证据层**，常见定义包括：

| 互动定义 | 含义 | 用途 |
|---|---|---|
| **Co-occurrence** | 同一叙事单元同现（章/场景/窗口） | 高召回、易自动化 |
| **Conversation** | 对话/对谁说话 | 比同现更「真互动」 |
| **Mention** | A 谈及 B | 有向，适合「单向关注」 |
| **Action** | A 对 B 施动 | 有向，小说特有 |
| **Affiliation** | 婚姻/亲属/同事等显式社会关系 | 语义层，接近「类型」 |

要点：

1. **先有「互动证据」图，再有「语义关系」标注**——二者不同层。  
2. 虚构网络往往是 **作者宏观编排** 的结果，不等于真实社会网络拓扑（不可假设必须「像 Facebook」）。  
3. 边可以是 **有权 / 有时序 / 动态** 的；静态一张总图是时间积分后的简化。

Moretti 等「distant reading」传统也把角色网络当作 **plot 的社交投影**：邻域 ≈ character-space 的社交面。

### 2.2 关系「怎么分」：不要只用一张 type 表

专业上应 **分层**，而不是把一切压进一个 enum：

#### 层 A — 证据层（Evidence / Interaction）

「发生过什么可验证的接触」

- 共现强度、对话、提及、动作  
- 可带 **时间锚点**（章节/offset）  
- 多为 **有向或无向边权**，类型可很粗（`interacts`）

#### 层 B — 结构/角色层（Structural / Institutional）

「在故事世界里的制度位置」

- 亲属（血亲/姻亲/收养）  
- 组织（同门/同军/同公司）  
- 契约（主仆、雇佣、师徒）  
- 阶层（上下级）

相对稳定，适合分类树。

#### 层 C — 情感/态度层（Affective / Attitudinal）— **通常有向**

「我对你怎么感觉 / 怎么用你」

- 爱、恨、惧、敬、愧、妒、信任、利用  
- 宜用 **valence + 强度**，而不是塞进「朋友/敌人」二选一  

暗恋 = **单向情感**，绝不是强制双向「恋人」。

#### 层 D — 叙事功能层（Narrative function）

「在情节机器里扮演什么」

- 盟友、对手、导师、诱惑者、背叛者、信息源…  
- 随情节弧变化，宜 **时序化**，不宜当唯一永久标签  

#### 层 E — 元属性（Meta）

对任意语义边可附加：

| 属性 | 取值直觉 |
|---|---|
| **Direction / Symmetry** | 单向 / 双向同类 / 不对称双向 |
| **Valence** | + / − / 矛盾 / 工具性 / 中性 |
| **Visibility** | 公开 / 私下 / 隐秘 / 混杂 |
| **Strength** | 弱联系 → 强羁绊 |
| **Temporal** | 过去 / 现在 / 演变中 |
| **Confidence** | 抽取置信度 |

### 2.3 对称性（核心专业点）

| 对称性 | 定义 | 存储 |
|---|---|---|
| **Unidirectional** | 只成立 A→B | 只在 A 的出边列表写一条 |
| **Bidirectional** | 同类互向 | A→B 与 B→A 类型相同（或明确 mutual） |
| **Asymmetric** | 双方都重要但类型不同 | A→B type₁，B→A type₂ + 各自描述 |

**错误**：把暗恋做成 undirected「恋人」并镜像粘贴到双方。

### 2.4 图数据库要不要？

#### 本产品的规模与查询

- 单本：角色约 **10²**，边约 **10²–10³**  
- 查询：邻接列表、按 type 过滤、力导向可视化、卡片展示  
- 不涉及：跨百万节点路径、全图社区发现生产级、实时推荐社交图  

#### 存储选项对比

| 方案 | 适合 | 不适合 |
|---|---|---|
| **JSON 嵌在角色上**（现状方向） | 按角色读档案、小图可视化 | 全局「两跳路径」、跨书统一本体查询 |
| **SQLite 边表** `edges(from,to,type,…)` | 过滤、统计、简单 path | 超大图算法 |
| **图数据库**（Neo4j 等） | 跨书世界观、复杂 path、图算法即服务 | 运维成本；对本产品当前规模 **过重** |

#### 结论（存储）

**现在不需要图数据库。**

- 图是 **领域模型**（有向边 + 属性），不是 **必须换存储引擎**。  
- 推荐演进：  
  1. **短期**：有向 `Relationship` 嵌在 `CharacterProfile`（已起步）+ 图 UI 按有向边画  
  2. **中期（可选）**：增加 `character_edges` SQLite 表做查询索引，JSON 仍可冗余一份便于读档案  
  3. **长期（仅当产品要跨书势力图 / 复杂 path / 多用户共享世界观图）**：再评估 Neo4j/等  

引入图库的代价：部署、备份、事务与现有 SQLite 双写、迁移。收益在当前规模 **接近零**。

---

## 3. 推荐数据模型（设计）

### 3.1 原则

1. **边默认有向**：`from → to`  
2. **类型分层**：结构 type ≠ 情感 valence  
3. **对称性一等公民**  
4. **证据可追溯**（可选但重要）：`evidenceSpans[]` / chapter anchors  
5. **时间可演进**（二期）：`asOfChapter` / `validFrom–validTo`  

### 3.2 建议的边结构（逻辑）

```text
CharacterEdge {
  id
  novelId
  fromCharacterId
  toCharacterId

  // 结构类型（有限枚举，可扩展）
  structuralType: family | lover | affair | ex | friend | sworn | comrade |
                   ally | colleague | superior-subordinate | mentor-student |
                   master-servant | patron | org | business | benefactor |
                   rival | enemy | captor | acquaintance | other

  symmetry: unidirectional | bidirectional | asymmetric
  reverseStructuralType?: …   // asymmetric 时

  valence?: positive | negative | ambivalent | instrumental | neutral
  reverseValence?: …
  visibility?: public | private | hidden | mixed
  strength?: 0..1

  // 文本（有向视角）
  descriptionFrom    // from 看 to
  descriptionTo?     // to 看 from（不对称/双向时）
  history
  dynamics

  // 证据（强烈建议二期做实）
  evidence: { unitIndex | chapterId | quote? }[]

  confidence?: 0..1
  source: extract | manual | merge
  updatedAt
}
```

角色档案上的 `relationships[]` = **以该角色为 from 的出边投影**（读模型），不是无向粘贴。

### 3.3 与「扁平标签」对照

| 旧思维 | 新思维 |
|---|---|
| 「他们是恋人」 | A→B type=lover, symmetry=bidirectional；或 A 暧昧单向而 B 无情 |
| 「他们是敌人」 | A→B enemy + valence=negative；可能 B→A 是 fear 或 captor 不对称 |
| 边少 | 扩大 **可建边条件**（有向互动）+ **类型可辨**（不必塞进 other） |

### 3.4 抽取流水线（设计）

```text
扫名 / 锚点
  → （可选）证据层：共现/对话边权
  → 语义层：有向边 + symmetry + structuralType + valence
  → 重要对深挖（共现上下文）
  → 写入「from 视角出边」；仅按 symmetry 写回边
```

Prompt 契约必须强制模型输出 **from/to/symmetry**，禁止默认 mirror。

### 3.5 UI（设计）

- 图：有向箭头；双向可用无箭头或双箭头；不对称显示 `type⇄reverseType`  
- 卡片：`A → B · 类型 · 单向|双向|不对称 · valence`  
- 筛选：按 structuralType；可加「仅单向」过滤器  

---

## 4. 续写注入设计（Writing Injection）

有向关系对续写的价值 **不是自动生效** 的：当前写作链路已消费 `relationships[]`，但格式过扁。本节规定 **注入契约**，作为后续实现依据。

### 4.1 现状消费点（代码地图）

**P0 注入面（Grill）：大纲 + Writer/成文 + 审查。无导演。**

| 模块 | 文件/函数 | 现状注入形态 |
|---|---|---|
| 大纲 | `outline-agent.ts` 等 | `name（type，dynamics）` |
| Writer / 成文 | `engine.ts` 等 | `name（type）：description` |
| 审查 / Codex | `codex/builder.ts`、`renderer.ts` | `type — description` / `relationshipStates` |
| （非 P0 门闩） | 旧 `simulation/types` 扮演/导演 | 可顺手换格式器 |

共性：**无 symmetry / reverseType / valence / visibility**；未区分有向；未优先冲突边。

### 4.2 设计目标

1. 续写模型能区分 **单向 / 双向 / 不对称**，避免把暗恋写成互恋。  
2. **只注入与当前任务相关的边**（在场角色、本章相关），控制 token。  
3. **优先可产生戏剧的边**（不对称、负效价、隐秘、控制/暧昧等）。  
4. 单一格式函数，避免各处各写一套字符串。

### 4.3 共享格式器（建议 API）

新增例如：`src/core/character/format-relationships-for-prompt.ts`（路径可调整，原则是 **一处实现、多处调用**）。

```ts
type FormatRelOpts = {
  zh?: boolean;
  /** 只保留对方名字/id 在此集合内的边（在场过滤） */
  presentNames?: Set<string> | string[];
  /** 最多几条（默认 6–8） */
  maxEdges?: number;
  /** 排序：冲突优先 / 强度优先 / 原序 */
  priority?: "drama" | "strength" | "as_is";
  /** 角色扮演：第一人称「你→对方」；导演/大纲：第三人称「A→B」 */
  voice?: "first_person" | "third_person";
  /** 是否附带简短行为约束句（见 4.5） */
  withConstraints?: boolean;
};

function formatRelationshipsForPrompt(
  profile: CharacterProfile,
  opts?: FormatRelOpts,
): string;
```

可选第二函数：场景级并集（导演用）

```ts
function formatSceneRelationshipBundle(
  present: CharacterProfile[],
  opts?: Omit<FormatRelOpts, "presentNames">,
): string;
```

### 4.4 推荐注入文案模板

#### 4.4.1 角色扮演 / 第一人称（`voice: first_person`）

每条出边一行或一块：

```text
## 你的人际关系（有向；勿擅自改成双向）
- 你 → 洛雪棠：暧昧（单向）| 情感:ambivalent | 可见:hidden
  你如何看她：…
  约束：尚未确认恋爱；勿写成公开情侣或对方必然同等回应。
- 你 → 唐兰嫣：战友（双向）| 情感:positive | 可见:public
  …
```

不对称时补充回边信息（若档案上有对方出边或本边 `reverseType`）：

```text
- 你 → 罗明：控制（不对称）| reverse:敌人
  你如何看他：…
  对方对你（摘要）：恨意/反抗…
```

#### 4.4.2 导演 / 大纲 / 第三人称（`voice: third_person`）

```text
## 在场人物关系（有向）
- 李志宇 → 洛雪棠：暧昧（单向，隐秘）— …
- 洛雪棠 → 李志宇：相识（若不存在出边则标注「无回边/未抽取」）
- 罗明 → 赵芷然：控制（不对称）⇄ 赵芷然 → 罗明：敌人
```

#### 4.4.3 Codex `relationshipStates`

由扁平：

```text
洛雪棠: lover — dynamics…
```

改为：

```text
洛雪棠: 你→TA 暧昧·单向·hidden | dynamics…
```

键仍可用对方名；值必须含 **方向 + symmetry**。

### 4.5 行为约束句（withConstraints）

由 symmetry / type / visibility **规则生成**，减少模型「补全成双向」：

| 条件 | 约束句（中文示例） |
|---|---|
| `unidirectional` | 此关系主要为你单方面；勿默认对方同等情感或义务。 |
| `asymmetric` | 双方不对等；行动与对话须体现权力/信息差。 |
| `visibility=hidden` 或 `private` | 勿在公开场合直接点破；可用潜台词。 |
| `type=affair` 且非 bidirectional | 勿写成已确认恋人/未婚夫妻。 |
| `type=captor` / 控制 | 被控方的恐惧、顺从或暗中反抗须可感。 |

约束句要 **短**（≤1 句），避免淹没正文指令。

### 4.6 过滤与排序

1. **在场过滤**：`presentNames` 有值时，只保留 `characterName ∈ present` 的出边。  
2. **drama 优先排序**（建议默认用于大纲/导演）：  
   - 不对称 > 单向负效价/隐秘 > 敌人/控制/暧昧 > 普通双向朋友  
   - 同档按 description 长度或 strength  
3. **maxEdges**：角色卡全量可放宽；场景注入建议 **6–8**；大纲全员列表可 **每角色 3–5**。  
4. **无边**：输出明确「（与在场角色无已抽取关系）」避免模型瞎编。

### 4.7 各调用点改造清单（P0）

| 调用点 | options 要点 |
|---|---|
| **大纲** | third_person；在场；cap **5**/角色；drama；**constraints 开** |
| **Writer/成文** | third_person；在场；cap **6**/角色；drama；**constraints 开** |
| **审查/Codex** | third_person；**不按在场滤**；cap **20** 或不截断；**constraints 关** |

**禁止**在调用点继续手写 `.map(r => type — description)`。  
人称：**全第三人称**（上帝叙事）。回边：仅用本边 reverse 字段（不查对方档案）。

### 4.8 续写收益与风险（设计层）

**收益**

- 人际戏：单相思、控制、隐瞒与当众表演分离  
- 一致性：审查/扮演时「是否 OOC 对待某人」有据  
- 大纲：节拍可挂在具体有向张力上  

**风险**

- 抽取把单向标成双向 → 续写错得更「自信」→ 抽取质量与注入同样重要  
- token 膨胀 → 必须在场过滤 + maxEdges  
- 旧数据无 `symmetry`：注入时默认 `bidirectional`（兼容旧镜像）并在文案中可不写「单向」字样，避免误伤  

### 4.9 验收标准（续写注入）

1. 同一角色对 A（单向暧昧）与 B（双向战友）在 prompt 中 **文案结构可区分**。  
2. 场景仅 3 人在场时，不注入与未在场角色的长关系列表。  
3. 导演/大纲 prompt 中至少能看到 **一条** 带「单向」或「不对称」字样的边（当数据存在时）。  
4. 单元测试：给定 fixture `CharacterProfile`，`formatRelationshipsForPrompt` 快照稳定。  

### 4.10 明确非目标（本阶段）

- 不因续写引入图数据库  
- 不在续写时现场再跑一轮 LLM 补全关系（只用已落库边）  
- 不自动把关系写成正文情节（只约束/提示模型）  

---

## 5. 与现状代码的差距

| 项 | 现状 | 目标 |
|---|---|---|
| 类型目录 | 已扩到约 21 类 | 保持为 **structuralType**，勿再当唯一语义 |
| 方向 | 已开始有向模型与 symmetry | 抽/展/存全链路一致；修 legacy mirror |
| valence/visibility | 字段已加 | 抽取与 UI、**续写注入**真正使用 |
| 续写注入 | 扁平 `type — description` | **§4 格式器 + 各调用点改造** |
| 证据层 | 有 unit 锚点，未单独成边 | 可先内嵌 evidence，不必先上图库 |
| 存储 | SQLite JSON | **够用**；边表可选，图库不推荐 |

---

## 6. 决策摘要

1. **关系怎么分**：分层（证据 / 结构 / 情感 / 叙事功能 / 元属性），**结构类型 + 有向对称性** 是骨架，不是更多扁平标签 alone。  
2. **单薄的专业含义**：缺方向与对称性、类型不可表达 → 模型拒绝建边或乱归 other；续写则只会演「双向贴纸」。  
3. **图数据库**：**当前阶段不需要**；把领域模型做成真图（有向属性边）即可。  
4. **续写**：有向模型 **能**优化续写，但必须按 **§4 注入规格** 改 prompt 拼装；只改库不改注入 ≈ 无感。  
5. **落地优先级**（以 §0 Grill 为准）：  
   - **P0-1**：清库旧关系 + 有向抽存  
   - **P0-2**：UI 最低可读  
   - **P0-3**：格式器 + 大纲/Writer/审查注入（§4 + §0）  
   - P1：valence/visibility 强化、入边交叉（可选 C）  
   - P2：evidence  
   - P3：边表；不用图库  

**实现顺序约定**：§0 第 16 条 — 先清库与抽存，再注入。

---

## 7. 参考

- Labatut, V., & Bost, X. (2019). *Extraction and Analysis of Fictional Character Networks: A Survey*. ACM Computing Surveys. arXiv:1907.02704  
- Moretti, F. 等关于 literary character networks / distant reading 的论述（character-system 的图投影）  
- 工程常识：小图邻接表 vs 图数据库选型（节点/边规模与查询模式）  
- 本仓库现状：`src/core/simulation/types.ts`、`engine.ts`、`outline-agent.ts`、`codex/builder.ts` 关系注入点
