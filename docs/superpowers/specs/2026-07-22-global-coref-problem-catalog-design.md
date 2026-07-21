# Spec: 全书消解问题目录（7 类）与逐项攻克计划

**Status:** Draft — product backlog for global coref quality  
**Date:** 2026-07-22  
**Related:**  
- `2026-07-20-local-global-character-coref-design.md`（局部 + 全书总架构）  
- `2026-07-18-character-name-scan-design.md`（扫名）  
- 实现：`character-entity-resolve`、`character-entity-consistency`、`character-local-entities`、`character-entity-ops`、`submit_character_entities`

---

## 1. Goals

1. 把「全书一人一行」拆成 **可验收的问题类**，避免只靠 prompt 笼统说「去做消解」。  
2. 每类明确：**谁负责（程序 / Agent）**、**成功标准**、**当前缺口**、**建议攻克顺序**。  
3. 后续按序单开改动；**不**在本文件里一次做完全部实现。

## 2. Non-goals

- 本文件不规定具体 PR 代码 diff。  
- 不要求一次消灭所有漏合（补漏有门控，路人可丢）。  
- 不以硬编码封号词表作主路径（与既有 spec 一致）；程序兜底限于结构/短名等可证伪规则。

## 3. Pipeline 位置（reminder）

```text
扫名+局部消解 → seed（近距同名程序合）→ 全局 Agent（merge/split/upsert）
  → submit 结构校验 → （job）计次/gate/consolidate → 落库
```

全局阶段解决的是 **跨窗 / 跨称呼 / 名单结构合法**，不是再扫一遍正文。

---

## 4. 问题目录（7 类）

### P1 — 同名（same surface, same or different people）

| | |
|--|--|
| **定义** | 多处出现相同主名字符串：可能是同一人，也可能是两个「张三」。 |
| **近距** | 程序：`seedGlobalEntitiesFromLocal`，\|Δunit\| ≤ D（默认 5）合并。 |
| **远距** | 程序 seed 为 `名` + `名@uN` 分簇；Agent merge 或改名区分；收尾 `collapseTechnicalFarSameNameKeys`。 |
| **成功标准** | 同一人只一行；真·同名异人主名可区分（非残留 `@uN` 技术 id 出现在 UI）。 |
| **当前** | 近距：✅ 程序。远距：⚠️ Agent + 收尾折叠（误并风险若 Agent 未区分）。 |
| **缺口** | 收尾折叠默认「同 bare 即并」；真同名异人缺少强制改名门槛。 |

### P2 — 双挂（primary also claimed as alias/surface of another row）

| | |
|--|--|
| **定义** | 存在行 A：`name=X`，且行 B 的 aliases/surfaces 含 `X`（B≠A）。 |
| **责任** | **Agent 必须** merge 或删除误挂；程序 **检测 + 拒绝 submit**，不静默污染合并。 |
| **成功标准** | 名单中无双挂；submit 失败时 **点名双方 + 建议 ops**。 |
| **当前** | ✅ 硬校验 + 双挂清单；短名⊂全名可程序 fold。scan 默认跳过避免「失败后重扫」。 |
| **缺口** | 清单可读性已加强；多人 claim 时 Agent 仍可能乱 keep。 |

### P3 — 异名同一人（尚未双挂）

| | |
|--|--|
| **定义** | 两行不同主名，实为一人，但 **互未挂 alias**（或仅间接）。例：战女王 / 唐兰嫣；魔都女王 / 姜璎玑。 |
| **责任** | 程序列怀疑对；Agent 查证后 **必须表态处理**；程序硬卡「未处理」。 |
| **成功标准** | 每个候选都有处理记录；该合的合上（eval `aliasOf`）；存疑可标记后放行。 |
| **当前** | ✅ 候选全来源 + `resolve_cross_name_pair` + submit/结束硬卡未处理（2026-07-22）。 |
| **调参** | 共现/列表过大时：`DEFAULT_MIN_COOCCUR_UNITS`、`DEFAULT_CROSS_NAME_CANDIDATE_LIMIT`（`character-cross-name.ts`）。 |
| **缺口** | eval 回归待跑。 |

#### 4.1 P3 产品决议（2026-07-22 拍板）

**候选来源：全部上**（程序只列怀疑，不判同一人）

| 来源 | 说明 |
|------|------|
| 同窗分列 | 同 unit 两个不同 name |
| 近距 Δunit≤D | 与现 near 一致 |
| 共现 | unit 交集 / 共现次数 |
| 局部曾互为 alias | 一窗 A.aliases 含 B，另处 B 独立成行 |

**结束门槛：卡「是否处理」，不卡「必须 merge」**

| 概念 | 含义 |
|------|------|
| **未处理** | 该怀疑对仍两行主名，且 Agent **从未**对其表态 → **硬不通过**（submit/Agent 结束失败） |
| **已处理** | 对该对做过且仅需下列之一 → **可放行该对** |

处理结果（三选一，均算「已处理」）：

| 结果 | 动作 | 名单效果 |
|------|------|----------|
| **同一人** | `merge keep=… absorb=[…]` | 一人一行 |
| **非同一人** | 显式标记 `distinct`（工具待实现） | 两行保留 |
| **存疑** | 显式标记 `uncertain` / 存疑（工具待实现） | 两行保留，**记录存疑后放过门槛** |

要点：

1. **门槛 = 作业必须交**，不是「必须合成一个人」。  
2. 存疑 **不是** 沉默跳过：必须 **写下标记** 才算处理。  
3. 沉默 / 没看到 → 未处理 → 卡。  
4. 证据仍由 Agent lookup；程序不自动 merge（短名 fold 除外，属结构安全子集）。  
5. 修复路径禁止默认重扫。 |

实现时建议：

- `list_cross_name_candidates`（或扩展 near）：输出 id、两名、来源、分。  
- workspace 记 `pairResolutions: { pairKey: merge|distinct|uncertain, … }`。  
- merge 成功自动记 `merge`；`resolve_cross_name_pair(a,b, verdict)` 记 distinct/uncertain。  
- submit / 结束：`unresolved = candidates − resolved` 非空则失败并 **点名清单**。

### P4 — 悬空指代作主名

| | |
|--|--|
| **定义** | `name` 为女朋友/弟弟/他爸/纯代词等无独立指称对象的标签。 |
| **责任** | Agent merge 到真人；程序 **submit / 收尾硬拦**。 |
| **成功标准** | 最终名单无此类主名；aliases 中可保留第三人称关系词（禁止我爸/你妈进 aliases）。 |
| **当前** | ✅ `isUnanchoredRelationLabel` + validate + Agent 结束检查。 |
| **缺口** | 边界词（「嫂子」「校花女友」等）是否算悬空可再收紧词表/结构规则。 |

### P5 — 误合 → split

| | |
|--|--|
| **定义** | 局部或全局把不同人并进一行，或锚点归属错误。 |
| **责任** | Agent `ops: split`（move_surfaces / move_anchors）；程序执行 ops。 |
| **成功标准** | 冲突身份可拆成两行；锚点不混。 |
| **当前** | ⚠️ split 工具完整；**无自动侦测误合、无强制 split**。 |
| **缺口** | 缺少「同名远距冲突 / 关系矛盾」候选列表逼 Agent 审视。 |

### P6 — 未覆盖 surface 补漏

| | |
|--|--|
| **定义** | catalog 高频 surface 未落入任何实体 name/aliases/surfaces。 |
| **责任** | Agent `list_uncovered_surfaces` → upsert/merge；程序列表反馈。 |
| **成功标准** | 重要称呼覆盖率达标（阈值可配置）；路人可明确放弃。 |
| **当前** | ⚠️ submit 成功后附带未覆盖列表；**不拦提交**。 |
| **缺口** | 结束条件可对 top-N 未覆盖要求处理或声明 drop。 |

### P7 — 主名选举（canonical name）

| | |
|--|--|
| **定义** | 同一人多个 surface 中，哪条作 `name`，其余进 aliases。 |
| **责任** | Agent 选 keep；程序短名 fold / gate 后 `consolidate` + `preferRealName` 辅助。 |
| **成功标准** | 真名优先于纯封号（在有真名时）；悬空永不作 name（见 P4）。 |
| **当前** | ⚠️ 部分程序 orient；无「封号压真名」全局硬规则。 |
| **缺口** | 与 P3 绑定：合进去之后才谈选主名。 |

---

## 5. 攻克顺序（建议）

原则：**先结构硬闸与已暴露矛盾，再召回，再精修。**

| 序 | ID | 理由 |
|----|-----|------|
| 0（已做基线） | P2、P4、scan 跳过 | 双挂/悬空硬拦；失败勿重扫 |
| **1** | **P3 异名** | 用户可见最大问题（绿帽封号）；影响 eval aliasOf |
| **2** | **P1 远距同名** | 收尾折叠与真·同名异人策略 |
| **3** | **P6 补漏门槛** | 防「submit 一次即成功」漏称呼 |
| **4** | **P7 主名** | 合稳后再 orient |
| **5** | **P5 split 候选** | 误合侦测与工具提示 |

每项开工时：写清验收用例（欲孽 / 绿帽 gold）→ 实现 → 单测/eval → 再下一项。

---

## 6. 每项设计时的统一接口（约定）

后续为某一 P 写细 spec / 实现时，必须回答：

1. **检测**：程序如何发现（候选列表 / 校验谓词）？  
2. **动作**：Agent 工具还是程序 fold？  
3. **闸门**：submit 失败 / 仅警告 / 结束未完成？  
4. **勿重扫**：修复路径不得默认 `scan forceRefresh`。  
5. **回归**：`yunie-zhuoxin` / `lvmao-wushen`（含 `aliasOf`）或单测夹具。

---

## 7. 验收（目录级）

- [ ] 本文 7 类在代码/注释或 Agent prompt 中有对应入口（工具或校验）。  
- [ ] P2/P4 submit 失败信息 **点名具体实体**。  
- [ ] P3 有独立改进项落地后，绿帽 `aliasOf`（战女王→唐兰嫣 等）可测。  
- [ ] 全局循环默认 **不二次全书 scan**（已有 catalog 跳过）。

---

## 8. 下一步（会话约定）

**P3 产品已拍板**（§4.1）：候选全上；门槛卡处理；结果 ∈ {merge, distinct, 存疑}。  

实现切片建议：

1. **P3a** 候选生成 + list 工具 + 单测  
2. **P3b** `resolve` 标记（distinct / uncertain）+ merge 自动记账  
3. **P3c** submit / Agent 结束硬卡未处理 + 点名清单  
4. **P3d** prompt + 绿帽/欲孽回归  

---

## 9. 变更记录

| 日期 | 内容 |
|------|------|
| 2026-07-22 | 初稿：7 类问题、现状、攻克顺序 |
| 2026-07-22 | P3 拍板：全来源候选；门槛=必须处理；存疑可标记放行 |
