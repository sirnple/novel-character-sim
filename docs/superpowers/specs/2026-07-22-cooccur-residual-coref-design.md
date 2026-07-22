# Spec: 全局残差消解 — 共现四级决策

**Status:** Implemented (program + grey LLM; config via `CHARACTER_COREF_*`)  
**Date:** 2026-07-22  
**Depends on:** `2026-07-22-overlap-merge-coref-design.md`（① overlap 扫名 + ② 判据 A 归并）  
**Config:** `src/lib/character-coref-config.ts` + `getCharacterCorefConfig()` / Admin 运行配置

---

## 0. 前置

①② 之后得到**归并后的实体列表**。本阶段：判断列表中两个实体 A、B 是否同一人。

**术语：** LLM 扫出的指称叫 **mention**；实体有 `name`（canonical）与 `aliases`。

---

## 1. 四级总览

```text
第1级 硬规则（程序）→ 合 / 拒
第2级 共现打分（程序）→ score ∈ [0,1]（含时序惩罚）
第3级 阈值分流 → ≥0.85 合 / [0.45,0.85) 灰 / <0.45 拒
第4级 LLM（仅灰区）→ 是/否/不确定(默认拒)；一对一问；各约200字上下文
```

目标成本：约 **5–15 对灰区 / 万字** 进第4级。

---

## 2. 第1级：硬规则（程序，不调 LLM）

| # | 条件 | 决策 |
|---|------|------|
| 1 | A、B 在**同一块（unit）同时出现过** | **拒合** |
| 2 | **性别冲突**（男 vs 女） | **拒合** |
| 3 | **年龄描述冲突**（如少年 vs 老人） | **拒合** |
| 4 | A、B 有 **≥ 2 个相同别名** | **合并** |
| 5 | A、B **全名完全相同** | **合并** |

### 2.1 属性从哪来（已拍板）

- **性别、年龄：在第 ① 步扫名/局部抽取时带来**（每个窗实体可带 gender / age 描述；归并时按一致性合并或保留冲突供本级检测）。  
- 若某实体缺失该字段 → **跳过**对应冲突规则（不虚构）。

### 2.2 「≥ 2 个相同别名」（已拍板）

- **不含**双方的 canonical `name`。  
- 只在 **aliases 集合**上算交集：  
  \[
  |\,\mathrm{aliases}(A) \cap \mathrm{aliases}(B)\,| \ge 2
  \]
  （比较前做 normalize：去空白等。）  
- 例：A=`唐兰嫣` aliases=`[战女王, 队长]`，B=`某某` aliases=`[战女王, 队长]` → 可硬合并。  
- 仅共享一个 alias，或只是 name 相同走规则 5，不走规则 4。

### 2.3 全名相同

- `norm(name_A) === norm(name_B)` → 合并。

---

## 3. 第2级：共现打分（已拍板权重与公式）

在硬规则未决后计算。最终：

\[
\mathrm{score} = \mathrm{clip}_{[0,1]}\big(\,0.5\cdot S_{\mathrm{专属}} + 0.3\cdot S_{\mathrm{J}} + P_{\mathrm{时序}}\,\big)
\]

其中 \(P_{\mathrm{时序}} \in [-0.2, 0]\)（**只惩罚、不加分**）。

### 3.1 共现专属度（权重 0.5）— 最值钱

衡量关键配角是否足够独特：「跟同一个 X 绑得有多死」。

对某个共同伙伴 \(X\)（与 A、B 都共现过）：

\[
\mathrm{专属度}(X) = \min\Bigl(\frac{\mathrm{count}(A,X)}{\mathrm{count}(A)},\ \frac{\mathrm{count}(B,X)}{\mathrm{count}(B)}\Bigr)
\]

- \(\mathrm{count}(A)\)：A 出现的段落/unit 次数（或窗次数）  
- \(\mathrm{count}(A,X)\)：A 与 X **同窗出现**的次数  

**取所有共同伙伴 X 上的最大专属度**作为 \(S_{\mathrm{专属}}\)（或 top-k 平均，默认 **max**）：

\[
S_{\mathrm{专属}} = \max_{X \in N(A)\cap N(B)} \mathrm{专属度}(X) \in [0,1]
\]

加权贡献：\(S_{\mathrm{专属}} \times 0.5\)。

例：林风、无名都与血屠强绑定，专属度都 0.9 → 贡献 \(0.9 \times 0.5 = 0.45\)。

### 3.2 共现图谱 Jaccard（权重 0.3）

\[
S_{J0} = \frac{|N(A) \cap N(B)|}{|N(A) \cup N(B)|} \in [0,1]
\]

\(N(A)\) = 与 A 同 unit 出现过的**其他实体**集合（邻居）。

**稀疏陷阱修正：** 若 \(\min(\mathrm{count}(A), \mathrm{count}(B)) < 3\)，则 Jaccard **权重要打折**：

- 不是把整项权重从 0.3 改成 0.15 写进最终式时二选一，而是：  
  \[
  S_{J} = 
  \begin{cases}
  S_{J0} \times 0.5 & \text{if }\min(\mathrm{count}(A),\mathrm{count}(B)) < 3 \\
  S_{J0} & \text{otherwise}
  \end{cases}
  \]
  再乘固定权重 0.3：贡献 \(S_J \times 0.3\)。

含义：两人各只出现一次且同段时，原始 Jaccard 可能假 1.0，打折后降权。

### 3.3 时序重叠度（惩罚 −0.2～0）

**只扣分或不扣，永不加分。**  
（完全不重叠也可能是同一人：改名、多年后等，故不靠「重叠」加分，只在重叠差时扣分。）

\[
\mathrm{重叠率} = \frac{\mathrm{overlap\_length}}{\min(\mathrm{span}_A, \mathrm{span}_B)}
\]

- \(\mathrm{span}\)：实体首次～末次出现位置（字符 offset 或 unit 序号区间）  
- \(\mathrm{overlap\_length}\)：两 span 交集长度  

| 重叠率 | 惩罚 \(P_{\mathrm{时序}}\) | 原因 |
|--------|---------------------------|------|
| **> 80%**（大体同一时期） | **0**（不扣分） | 时间吻合，不惩罚 |
| **20%～80%** | **−0.05** | 有交有离，略有风险 |
| **0%～20%（含完全不重叠）** | **−0.2** | 几乎无时间交集，需更强其它证据才合并 |

（上表将「完全不重叠」归入最重惩罚 −0.2，与「分值范围 −0.2～0」一致。）

### 3.4 综合与裁剪

\[
\mathrm{raw} = 0.5\cdot S_{\mathrm{专属}} + 0.3\cdot S_{J} + P_{\mathrm{时序}}
\]
\[
\mathrm{score} = \min(1, \max(0, \mathrm{raw}))
\]

---

## 4. 第3级：阈值分流

| score | 动作 |
|-------|------|
| **≥ 0.85** | 程序**自动合并** |
| **[0.45, 0.85)** | **灰色地带** → 第4级 LLM |
| **< 0.45** | 程序**自动拒绝合并** |

---

## 5. 第4级：LLM（仅灰色）

| 项 | 约定 |
|----|------|
| 粒度 | **每次只问一对** |
| 输入 | A 上下文 ~200 字 + B 上下文 ~200 字 + 共现摘要（score、专属 X、Jaccard、时序） |
| 输出 | 是 / 否 / **不确定 → 默认拒绝合并** |
| 量级 | 约 **5–15 对 / 万字** 进本级 |

---

## 6. 谁和谁要比：候选对生成（三通道，已拍板）

**术语：** 下文 **chunk = window（窗）**，与 ① 扫名 unit/窗一致。

第 1～4 级是「给定 A、B 怎么判」。  
入口先生成候选对集合 \(P\)，再对 \(P\) 中每对跑四级——**禁止**无脑 \(C(N,2)\)。

```text
实体列表
   │
   ├─ 通道 A：共现倒排索引 → 「共享至少一名共现实体」的对
   ├─ 通道 B：chunk 位置剪枝 → 仅作用于通道 A 的对（相隔过远则剪掉）
   ├─ 通道 C：全局别名索引 → 共享任一 alias 的对，强制并入 P（独立，不经共现）
   ▼
候选对集合 P = (通道A 经 B 剪枝) ∪ 通道C
   │
   ▼
对每个 (A,B) ∈ P → 第1级硬规则 → … → 第4级 LLM（若灰）
```

### 6.1 通道 A：倒排索引（Inverted Index）— 共现主通道

**思路：** 不枚举所有实体对，而枚举「共现实体」反查到的实体列表，只在列表**内部**两两组合。  
若两实体**没有任何共同共现实体（邻居）**，则**本通道不产出**该对（不代表永远不比，见通道 C）。

**做法：**

1. 对每个共现实体（邻居）\(X\)（如「血屠」）建倒排表：  
   `X → [与 X 同 chunk 出现过的实体…]`  
   例：  
   - `血屠 → [林风, 无名, 黑袍人, 王五]`  
   - `苏妍 → [林风, 无名, 赵六]`  
2. 遍历每个 \(X\)，对列表内实体两两组合 \((A,B)\)。  
3. 用哈希表累计每个实体对被**多少个不同共现实体**同时关联过（可作后续打分/调试）。

**复杂度：**  
设 \(M\) 个共现实体，每个平均关联 \(K\) 个角色（\(K\) 通常 3～8）：

\[
|P_A| \approx M \times C(K,2)
\]

而非 \(C(N,2)\)。小说里多为 \(O(N)\) 量级。

### 6.2 通道 B：块位置索引（Chunk Index）— 仅剪通道 A

**思路：** 若两实体出现位置完全错开且相隔很远，**共现合并**概率极低（转世/穿越等特例另案）。

**做法：**

1. 构建全局列表时，记录每个实体的 `first_chunk_id`、`last_chunk_id`（首次/末次出现的 chunk 下标）。  
2. 对**通道 A 产出的对**，仅保留满足位置约束的对，例如：  
   - \(|\mathrm{first\_chunk}(A) - \mathrm{first\_chunk}(B)| < T_{\mathrm{first}}\)（默认草案 **5**），和/或  
   - span 在 chunk 轴上有重叠，或 gap ≤ \(T_{\mathrm{gap}}\)（默认草案 **10** 块：相隔 **>10 块**则剪掉）  

产品原文：相隔 **>10 块**则共现合并可能性极低，生成候选时剪掉。  
`first_chunk` 距离阈值 **5** 可作为更紧的剪枝；实现时两阈值可配置，默认与上文一致。

**重要：** 通道 B **不作用于**通道 C。远距离同人 + 共享别名正是 C 要兜住的约 1% 案例；若对 C 再按 gap>10 剪掉会自废武功。

### 6.3 通道 C：全局别名索引（独立通道，已拍板）

**问题：** 约 **1%** 的「无共同朋友但实为同一人」——两实体 \(N(A)\cap N(B)=\emptyset\)，共现倒排永远进不了 \(P\)，但 aliases 有交集（如 `战女王` 分属两个实体、跨篇章无共同配角）。

**规则（独立、强制）：**

> 如果两个实体共享**任何一个**别名（**不通过**共现实体索引），**强制**加入候选对列表 \(P\)。

**做法：**

1. 建全局别名倒排（仅 `aliases`，**不含** canonical `name`——全名相同已由硬规则 5 覆盖）：  
   ```text
   alias → [拥有该 alias 的实体…]
   ```
   例：  
   - `战女王 → [实体_唐兰嫣, 实体_某某队长]`  
   - `魔都女王 → [实体_璎玑阿姨, 实体_姜璎玑]`  
2. 遍历每个 alias，对列表内实体两两组合 \((A,B)\)，**强制**写入 \(P\)（与通道 A 结果做集合并）。  
3. 同一对可能同时来自 A 与 C；合并时打标记 `source ∈ {cooccur, alias, both}` 便于调试与分流。

**与硬规则 4 的关系：**

| 共享 alias 数（不含 name） | 行为 |
|---------------------------|------|
| **≥ 2** | 进 \(P\) 后第1级硬规则直接**合并**（规则 4） |
| **= 1** | 进 \(P\)；硬规则不自动合；走打分 / 灰区（见 6.4） |
| **0** | 本通道不产出 |

**复杂度：** 设别名桶平均大小 \(K_a\)（通常 2～4，很少很大），别名种数 \(M_a\)：

\[
|P_C| \approx M_a \times C(K_a,2)
\]

远小于 \(C(N,2)\)；与 \(P_A\) 取并后增量约 **1% 量级** 量级，可接受。

**normalize：** 比较 alias 前去空白、统一大小写等，与硬规则 4 同一套。

### 6.4 通道 C 进四级后的分流（避免「强制进 P 又被分杀」）

无共同邻居时：\(S_{\mathrm{专属}}=0\)，\(S_J=0\)，再加时序惩罚 → \(\mathrm{score}\) 往往 **< 0.45**，若按默认阈值会**程序自动拒合**，等于通道 C 白进。

故对标记含 **alias** 来源的对，在硬规则未决后：

| 条件 | 动作 |
|------|------|
| 硬规则已决（合/拒） | 照旧 |
| \(|N(A)\cap N(B)| \ge 1\)（有共现证据） | 照常打分 + 阈值（可兼用 alias 证据） |
| **仅 alias 通道进 P** 且硬规则未决（典型：恰 1 个共享 alias） | **不按 <0.45 自动拒**；直接标为**灰区**，进第4级 LLM |

含义：单别名共享是弱程序证据，交给 LLM 一对一看上下文；双别名已由硬规则合掉。

第4级输入可额外带：`shared_aliases: [...]`。

### 6.5 三通道顺序

1. **通道 A** 倒排生成共现对  
2. **通道 B** 对通道 A 做 chunk 位置剪枝 → \(P_{AB}\)  
3. **通道 C** 全局别名索引生成强制对 → \(P_C\)（**不做** gap 剪枝）  
4. \(P = P_{AB} \cup P_C\)  
5. 对每个 \((A,B) \in P\)：第1级硬规则 →（按 6.4）第2级打分 / 强制灰区 → 第3级阈值 → 第4级 LLM  

---

## 7. 与 ①② 的分工

| 阶段 | 职责 |
|------|------|
| ① | overlap 切窗 + LLM → 窗内 mention 实体（可带性别/年龄） |
| ② | overlap 上共享 mention ∈ 正文 → 程序归并 |
| **本四级** | 列表上剩余实体是否同一人（硬规则 + 共现分 + 别名通道 + 灰区 LLM） |

---

## 8. 验收（实现后）

- [x] 同块同现 → 拒合，不进 LLM  
- [x] aliases 交集 ≥2（不含 name）或全名相同 → 程序合并  
- [x] 专属度 / Jaccard / 时序（权重可配置）  
- [x] 各出现 1 次的假 Jaccard=1 被半权修正  
- [x] 时序完全不重叠惩罚可配（默认 −0.2），永不加分  
- [x] 灰区单对 LLM，不确定则拒合  
- [x] **无共同邻居、但共享 1 个 alias → 强制进 P，且不因 score&lt;0.45 自动拒，进灰区 LLM**  
- [x] **共享 alias 的远距离对（gap&gt;10）不被通道 B 剪掉**  
- [x] 通道 C 不经共现倒排；与 A 结果取并  

**代码：** `src/core/extractor/character-cooccur-resolve.ts`  
**接入：** `character-extract-job`（overlap 种子之后、Agent 之前）  
**测试：** `scripts/tests/character-cooccur-resolve.test.ts`

---

## 9. 实现拍板（模糊点，2026-07-22）

| 点 | 拍板 |
|----|------|
| 性别/年龄字段尚未进 `ResolvedEntity` | 硬规则 2/3 **缺字段则跳过**（不虚构） |
| 通道 B 双阈值 | **仅** `chunkGapMax`（默认 10）；不做 first_chunk 额外硬剪 |
| 泛称 alias 桶爆炸 | `aliasBucketMax` 默认 12，超过跳过该 alias 桶 |
| 时序惩罚 | 恒 ≤0；配置若给正数会被 clamp 到 0 |
| greyLow ≥ autoMerge | resolve 时自动压 greyLow = autoMerge − 0.05 |

---

## 10. 配置说明（可调参 · 召回 R / 准确率 P）

**所有**窗大小、overlap、硬规则开关、打分权重、阈值均为配置项，**禁止**在算法代码里写死魔法数（默认值集中在 `CHARACTER_COREF_DEFAULTS`）。

### 10.1 怎么配（三选一，优先级高→低）

| 方式 | 何时用 | 生效 |
|------|--------|------|
| **调用参数** `getCharacterCorefConfig({ windowChars: 4000 })` / `resolveCharacterCorefConfig(partial, settings)` | 测试、eval 脚本 | 当次调用 |
| **Admin UI / API** `PATCH /api/admin/settings` → `data/runtime-settings.json` | 线上调参不重启 | **立即**（下一 job） |
| **环境变量** `CHARACTER_COREF_*`（见 `.env.example`） | 部署默认 | 进程启动时读入 env 层 |

Admin GET `/api/admin/settings` 返回 `docs.coref`（每项 label/hint/**impact**）与 `corefResolved`（归一化后实际值）。

代码入口：

```ts
import { getCharacterCorefConfig } from "@/lib/runtime-settings";
// 或
import { resolveCharacterCorefConfig } from "@/lib/character-coref-config";

const cfg = getCharacterCorefConfig(); // windowChars, autoMergeThreshold, …
// ① 切窗已接：buildOverlapScanUnits / buildNameScanUnits 默认读 cfg.windowChars / overlapChars
```

### 10.2 参数一览 · 默认 · 对 R/P 的影响

符号：**R↑** 召回升（少漏合）· **P↑** 准确率升（少误合）· **cost↑** LLM/算力升。

#### A. 切窗（①，影响 overlap 主消解 + 共现粒度）

| 配置键 / env | 默认 | 调大 | 调小 |
|--------------|------|------|------|
| `windowChars` / `CHARACTER_COREF_WINDOW_CHARS` | 6000 | 同窗角色更全、共现密；单次扫名贵；窗内假合风险 **P↓** | 漏边界角色 **R↓**；窗数↑ **cost↑** |
| `overlapChars` / `CHARACTER_COREF_OVERLAP_CHARS` | 800 | 跨窗 mention 更易落 O → ② 合并 **R↑**；窗数↑ **cost↑** | overlap 链断 → 残差压力↑ |

#### B. 阈值分流（第3级）

| 配置键 / env | 默认 | 调大 | 调小 |
|--------------|------|------|------|
| `autoMergeThreshold` / `…_AUTO_MERGE_THRESHOLD` | 0.85 | 少自动合 **P↑ R↓**，灰区 **cost↑** | 多自动合 **R↑ P↓** |
| `greyLowThreshold` / `…_GREY_LOW_THRESHOLD` | 0.45 | 少直接拒、多灰 **cost↑ R微↑** | 多拒 **R↓**；须 **&lt; autoMerge** |

#### C. 打分权重与修正

| 配置键 / env | 默认 | 影响 |
|--------------|------|------|
| `weightExclusive` / `…_WEIGHT_EXCLUSIVE` | 0.5 | ↑强调「绑死配角」；独特共现同人 **R↑**，路人共现 **P↓** |
| `weightJaccard` / `…_WEIGHT_JACCARD` | 0.3 | ↑看重朋友圈重叠；大场面假高分 **P↓** |
| `jaccardSparseMinCount` / `…_JACCARD_SPARSE_MIN_COUNT` | 3 | ↑更易触发稀疏打折 → **P↑**，弱证据 **R↓** |
| `jaccardSparseDiscount` / `…_JACCARD_SPARSE_DISCOUNT` | 0.5 | ↓折扣更狠 **P↑** |
| `temporalHighOverlap` / Mid / penalties | 0.8 / 0.2 / 0, −0.05, −0.2 | 惩罚只 ≤0；重罚远距 → 跨卷同人靠别名/灰区（**R↓** 若无 C），放宽惩罚 → 远距假合 **P↓** |

#### D. 候选通道

| 配置键 / env | 默认 | 影响 |
|--------------|------|------|
| `chunkGapMax` / `…_CHUNK_GAP_MAX` | 10 | 仅剪**共现**通道；↑更远候选 **R↑ cost↑ P微↓**；↓漏远距共现 |
| `aliasHardMergeMin` / `…_ALIAS_HARD_MERGE_MIN` | 2 | =1 单别名硬合 **R↑ P↓**（封号污染）；=3 更谨慎 **P↑ R↓** |
| `aliasBucketMax` / `…_ALIAS_BUCKET_MAX` | 12 | 防「队长」桶爆炸 **P↑ cost↓**；0=不限 |
| `greyContextChars` / `…_GREY_CONTEXT_CHARS` | 200 | ↑灰区更准 **cost↑**；↓易不确定→默认拒 **R↓** |

#### E. 硬规则开关

| 配置键 / env | 默认 | 关时 |
|--------------|------|------|
| `hardRejectSameUnit` | true | 同场两人可误合 **P↓** |
| `hardRejectGenderConflict` | true | 靠打分/LLM，缺字段本就跳过 |
| `hardRejectAgeConflict` | true | 年龄噪声多时可关以免误拒 **R↑ P↓** |
| `hardMergeSameFullName` | true | 关则同名只靠共现/别名；重名异人书可关 |

### 10.3 调参建议（产品姿态）

| 目标 | 倾向 |
|------|------|
| **少误合（名单干净）** | ↑ `autoMergeThreshold`（如 0.9）；保持同块/性别硬拒；`aliasHardMergeMin=2`；`aliasBucketMax≤12` |
| **少漏合（长书异名）** | ↑ `overlapChars`；↓ `autoMergeThreshold` 或放宽 `temporalPenaltyLow`；`chunkGapMax` 略↑；依赖通道 C + 灰区 |
| **控 LLM 成本** | ↑ `autoMergeThreshold` 且 ↓ 灰带宽（抬 `greyLow`）；↓ `greyContextChars`；收紧 `chunkGapMax` / `aliasBucketMax` |

Eval：改参后用 `scripts/eval/run-book-character-eval.ts` 对比 gold 召回；误合需人工 spot-check 名单行数与双挂。

---

## 11. 变更记录

| 日期 | 内容 |
|------|------|
| 2026-07-22 | 四级结构初稿 |
| 2026-07-22 | 属性来自①；别名交集不含 name；专属/Jaccard/时序公式与权重；解释配对入口 |
| 2026-07-22 | 候选对：倒排索引 + chunk 位置剪枝（chunk=window）；无共同邻居不比 |
| 2026-07-22 | **通道 C：全局别名索引**——共享任一 alias 强制进 P；不经共现、不做 gap 剪枝；仅 alias 对强制灰区 LLM（防 score 误杀） |
| 2026-07-22 | **§9 实现拍板 + §10 全量可配置**（env / admin / 调用参数）；R/P 影响表；`character-coref-config.ts` |
