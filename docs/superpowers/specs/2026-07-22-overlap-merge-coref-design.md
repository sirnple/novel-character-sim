# Spec: Overlap 归并式消解 + 术语 mention

**Status:** Accepted · stages ①② implemented (2026-07-22)  
**Date:** 2026-07-22  
**Supersedes (for stages 1–2):** 以「Δunit 近距同名 + 全书共现异名作业」为主路径的做法  
**Related:**  
- `2026-07-22-global-coref-problem-catalog-design.md`（P1–P7 问题目录；本 spec 重定义 ①② 如何解决其中若干项）  
- `2026-07-20-local-global-character-coref-design.md`（旧局部+全书骨架）  
- `2026-07-18-character-name-scan-design.md`（扫名；术语将从 surface 迁到 mention）

---

## 1. Goals

1. **术语统一**：LLM 扫名阶段产出的角色指称叫 **mention**，不再用 surface 指「扫出来的角色」。  
2. **① 切窗带 overlap**，专供跨窗对齐。  
3. **② 程序主消解**：相邻窗在 overlap 上按判据 **A** 合并，再按窗序归并（并查集 / 传递闭包）。  
4. **Agent 只做全局消解残差**（合不上的链、结构问题等），不做主合并引擎。

## 2. Non-goals（本 spec）

- 不定 overlap 最终字数（**先字符切，后调**）。  
- 不在此实现代码迁移（现有 `surface` 字段/API 的 rename 另开）。  
- 不规定详情/关系抽取。  
- 不以封号词表自动并人为主路径。

---

## 3. 术语（必须统一）

| 术语 | 含义 | 非含义 |
|------|------|--------|
| **mention** | LLM 在某一窗内识别出的角色指称串（含本窗 canonical 与 aliases 里的串） | 不是任意 catalog 子串启发式 |
| **canonicalName**（窗内 / 合并后 name） | 该实体当前主名 | 可随合并重选 |
| **alias** | 同一实体的其它 mention | |
| **mention set** \(S(e)\) | \(\{\mathrm{canonicalName}(e)\} \cup \mathrm{aliases}(e)\) | |
| **window** \(W_i\) | 一段连续正文 | |
| **overlap** \(O_{i,i+1}\) | \(W_i\) 与 \(W_{i+1}\) 的文本交集（字符切） | |
| **entity / 人** | 合并后的一人（一人一行） | |
| **残差全局消解** | Agent 阶段：无 overlap 链、悬空、双挂/互挂、补漏等 | 不是 ② 的主合并 |

**废弃（产品叙述）**：用 **surface** 称呼「LLM 扫出来的角色」。  

**实现过渡**：代码里可暂留 `surface` / `SurfaceCatalog` 标识符，文档与新逻辑称 **mention**；迁移时 rename。

---

## 4. 总流程（四段，修订）

```text
① 带 overlap 的切窗 + 每窗 LLM → 窗内 entities（canonical + aliases = mentions）
      ↓
② 程序：overlap 判据 A 对齐 → 归并所有窗 → 全书实体草稿
      ↓
③ Agent：仅全局残差消解（无链异名、悬空、双挂/互挂、可选补漏…）
      ↓
④ 程序验收 + gate + 落库
```

| 段 | 谁 | 职责 |
|----|-----|------|
| ① | LLM + 程序切窗 | 窗内 mention 列表与局部一人一行 |
| ② | **程序** | **主消解**：overlap 归并 |
| ③ | **Agent** | **只做后面的全局消解（残差）** |
| ④ | 程序 | 结构闸、名单筛选、落库 |

---

## 5. ① 切窗 + 扫名

### 5.1 切窗

- 按 **字符数** 切 \(W_1 \ldots W_n\)（预算后调）。  
- 相邻窗保留 overlap \(O_{i,i+1}\)（字符长度后调）。  
- Overlap 必须足够长，使跨窗重复出现的 mention 有机会落在 \(O\) 内。

### 5.2 每窗 LLM

输出实体列表，每实体至少：

```ts
{
  canonicalName: string;  // 本窗主名
  aliases: string[];      // 本窗其它 mention
}
```

规则：

- 本窗同一人 → 一行；`S(e) = {canonicalName} ∪ aliases`。  
- 不做跨窗合并。  
- 尽量避免悬空词单独作 canonicalName（仍可能发生 → ③/④ 处理）。

### 5.3 本步解决 / 未解决

| 解决 | 未解决 |
|------|--------|
| 分段扫名 | 窗内漏合 |
| 为 ② 提供 overlap 对齐带 | 跨窗同一人（交给 ②） |
| 窗内 mention 集合 | 远距、overlap 对不上的异名 |

---

## 6. ② Overlap 归并（主消解算法）

### 6.1 判据 **A**（已拍板）

相邻窗 \(W_i, W_{i+1}\)，overlap 文本 \(O = O_{i,i+1}\)。

实体 \(e \in W_i\)，\(f \in W_{i+1}\)：

\[
\begin{align*}
&S(e) \cap S(f) \neq \emptyset \\
&\text{且}\quad \exists\, u \in S(e) \cap S(f)\ \text{使得}\ u\ \text{作为子串出现在}\ O\ \text{中}
\end{align*}
\]

则 **\(e\) 与 \(f\) 为同一人**，应合并。

要点：

- 对齐的是 **mention 串**（canonical 或 alias 皆可）。  
- 公共 mention 必须 **真正出现在 overlap 正文** 里，避免「名单有串但重叠带没写到」的假对齐。  
- **不是**「不同 mention 在 overlap 共现」（那是更松的 B，本 spec **不用**）。

### 6.2 归并过程（类归并 / 并查集）

```text
对每个窗 Wi 的每个局部实体 e：建簇 id
for i = 1 .. n-1:
  对 Wi 的每个 e、W{i+1} 的每个 f:
    若判据 A(e, f, O_i,i+1) 成立 → union(e, f)
最终每个连通分量 = 一个全书人
```

等价：从左到右维护「已合并前缀」的簇集合，每步用 overlap 把下一窗挂进去（归并感）。

### 6.3 合并字段

- \(S(\mathrm{person}) \leftarrow \bigcup S(e)\) over 分量内局部实体  
- `name` / canonical ← 在 \(S\) 上选（可用既有 preferRealName 等）  
- `aliases` ← \(S \setminus \{\mathrm{name}\}\)  
- 窗/锚点记录 ← 并集（供 ③ lookup）

### 6.4 本步解决 / 未解决

| 解决 | 未解决（→ ③ 或以后） |
|------|----------------------|
| 跨窗同名（mention 落在 overlap） | 全程无公共 mention 落在任一 overlap 的同一人 |
| 跨窗异名但共享某一 mention 且在 overlap | 同串不同人且 overlap 也出现该串 → 误合风险 |
| 不再依赖 Δunit≤D 魔法作主路径 | 双挂/互挂结构（合并后校验） |
| 不再以全书共现作业作主路径 | 悬空 canonical、补漏、误合 split |

---

## 7. ③ Agent：仅全局残差消解

**不做：** 替代 ② 的 overlap 归并主路径。  

**做：**

| 类 | 说明 |
|----|------|
| 无链残差 | ② 未能并上、但可能仍是同一人的个案（少而精） |
| 悬空主名 | 女朋友/弟弟/他爸 等 |
| 双挂 | 主名 X 又在别人 aliases（可单向） |
| 互挂 | A↔B 互写 aliases；解法：双方非真名→第三者；真名+代词→keep 真名 |
| 可选补漏 | 高频 mention 未挂上 |
| 可选 split | ② 误合 |

工具与闸门可沿用现有 submit 结构检查；**作业来源应从「全书共现大表」改为「② 之后的残差」**（实现时收敛）。

---

## 8. ④ 程序验收 + 落库

- 结构闸：悬空主名、双挂/互挂、（若保留）残差未处理等。  
- 名单 gate、落库。  
- 短名⊂全名等安全 fold 可保留。

---

## 9. 与 P1–P7 的映射（实现后）

| ID | 本算法下 |
|----|----------|
| P1 近距同名 |  largely → ② overlap 共享 mention |
| P1 远距同名 | 有 overlap 链则 ②；否则 ③ |
| P3 异名 | 共享 mention ∈ overlap → ②；否则 ③ 残差 |
| P2/互挂/P4 | ③ + ④ |
| P5/P6/P7 | 仍偏 ③/④，非 ② 主路径 |

---

## 10. 实现切片

1. ~~① overlap 切窗~~ → `buildOverlapScanUnits`（`DEFAULT_OVERLAP_WINDOW_CHARS` / `DEFAULT_OVERLAP_CHARS`）  
2. ~~② 判据 A + 并查集~~ → `mergeLocalEntitiesByOverlap`；job/scan workspace 以之为 seed  
3. **收窄 ③**：异名作业改为残差向（共现大表可降级）— 进行中/待收  
4. 调 overlap 长度与窗长（eval）  
5. 代码里 surface → mention 全量 rename（分期）

---

## 11. 验收（算法级）

- [ ] 相邻窗：左 `canonical=唐兰嫣`，右 `canonical=战女王, aliases=[唐兰嫣]`，且 overlap 正文含「唐兰嫣」→ **程序合并为一人**。  
- [ ] 仅名单有串、overlap 正文无该串 → **不合**。  
- [ ] 三角传递：1–2 合、2–3 合 ⇒ 1 与 3 同人。  
- [ ] Agent 路径不再作为「无 overlap 归并也能完成全书主合并」的唯一依赖。

---

## 12. 变更记录

| 日期 | 内容 |
|------|------|
| 2026-07-22 | 初稿：mention 术语；判据 A；字符 overlap；Agent 仅残差全局消解 |
