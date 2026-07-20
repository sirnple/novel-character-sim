# Spec: 局部消解 + 全书消解（角色名单）

**Status:** Accepted direction (product grill); implementation in progress  
**Date:** 2026-07-20  
**Context:** 长篇（如《超凡都市之绿帽武神》）扫名召回尚可，但「洛大小姐↔洛雪棠」「洛家二小姐↔洛雨棠」「兰嫣大嫂↔唐兰嫣」等称谓未并入真名。根因是 **扫名与全书消解信息断裂**：阶段 1 禁止局部消解，阶段 2 只见扁平 surface 冷启动。

**Related:** `2026-07-18-character-name-scan-design.md`（单元扫名）；本 spec **修订** 其中「本步不做消解」的局部规则。

---

## 1. Goals

1. **阶段 1（局部）**：在扫角色的同一窗口内完成 **局部指代消解**（真名 + 称谓/外号 → 一人一行）。
2. **阶段 2（全书）**：在局部实体 + 锚点上做 **跨窗合并 / 拆分 / canonical 选举**，不再从扁平词表冷启动。
3. **短章打包**：章过短时合并相邻 unit 再调模型（复用 `packUnitsForMentionScan` 量级）。
4. **局部 name 可不稳定**：允许称谓当 name；全书阶段重选真名。
5. **可拆**：全局必须能 **split** 误绑（按锚点/surface 挪归属），不能只 merge。

## 2. Non-goals

- 姓氏/「大小姐」等 **字符串启发式自动硬合**（禁止作为主路径）。
- 阶段 1 输出性格/关系/世界设定。
- 阶段 1 保证全书唯一真名。
- 多机 job 队列；仍单进程 progressive job。
- 保证每一个一次性路人都进最终名单（仍可有频次/门控）。

## 3. Problem (frozen)

| 现状 | 后果 |
|------|------|
| 单元 prompt：同段真名/封号可分列，禁止全书消解被理解成「局部也不必合」 | 共现证据丢在阶段 1 |
| catalog = 扁平 surface + 频次 + 锚点 | 阶段 2 无「已是同一人」边 |
| 成功 = submit 过一次 | 未覆盖称谓不失败 |
| merge 仅 exact name | 真名行与称谓行永不合 |

## 4. Pipeline

```text
buildNameScanUnits (chapter-first)
    → packUnitsForMentionScan (短章合并 / ~16k·6u)
    → 阶段1 LLM：扫 + 局部消解 → LocalEntity[] per unit/batch
    → 汇总 localEntities + surface 索引 + 锚点
    → 阶段2 Agent：lookup 锚点 → merge | split | upsert
    → frequency / gate / detail…（既有后续可保留）
```

### 4.1 阶段 1 — 局部

**窗口**

- 默认：章 unit；过碎则 pack 连续 unit（现有 char/unit 预算）。
- 单 unit 超长：仍可单独一窗；窗内消解，跨窗归阶段 2。

**模型任务**

- 找出本窗所有具体人物指称。
- **本窗内同一人必须合成一条**：`name` + `aliases[]`。
- **禁止**把本窗已判定为同一人的真名与称谓拆成两行。
- **不做跨窗/全书**合并。
- 排除代词、悬空「他爸」等（与现规则一致）。

**输出 `LocalEntity`（每窗）**

| 字段 | 含义 |
|------|------|
| `name` | 本窗最佳称呼（真名优先；可仅为称谓） |
| `aliases` | 本窗其它 surface（同一人） |
| `unitIndex` / `unitLabel` | 来源窗 |
| `anchors?` | 可选；无则程序用全文 indexOf 补 |

**成功标准（阶段 1）**

- 高召回 surface；能合的 aliases 非空。
- 不要求 name 是全书最终真名。

### 4.2 阶段 2 — 全书

**输入**

- 全部 `LocalEntity`（可按 unit 分组展示）。
- 派生 surface→锚点 索引（lookup 用）。
- 全文。

**动作（Agent + 工具）**

| Action | 含义 |
|--------|------|
| **upsert** | 提交/更新实体（name, aliases, surfaces, anchors） |
| **merge** | 将 absorb 并入 keep（表面并集 + 锚点并集），再选 canonical name |
| **split** | 从 from 挪走 `move_surfaces` 和/或 `move_anchors` 到新实体 |

**Split 精确定义**

- 操作对象是 **锚点归属（及附着 surface）**，不是只改显示名。
- 证据：lookup 后身份/排行/关系冲突；证据不足 **不拆**。
- 拆完两边各自重选 `name`/`aliases`。

**Canonical 选举（合并后）**

- 在 surface 并集上选更像真名的做 `name`，称谓进 `aliases`。
- 局部 name 不稳定由此收口。

**成功标准（阶段 2）**

- 高频 surface / 局部实体 label 尽量落入某全书实体。
- submit 返回 **未覆盖** 列表；应用尽调后结束（步数允许范围内）。

## 5. Data contracts

### 5.1 LocalEntity

```ts
interface LocalEntity {
  name: string;
  aliases: string[];
  unitIndex: number;
  unitLabel?: string;
  anchors?: MentionAnchor[];
}
```

### 5.2 Global entity (既存 ResolvedEntity 对齐)

```ts
interface ResolvedEntity {
  name: string;
  aliases: string[];
  surfaces?: string[];
  anchors?: MentionAnchor[];
  role?: string;
  briefDescription?: string;
}
```

### 5.3 Submit payload（阶段 2，可分批）

```json
{
  "entities": [ /* upsert 列表，按 name 合并 */ ],
  "ops": [
    { "op": "merge", "keep": "洛雪棠", "absorb": ["洛大小姐"] },
    {
      "op": "split",
      "from": "洛雪棠",
      "move_surfaces": ["那位小姐"],
      "move_anchors": ["a@9000"],
      "new_name": "沈薇薇"
    }
  ]
}
```

- `entities` 与 `ops` 可同批；先 upsert 再 ops，或先 ops 再以 entities 为准（实现时固定顺序并写进工具描述）。
- **推荐顺序**：apply `ops` → merge `entities` into roster。

## 6. Prompt 变更要点

| 文件 | 变更 |
|------|------|
| `character-names-unit-system.md` | 删除「可分列真名/封号」；改为 **本窗必须局部消解**；仍禁止跨窗 |
| `character-entity-resolve-system.md` | 输入=局部实体；merge/split/升格 name；未覆盖须继续 |
| EN 镜像 | 同步 |

## 7. Tooling / job

| 组件 | 行为 |
|------|------|
| `scanUnitHitsWithLlm` | 输出仍可落在 `UnitNameHit`（name+aliases=局部消解）；语义改为强制合 |
| `buildSurfaceCatalog` | 可由 local entities 的 name∪aliases 建索引；保留锚点 |
| workspace | 增加 `localEntities`（可选）供阶段 2 列表工具展示 |
| `submit_character_entities` | 支持 ops；返回未覆盖高频 surface |
| `list_local_entities` / `list_uncovered_surfaces` | 阶段 2 导航 |
| `maxSteps` | 长 catalog 提高（如 48） |
| char-job | scanning → resolving 传局部结果；resolving prompt 指向局部实体 |

## 8. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| 局部误合 | 全局 split + 拒并 |
| 局部不合 | 全局仍可 merge；未覆盖反馈 |
| 成本上升 | 阶段 2 少盲目 list；局部一次读完 |
| 缓存旧扫名 | forceRefresh / cache key 含 schema 版本 |

## 9. Acceptance

1. 单元 prompt/ schema 要求本窗 aliases 合并；黄金句「洛雪棠，洛大小姐」同窗 → 一行两 surface。  
2. 全局可用 merge 把跨窗「洛大小姐」并入「洛雪棠」。  
3. split 能按 anchor/surface 挪走误绑 surface。  
4. submit 后可见未覆盖列表。  
5. 《超凡都市》类长篇：上述三对称谓在名单中作为 aliases 挂在对应真名下（人工或 eval 抽检）。

## 10. Out of scope this ship

- 关系图/详情抽取改动。  
- 启发式姓氏表合并。  
- 多模型 ensemble。
