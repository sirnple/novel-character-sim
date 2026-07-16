# Spec — 分支级伏笔账本（Foreshadowing Ledger）

**日期**: 2026-07-16  
**状态**: 关键决策已收口（**仍不实现**，设计定稿）  
**取代**: `2026-07-06-foreshadowing-tools-design.md` 中「Agent 随意 CRUD + 仅内存」的路线

---

## 1. 问题

长篇续写需要跨轮次记住：

- 埋了哪些伏笔
- 哪些推进到一半
- 哪些已回收、可不再催
- 哪些是主线必收、哪些可弃

现状：

| 路径 | 伏笔行为 |
|------|----------|
| 旧 Codex / simulation | 有 `foreshadowingLedger` + `updateCodexAfterChapter`，**未接到当前 Agent 主链路** |
| Agent 续写（outline → write → review） | `review_foreshadowing` 只出 **findings**，**无持久账本** |
| `save_prose` | 中间稿进 **进程内存 store**，**不是**用户接受正文 |
| `POST /api/writer/save` / 分支 append | 用户把续写**落到分支正文** |

用户明确区分：

> 账本更新时机 = **用户确认把续写落到正文（接受续写）**  
> **不是** writer 调用 `save_prose`。

---

## 2. 已确认决策

| # | 决策 | 选择 |
|---|------|------|
| D1 | 归属 | **按分支** `(userId, novelId, branchId)` 一份账本 |
| D2 | 更新时机 | **用户「接受续写」写入分支正文之后**（非 `save_prose`） |
| D3 | 条目字段 | 描述+状态、类型+回收窗口、埋入锚点、重要度/必收、关联实体 |
| D4 | 职责分工 | **大纲决策埋/收 → 写手执行 → 伏笔审查验 diff → 用户决定是否接受** |
| D5 | 本期交付 | **只出设计文档，不定实现** |
| D6 | Accept 入口 | **产品要加明确的「接受续写」动作**（见 §8.3） |
| D7 | Commit 真相源 | **以最终正文「实际落实」为准**，不是盲信 plan。落定仍在 **Accept 之后** |
| D7b | 审查 vs 落定 | **审查** = 对照 plan 验正文，并产出 **realized 结算单**；**不写账本**。未通过 → **rewrite 直到通过**；用户声明可不全落实 → 允许 Accept，仍按 realized 记账 |
| D8 | plan 外新坑 | 进 realized / findings；Accept 时 **按 realized 入库**（若审查认定正文确有新埋） |
| D9 | 导入冷启动 | **空账本**；以后可选提取 |
| D10 | 多轮 rewrite | **新大纲覆盖 plan**；accept 用最终 plan + 最终正文 |
| D11 | 章节号 | **弱化 chapter 数字**，用锚点文案 / 偏移即可 |

---

## 3. 目标与非目标

### 目标

1. 每条分支有一份可跨会话持久的伏笔账本。  
2. 大纲可读「活跃 / 必收 / 建议窗口」并产出本轮 **plan**（plant / advance / reveal / abandon）。  
3. 写手按 plan 写，不直接改账本。  
4. 伏笔审查对照 **plan vs 成稿**，出 findings，**不直接写账本**。  
5. **仅在用户接受正文落库后** commit 账本；commit 内容 = **最终正文实际落实的结算（realized）**，不是原 plan 原文。

### 非目标（本期）

- 不做语义搜索伏笔工具（旧稿的 `foreshadowing_search`）。  
- 不做完整后台 UI 编辑器（可后续；设计预留人改接口）。  
- 不与旧 simulation Codex 强绑定；可共享类型，但存储按分支独立。  
- 不在 `save_prose` 时改账本。  
- 不自动从全书首次导入时全量挖伏笔（可选 Phase 2）。

---

## 4. 核心概念

### 4.1 两层数据

```
┌─────────────────────────────────────────────────────────┐
│  持久层（SQLite）                                         │
│  foreshadowing_ledger @ (userId, novelId, branchId)      │
│  = 该分支「已接受正文」对应的真相源                         │
└─────────────────────────────────────────────────────────┘
                         ▲
                         │ commit（用户接受续写之后）
                         │
┌─────────────────────────────────────────────────────────┐
│  会话层（中间 store，可随 process 丢）                      │
│  本轮 outline plan：plant[] / advance[] / reveal[] / …   │
│  本轮 prose 草稿（save_prose）                             │
│  本轮 review findings（含伏笔维）                           │
└─────────────────────────────────────────────────────────┘
```

### 4.2 三层对象（勿混）

| 对象 | 含义 | 何时产生 | 写持久账本？ |
|------|------|----------|--------------|
| **plan** | 大纲意图：本轮想埋/想收 | 大纲结束 | 否 |
| **realized** | 审查对照正文后的**实际落实结算** | 每次伏笔审查结束 | 否（中间 store） |
| **ledger** | 已接受历史上的真相 | **Accept 之后**用最终 realized 更新 | 是 |

**plan ≠ 账本。** 写手可能漏写、多写；用户也可能批准「本轮不全落实」。  
账本永远跟 **最终被接受的正文实际做到了什么** 对齐。

### 4.3 生命周期（单次续写）

```
1. 大纲 → save plan（意图）
2. 写手 → save_prose（草稿）
3. 伏笔审查 →
     - 对照 plan + 正文
     - 出 findings（给用户/写手看）
     - 出 realized 结算单（正文里实际 plant/advance/reveal 了啥、
       plan 里哪些未落实、正文里多出来的新埋）
     - 判定 pass / fail（相对 plan 的完成度；见下）
     - 不写 ledger

4. 分支：
   A. 审查 fail（未按要求落实，且用户未豁免）
      → rewrite → 再审 → 直到 pass
   B. 审查 pass
      → 用户可点「接受续写」
   C. 用户明确「可以不全落实 / 豁免」
      → 允许 Accept（即使相对 plan 为 fail）
      → 仍用当前 realized 记账，绝不用完整 plan 假装全做到了

5. Accept
   - 正文写入 branch
   - commit ledger ← 应用【最终 realized】，不是 plan
```

**审查 pass 建议定义（实现可调）：**

- plan 中所有 `mustResolve` / 本轮必做 reveal、必做 plant **均在正文可识别落地**；或  
- findings 中无 `critical`/`major` 级「plan 未落实」类问题。  
- `optional` 未落实可不挡 pass。

**用户豁免：** UI 上显式选项，例如「接受（以正文实际落实为准，不要求 plan 全满）」。  
豁免 ≠ 按 plan 全量 commit；豁免 = **允许在 fail 时仍 Accept**，commit 仍是 realized。

### 4.4 关键边界（必须写进实现约束）

| 事件 | 改中间 store | 改持久账本 | 改 branch.text |
|------|--------------|------------|----------------|
| `save_outline` / plan | ✓ | ✗ | ✗ |
| `save_prose` | ✓ 草稿 | ✗ | ✗ |
| 伏笔审查 | ✓ findings + **realized** | ✗ | ✗ |
| **Accept（默认需 pass 或用户豁免）** | 可清草稿 | **✓ 按 realized commit** | **✓** |
| 丢弃草稿 | 清草稿/plan/realized | ✗ | ✗ |

产品必须有独立 **「接受续写」**（见 §8.3）。  
`save_prose` 完成 ≠ 接受；审查完成 ≠ 落定；**只有 Accept 才落定正文 + 账本**。

---

## 5. 领域模型

### 5.1 伏笔条目 `ForeshadowingItem`

```ts
type ForeshadowStatus =
  | "pending"      // 已埋，尚未明显推进
  | "advancing"    // 有推进但未回收
  | "revealed"     // 已回收（进入 history）
  | "abandoned";   // 明确放弃

type ForeshadowType =
  | "plot" | "character" | "world"
  | "relationship" | "mystery" | "theme";

type ForeshadowImportance = "must" | "should" | "optional";

interface ForeshadowAnchor {
  /** 埋入时的分支字数偏移或章节提示，允许粗糙 */
  note: string;                 // 如「第3次续写末 / 茶馆对峙后」
  excerpt?: string;             // 正文锚点摘录 ≤200 字
  charOffsetApprox?: number;    // 可选，接受时 branch 总长
}

interface ForeshadowEntityRef {
  kind: "character" | "item" | "location" | "other";
  name: string;
}

interface ForeshadowingItem {
  id: string;                   // 稳定 id，uuid 或 fs_xxx
  description: string;          // 一句话：埋了什么、读者应感到什么
  type: ForeshadowType;
  status: ForeshadowStatus;
  importance: ForeshadowImportance;
  mustResolve: boolean;         // true ≈ 主线必收（可与 importance=must 对齐）
  suggestedRevealWindow: string;// 自由文本：「3–5 次续写内」「打脸章前」
  plantedAt: string;            // ISO 或可读标签
  plantedAnchor: ForeshadowAnchor;
  related: ForeshadowEntityRef[];
  lastAdvancedAt?: string;
  revealedAt?: string;
  revealAnchor?: ForeshadowAnchor;
  abandonedReason?: string;
  notes?: string;               // 大纲备注
}
```

### 5.2 账本 `ForeshadowingLedger`

```ts
interface ForeshadowingLedger {
  userId: string;
  novelId: string;
  branchId: string;
  version: number;              // 乐观并发 / 调试
  active: ForeshadowingItem[];  // pending | advancing
  history: ForeshadowingItem[]; // revealed | abandoned（可截断保留最近 N 条）
  updatedAt: string;
}
```

**分叉行为（D1）**：

- 从 main 新建 branch 时：可选 **深拷贝** 当时 main 的 ledger 到新 branchId。  
- 之后两支独立 commit，互不影响。  
- **不要** 全局共享一份账本。

### 5.3 本轮计划 `ForeshadowingPlan`（会话层 · 意图）

```ts
interface ForeshadowingPlan {
  novelId: string;
  branchId: string;
  createdAt: string;
  source: "outline";
  plant: Array<{
    tempId?: string;
    description: string;
    type: ForeshadowType;
    importance: ForeshadowImportance;
    mustResolve: boolean;
    suggestedRevealWindow: string;
    related?: ForeshadowEntityRef[];
  }>;
  advance: Array<{ id: string; how: string }>;
  reveal: Array<{ id: string; how: string }>;
  abandon: Array<{ id: string; reason: string }>;
  rationale?: string;
}
```

### 5.4 实际落实结算 `ForeshadowingRealization`（会话层 · 审查产出）

伏笔审查在**每次**审查结束时写入（覆盖上一次）。Accept 只读**最后一次**。

```ts
interface ForeshadowingRealization {
  novelId: string;
  branchId: string;
  reviewedAt: string;
  proseFingerprint?: string;    // 可选：对应哪版草稿，防张冠李戴
  pass: boolean;                // 相对 plan 是否达到通过线
  findings: Array<{
    severity: "critical" | "major" | "minor";
    code?: string;              // 如 plan_reveal_missing
    description: string;
    suggestion?: string;
  }>;
  /** 正文里实际做到的 —— commit 的唯一输入 */
  realized: {
    planted: Array<{
      tempId?: string;          // 对上 plan.plant 则复用
      description: string;
      type: ForeshadowType;
      importance?: ForeshadowImportance;
      mustResolve?: boolean;
      suggestedRevealWindow?: string;
      related?: ForeshadowEntityRef[];
      anchor: ForeshadowAnchor; // 必须能指回正文
    }>;
    advanced: Array<{ id: string; how: string; anchor?: ForeshadowAnchor }>;
    revealed: Array<{ id: string; how: string; anchor?: ForeshadowAnchor }>;
    abandoned: Array<{ id: string; reason: string }>; // 仅当正文/用户明确放弃
  };
  /** 相对 plan 的差额，供 UI / rewrite */
  gaps: {
    planNotRealized: Array<{ kind: "plant" | "advance" | "reveal"; ref: string; note: string }>;
    realizedNotInPlan: Array<{ kind: string; note: string }>; // 多出来的，可进 planted
  };
}
```

### 5.5 Commit 结果

```ts
interface ForeshadowCommitResult {
  applied: {
    planted: string[];
    advanced: string[];
    revealed: string[];
    abandoned: string[];
  };
  source: "realization";        // 固定：禁止 source:"plan"
  ledgerVersion: number;
  /** Accept 时若无 realization 或 prose 已变且未再审 → 拒绝 Accept */
  error?: string;
}
```

---

## 6. 角色职责（D4）

| 角色 | 读 | 写 | 禁止 |
|------|----|----|------|
| **大纲** | ledger | **plan** | 改 ledger；写 prose |
| **写手** | ledger + plan | prose | 改 ledger；改 plan |
| **伏笔审查** | ledger + plan + prose | **findings + realized** | 改持久 ledger |
| **系统 Accept** | **最终 realized** + 正文 | **commit ledger + 写 branch** | 用 plan 顶替 realized |
| **用户** | findings / realized 摘要 | 决定 rewrite / 豁免 / Accept | — |

伏笔审查职责（校验 + 结算，仍不落库）：

1. 对照 plan：该收的是否在正文出现、该埋的是否埋下  
2. 产出 **realized**：正文里**实际** plant / advance / reveal  
3. 产出 **gaps**：plan 未落实项、正文多出项  
4. 设 **pass/fail**（给 UI 闸门）  
5. findings 供 rewrite；**不**在审查时改 ledger  

---

## 6.5 审查、通过、接受、落定（澄清）

容易混的四步：

| 步骤 | 做什么 | 账本？ |
|------|--------|--------|
| **审查** | 校验 plan↔正文，写出 **realized** | 否 |
| **通过 / 豁免** | pass → 可点接受；fail → 默认应 rewrite；用户说「可不全落实」→ 豁免后可接受 | 否 |
| **Accept** | 用户确认把**当前草稿**变成分支正文 | 即将 |
| **Commit** | 用 **realized**（不是 plan）更新 ledger | **是** |

所以：

- 审查 **已经做了校验工作**，还多做一件事：留下 **realized 结算单**，供 Accept 记账。  
- Accept **仍然要做**，且 **落定以实际落实为准**。  
- **不是**「审查通过就自动改账本」，也 **不是**「Accept 时再盲信 plan」。  
- 审查未通过 → **应 rewrite 直到伏笔审查 pass**；除非用户显式豁免「可以不全落实」，此时仍 commit realized（未落实的 reveal **不得**标成已回收）。

---

## 7. 存储设计（建议）

```sql
CREATE TABLE IF NOT EXISTS foreshadowing_ledgers (
  user_id   TEXT NOT NULL,
  novel_id  TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  version   INTEGER NOT NULL DEFAULT 1,
  data      TEXT NOT NULL,  -- JSON ForeshadowingLedger
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, novel_id, branch_id)
);
```

- 与 `branches` 同粒度；删小说/删分支时 cascade 删 ledger。  
- 新建分支：从父分支 ledger 拷贝一行（parent 无则空账本）。  
- **不要** 只放 intermediate-store（重启丢失，违反跨续写）。

会话 plan：

- 放 intermediate-store：`saveForeshadowPlan / getForeshadowPlan`，key = `novelId::branchId`。  
- 或挂在 outline JSON 固定字段 `foreshadowingPlan`（二选一，实现时定；推荐独立 key，避免 outline 文本污染）。

---

## 8. API / 工具草图（实现阶段）

### 8.1 Agent 工具

| 工具 | 谁可用 | 作用 |
|------|--------|------|
| `get_foreshadowing_ledger` | outline, writer, review | 读持久 active |
| `save_foreshadowing_plan` | outline | 写意图 plan |
| `get_foreshadowing_plan` | writer, review | 读 plan |
| `save_foreshadowing_realization` | review_foreshadowing | 写 realized + pass + gaps |
| `get_foreshadowing_realization` | accept 服务端 / UI | 读最终结算 |

**不提供** 持久 CRUD 给草稿阶段 Agent。

### 8.2 HTTP

| 端点 | 作用 |
|------|------|
| `GET .../foreshadowing?novelId&branchId` | UI 展示账本 |
| `POST .../continuation/accept` | **接受续写**：写 branch + **按 realized commit** |

Accept 请求体（草图）：

```ts
{
  novelId, branchId,
  content: string,                 // 最终草稿正文
  allowPartialForeshadowing?: boolean, // 用户豁免：plan 未全满也允许接受
}
```

服务端校验：

1. 存在与 content 匹配的 **realization**（无则拒：先跑伏笔审查）  
2. `realization.pass === true` **或** `allowPartialForeshadowing === true`  
3. 写入 branch  
4. `commitLedger(realization.realized)` —— **禁止** `commitLedger(plan)`  

### 8.3 产品：明确的「接受续写」

- 展示：草稿、**plan 意图**、**realized 实际**、gaps、findings、pass/fail  
- 默认：fail 时主按钮禁用或导向「按伏笔审查修改」  
- 显式次按钮：**接受（允许不全落实）** → `allowPartialForeshadowing: true`  
- 主按钮：**接受续写**（需 pass，或已点豁免）

---

## 9. 与现有代码的关系

| 现有 | 关系 |
|------|------|
| `src/core/codex/types.ts` `ForeshadowingEntry` | 可演化为 `ForeshadowingItem`，字段补全 importance/related/anchor |
| `updateCodexAfterChapter` | 逻辑可参考，但 **触发点改到 accept**，不是章末审查报告 |
| `review-foreshadowing-system.md` | 对照 ledger+plan+prose；输出 findings **与** structured realized |
| `outline-system.md` | 强制产出 structured plan + 决策埋收 |
| `intermediate-store` | 仅 plan/prose/findings；ledger 不在此 |
| `save_prose` | **禁止** 触发 commit |

---

## 10. 风险与原则

1. **草稿污染**：任何中间态写持久 ledger 都会在用户否定续写后留下脏数据 → 严格 D2。  
2. **Plan 与正文不一致**：审查产 realized；默认 fail→rewrite；豁免 Accept 也只按 realized 记账，**绝不**用 plan 假装全落实。  
3. **账本膨胀**：history 截断；active 条数建议软上限（如 30），超出由大纲优先 abandon/merge。  
4. **长篇成本**：ledger 注入 prompt 只注入 active 摘要（必收优先），全文 history 不塞。  
5. **分叉拷贝**：fork 时拷贝 ledger，避免空账本导致「另一线丢伏笔」。  
6. **导入**：空账本即可，不强制冷启动提取。

---

## 11. 分阶段（实现时再拆 PR；本期不写代码）

| Phase | 内容 |
|-------|------|
| P0 | 表结构 + CRUD + 分支 fork 拷贝；GET API；空列表 UI |
| P1 | outline 产 plan；writer/review 读 plan+ledger；prompt 改造 |
| P2 | **Accept UI/API**；pass/豁免闸门；写 branch + **commit realized** |
| P3 | 用户可编辑 ledger / 废弃；可选日后「从正文提取伏笔」 |

---

## 12. 开放问题 → 已收口

| 原问题 | 结论 |
|--------|------|
| O1 Accept 入口 | **加明确「接受续写」**；账本只挂在此动作 |
| O2 校验与落定 | **审查做校验并产出 realized**；**Accept 后按 realized 落定**；fail→rewrite 至 pass，或用户豁免不全落实（§4.2–4.3、§6.5） |
| O3 plan 外新坑 | 进 realized；Accept 时按 realized 入库 |
| O4 导入 | **空账本**，以后可提取 |
| O5 rewrite | **新大纲覆盖 plan**；accept 用最终 plan + 最终正文 |
| O6 章节号 | **OK 用锚点**，不强制第 N 章 |

---

## 13. 验收标准（将来实现用）

1. `save_prose` / 审查完成前后 ledger 不变；**仅 Accept 后变**。  
2. plan 要求 reveal 但正文未写、用户又豁免 Accept → 该 id **仍留在 active**（realized 未含 reveal）。  
3. plan 要求 reveal 且正文写了、审查 realized 含 reveal、Accept → id 进 history。  
4. fail 且未豁免 → Accept 被拒；rewrite 后再审。  
5. 丢弃草稿 → ledger/branch 不变。  
6. 分叉拷贝 ledger；Accept 与 save_prose 可区分。

---

## 14. 决策记录

**第一轮**

- 归属：按分支  
- 更新：用户接受续写进正文之后（非 save_prose）  
- 字段：描述状态、类型窗口、锚点、重要度必收、关联实体  
- 职责：大纲决策、写手执行、审查验 diff  
- 范围：先设计文档  

**第二轮（2026-07-16）**

1. 要加明确的「接受」  
2. 要校验（见第三轮修正）  
3. 由伏笔审查 agent 审查，用户决定要不要接受  
4. 导入先空账本  
5. 多轮 rewrite：最终大纲 plan 为准  
6. 锚点代替强制章节号 OK  

**第三轮（纠正：落定以实际为准）**

- 审查 = 校验 + 产出 **realized**，仍不写账本  
- 未按 plan 落实 → **rewrite 直到伏笔审查 pass**  
- 用户说「可以不全落实」→ 允许 Accept，**commit 仍用 realized**，不用完整 plan  
- Accept 之后才落定正文 + 账本  
