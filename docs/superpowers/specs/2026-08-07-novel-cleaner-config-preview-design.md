# Spec: 小说清洗 — 可配置规则 + 预览确认

**Status:** Approved for implementation (not yet merged)  
**Date:** 2026-08-07  
**Approved:** 2026-08-07（默认拍板按本文 §2 / §13）  
**Prior art:** worktree `.worktrees/feat-novel-cleaner` · branch `feat/novel-cleaner` · `4dff502`  
**Related:** `src/lib/runtime-settings.ts`（Admin 运行配置先例）、`src/app/api/novel/parse/route.ts`（上传入口）

---

## 0. 问题

下载站 TXT 常夹杂：

- 整行/行内 URL 与域名  
- 「请记住本站」「求月票」「上一章|下一章」等导航/催更  
- 每章首尾重复水印  

现有 worktree 实现（`novel-cleaner.ts`）提供 **L1 规则 + L2 章间统计 boilerplate**，但存在产品缺口：

| 缺口 | 说明 |
|------|------|
| 规则写死源码 | 改正则要 rebuild / 发版 |
| 黑箱 | 上传即永久清洗，用户看不到删了什么 |
| 误伤难纠 | 无预览、无「本趟跳过某规则/某行」 |
| 仅上传路径 | 已入库书无法再洗 |

**本设计不立刻合入 `feat/novel-cleaner`**，而是定义可发版的配置与预览形态；内核可复用该 worktree 的算法。

---

## 1. 目标与非目标

### 1.1 目标（v1）

1. **可配置清洗规则**（正则与 L2 阈值），**无需改源码 rebuild**（Admin 写盘立即生效）。  
2. **预览机制**：展示将删除的内容样例与统计，用户确认后再 apply。  
3. **导入流**与**已有书重洗**共用同一套 `cleanNovelText(config)`。  
4. **保守默认**：出厂预设与现 worktree 相当；高删除比例时 UI 警告。  
5. **可观测**：stats + 分类删除明细，便于调规则。

### 1.2 非目标（v1）

- LLM 智能去广告  
- 清洗 IF 分支正文历史的完整 diff 版本树（v1 可只写 main 或「另存为清洗副本」）  
- 前端本地完整正则引擎（规则执行仍在服务端）  
- 多租户「每用户一套规则」（v1 全局；user override 可后置）  
- 自动回洗所有历史小说  

---

## 2. 决策摘要

| 决策 | 选择 | 理由 |
|------|------|------|
| 配置存放 | `data/runtime-settings.json` 的 `novelClean` 段 + 代码内 defaults | 与 coref/mention 运行配置一致；Admin 已有 PATCH 通道 |
| 配置粒度 | 全局（整站） | v1 够用；实现简单 |
| 规则形态 | 字符串正则数组 + 站名列表 + 开关 | 运营可改；服务端 compile 校验 |
| 预览 | 只读 API，不写库 | 安全；可反复试跑 |
| 确认 | 显式 apply / import 勾选 | 避免静默毁文 |
| 删除可见性 | 分类样例 + 可选行号/前后文，不默认回全文 diff | 大文件友好 |
| 用户可否决 | 预览结果支持「本趟排除某些 pattern / 某些行 key」 | 平衡 L2 误伤 |
| 与 fingerprint | apply / 导入时用**清洗后**文本算 fingerprint | 同一脏书稳定 id |

---

## 3. 架构

```text
                    ┌─────────────────────────────┐
                    │  NovelCleanConfig             │
                    │  defaults + runtime-settings  │
                    └──────────────┬────────────────┘
                                   │
┌──────────────┐    preview/apply  │
│ Admin UI     │───────────────────┤
│ 规则编辑/试跑 │                   ▼
└──────────────┘         ┌─────────────────────┐
                         │ cleanNovelText()     │
┌──────────────┐         │ L1 rules + L2 stats  │
│ 上传 / 重洗 UI│─preview─┤ 返回 text + report   │
│              │─apply──►└──────────┬──────────┘
└──────────────┘                    │
                         apply: import / 覆写正文
```

| 单元 | 职责 |
|------|------|
| `src/lib/novel-clean-config.ts` | defaults、resolve、正则 compile、校验 |
| `src/core/parser/novel-cleaner.ts` | 纯函数清洗（读 ResolvedConfig） |
| `GET/PATCH /api/admin/settings` 扩展 或 ` /api/admin/novel-clean` | 读写配置 |
| `POST /api/novel/clean/preview` | 只读预览 |
| `POST /api/novel/clean/apply` | 确认写入 |
| `POST /api/novel/parse` | 可选 `clean: true` 或默认 preview-first 产品流 |
| Admin「小说清洗」页 | 编辑规则 + 粘贴试跑 |
| 上传组件 | 预览 → 确认导入 |

---

## 4. 配置模型

### 4.1 Schema（逻辑）

```ts
interface NovelCleanConfig {
  /** 总开关；false 时 clean 为 no-op（仍可返回 empty stats） */
  enabled: boolean;

  // ── L1 ──
  stripZeroWidth: boolean;
  stripInlineUrls: boolean;
  stripLineUrls: boolean;
  stripNavLines: boolean;
  collapseBlankLines: boolean;

  /**
   * 整行广告正则（源字符串，不含 /flags/ 包裹）。
   * 服务端 new RegExp(s, "i") 或配置 flags。
   */
  lineAdPatterns: string[];
  /** 站名：用于「短行水印」判定，非全文搜索删除 */
  siteNames: string[];
  /** 导航行：整行匹配的 token 正则片段或完整行模式 */
  navLinePatterns: string[];
  /** 行内 URL / www 正则（可选覆盖默认） */
  inlineUrlPatterns: string[];
  lineUrlPatterns: string[];
  lineDomainPatterns: string[];

  // ── L2 ──
  statistical: boolean;
  boilerplateChapterRatio: number;   // default 0.3
  boilerplateMinChapters: number;    // default 3
  boilerplateMaxLineLen: number;     // default 80
  marginLineCount: number;           // default 5

  // ── 安全 ──
  /** 删除比例 ≥ 此值时 preview 打 warning（不阻断）；default 0.15 */
  warnRemoveRatio: number;
  /** 删除比例 ≥ 此值时 apply 需 force=true；default 0.35 */
  blockRemoveRatio: number;
}
```

### 4.2 优先级

与 coref 一致：

```text
调用参数 (preview body / apply body overrides)
  > data/runtime-settings.json（Admin 持久化）
  > 环境变量（可选 NOVEL_CLEAN_* 粗开关）
  > 代码内 DEFAULTS（与 feat/novel-cleaner 出厂行为对齐）
```

### 4.3 正则安全

- 保存前 **compile 校验**；失败返回 400 + 行号。  
- 禁止 `eval`；仅 `new RegExp(source, flags)`。  
- **ReDoS 防护（v1 最低）**：  
  - 单条 source 长度上限（如 200）  
  - 单次匹配超时可选（v1 可先超时整次 clean 如 5s）  
  - 不接受用户上传任意 flags 的 `g` 以外组合时可默认 `i` only  
- 配置变更写日志：`[novel-clean] config updated by admin version=…`  

### 4.4 与 runtime-settings 集成

**推荐 A（优先）：** 扩展 `RuntimeSettings`：

```ts
// RuntimeSettings 增加
novelClean?: Partial<NovelCleanConfig> | NovelCleanConfig;
```

Admin 现有「运行配置」增加折叠面板「小说清洗」。

**备选 B：** 独立文件 `data/novel-clean-config.json` + 独立 Admin API。  
仅当配置体积很大、不想污染 coref 面板时采用。

**拍板建议：A。** 运维心智统一。

---

## 5. 清洗报告（Preview / Apply 共用）

```ts
type CleanRemoveCategory =
  | "url_line"
  | "url_inline"
  | "nav"
  | "ad_line"
  | "site_watermark"
  | "boilerplate"
  | "zero_width"
  | "blank_collapse";

interface CleanRemovedSample {
  category: CleanRemoveCategory;
  /** 被删原文行（截断，如 200 字） */
  line: string;
  /** 1-based 行号（相对输入文本）；无法定位可省略 */
  lineNo?: number;
  /** 命中的规则 id 或 pattern 摘要 */
  rule?: string;
  /** 前后文各 ≤80 字，帮助判断误伤 */
  contextBefore?: string;
  contextAfter?: string;
}

interface CleanReport {
  stats: {
    originalLength: number;
    cleanedLength: number;
    removedChars: number;
    removeRatio: number;
    urlsStripped: number;
    adLinesDropped: number;
    navLinesDropped: number;
    zeroWidthRemoved: number;
    boilerplateLinesDropped: number;
    blankCollapsed: boolean;
  };
  /** 去重后的 boilerplate 代表句（≤20） */
  boilerplatePatterns: string[];
  /** 分类样例，每类最多 N 条（默认 30，请求可调 maxSamples） */
  removedSamples: CleanRemovedSample[];
  warnings: string[];  // e.g. "删除比例 22% 超过建议阈值 15%"
  configFingerprint: string; // hash of resolved config for apply 对齐
}
```

`cleanNovelText` 返回：

```ts
{ text: string; report: CleanReport }
```

（可由现有 `stats` 升级为 `report`，兼容字段保留。）

---

## 6. API

### 6.1 `POST /api/novel/clean/preview`

**Auth：** 登录用户（与 parse 同级 rate limit）。

**Body（三选一输入）：**

```json
{
  "text": "可选，直接文本（有长度上限，如 2MB）",
  "novelId": "可选，从主线/指定分支读全文",
  "branchId": "默认 main",
  "configOverride": { },
  "excludePatterns": ["可选：本趟忽略的 rule 摘要或 pattern"],
  "excludeLineKeys": ["可选：normalize 后的行 key，本趟不删"],
  "maxSamples": 30
}
```

**行为：**

1. Resolve config（merge override）。  
2. 跑 clean（不写库）。  
3. 返回 `{ cleanedPreview, report }`。  
   - `cleanedPreview`：全文或截断策略——**小书全文；大书返回 head+tail 或「仅 stats+samples」+ 可选 `previewMode`**。  
   - **拍板：** v1 对 ≤500KB 返回全文 cleaned；更大只返回 report + 各 2KB head/tail cleaned，避免 API 爆。

**不**改 fingerprint、不写 SQLite。

### 6.2 `POST /api/novel/clean/apply`

**Auth：** 小说 owner（或当前 userId 名下 novel）。

**Body：**

```json
{
  "novelId": "必填（已有书）或与 import 联动",
  "branchId": "默认 main",
  "configFingerprint": "必填，须与最近 preview 一致",
  "excludePatterns": [],
  "excludeLineKeys": [],
  "force": false,
  "mode": "overwrite_branch" | "import_new"
}
```

**行为：**

1. 重新 resolve config；fingerprint 不一致 → 409，要求重新 preview。  
2. 读原文 → clean → 若 `removeRatio >= blockRemoveRatio` 且 `!force` → 409。  
3. `overwrite_branch`：覆写该分支全文（main 则同步 novels 表正文策略与现有 branch 模型一致）。  
4. 重算 fingerprint：**注意** 若 id 随内容变，需定义迁移——见 §8。  
5. 返回新 `totalLength` + report。

### 6.3 上传流改造（parse）

**产品二选一（建议 B）：**

| 方案 | 流程 |
|------|------|
| A. 默认自动洗 | parse 内 clean，响应带 cleanStats（现 worktree） |
| **B. 预览优先** | 前端：选文件 → 先 preview（FormData text）→ 用户确认 → parse 带 `applyClean: true` 或先 clean 再 parse |

**拍板建议：B 为主，A 为高级选项「信任默认规则，直接导入」。**

`parse` body/FormData 增加：

- `applyClean`: `"1"` | `"0"`（默认 UI 为确认后 true）  
- `excludeLineKeys` / `configFingerprint` 可选  

### 6.4 Admin 配置

- `GET /api/admin/settings` 响应含 `novelClean` effective + defaults。  
- `PATCH` 可更新 `novelClean` 字段；非法正则 400。  
- Admin 页试跑：粘贴样例 → 调 preview（admin 可用更长 timeout）。

---

## 7. UI

### 7.1 上传（NovelUpload）

```text
[选择文件]
    ↓
解析编码 / 读文本（客户端或服务端 temp）
    ↓
[预览清洗] → 展示 stats + 删除样例列表（可按类别筛选）
    ↓  删除比过高 → 黄色警告
[ ] 应用清洗后导入     [直接导入不清洗]
    ↓
确认 → parse/import
```

样例行可勾选「保留此行」（写入 `excludeLineKeys` 再 preview 一次）。

### 7.2 已有书

小说设置或 overview：「清洗下载站杂质」

- 选 branch（默认 main）  
- preview → apply  
- 文案明确：**将改写该分支正文**

### 7.3 Admin

- 表格编辑 `lineAdPatterns` / `siteNames`  
- 「恢复出厂 defaults」  
- 试跑框  

---

## 8. Fingerprint 与数据一致性

清洗改变正文字符串 → `novelFingerprint` 变化 → 与「同一书」缓存冲突。

**策略（拍板）：**

| 场景 | 行为 |
|------|------|
| **新导入** | fingerprint(清洗后)；自然新 id |
| **已有书 apply** | **保持 novelId 不变**，只更新 branch 正文与 length；不因清洗换 id |
| **用户选「另存为新书」** | 可选 mode=import_new，用清洗后 fingerprint |

已有书 apply **不得** 因清洗改变 novelId（否则角色/分析/分支全断）。

---

## 9. 算法层（复用 worktree）

保持两层：

1. **L1** 规则：零宽、URL、nav、ad regex、站名水印、行内 URL、空行。  
2. **L2** 统计：章首尾 margin 高频短行。  

改造点：

- 所有硬编码 `LINE_AD_RES` / `LINE_SITE_NAME_RE` 等改为 **从 ResolvedConfig 编译**。  
- 删除时写入 `removedSamples`（采样，非全量）。  
- 支持 `excludeLineKeys`：normalize 后命中则跳过删除。  
- 支持 `excludePatterns`：本趟跳过某些 ad 规则。

**章节标题检测** 仍用轻量 regex（与 form 模块解耦），避免循环依赖。

---

## 10. 安全与配额

- preview/apply/parse 共用 rate limit（可单独桶 `novel_clean`）。  
- 单次 text 上限与 parse 一致（如 5MB；admin/debug 可放宽）。  
- apply 仅能操作 `userId` 拥有的 novel。  
- 配置 PATCH 仅 admin。  

---

## 11. 测试计划

| 用例 | 期望 |
|------|------|
| defaults 行为 ≈ feat/novel-cleaner 单测 | 现有 novel-cleaner.test 迁移后仍绿 |
| 非法正则 PATCH | 400 |
| preview 不改 DB | 行数/正文不变 |
| fingerprint 不一致 apply | 409 |
| removeRatio 过高无 force | 409 |
| excludeLineKeys | 该行保留 |
| 已有书 apply 保持 novelId | id 不变，length 变 |
| 幂等二次 clean | removedChars≈0 |
| 干净书 | removeRatio 极低、无误删 |

---

## 12. 分 PR 实施顺序

| PR | 内容 | 可合并条件 |
|----|------|------------|
| **PR1** | `novel-clean-config` + defaults + resolve + 校验；cleaner 读 config（无 UI） | 单测绿 |
| **PR2** | `preview` API + report 结构；Admin 试跑可选 | 手工 curl 验证 |
| **PR3** | 上传 UI 预览确认；parse `applyClean` | 导入路径 E2E |
| **PR4** | apply 已有书；Admin 规则编辑持久化 | 文档 + 测试 |
| **PR5（可选）** | 排除行交互、高删除 force 流程打磨 | 产品验收 |

**不**把当前 worktree 无配置黑箱版直接合 master。

---

## 13. 开放问题（需产品拍板处已给默认）

| # | 问题 | 默认建议 |
|---|------|----------|
| 1 | 大文件 preview 是否返回全文 cleaned？ | ≤500KB 全文，否则 head/tail |
| 2 | apply 是否支持 IF 分支？ | v1 支持任意 branchId |
| 3 | 是否保留「一键信任默认、跳过预览」？ | 是，高级勾选 |
| 4 | 配置是否进 git？ | 否，仅服务器 `data/`；defaults 在代码 |
| 5 | L2 是否允许用户关闭？ | 是，config.statistical |

---

## 14. 成功标准

1. 运营改广告正则后 **无需 rebuild**，新 preview/import 立即生效。  
2. 用户导入前能看到 **将删除的样例与比例**，并确认。  
3. 误伤可通过 **排除行 / 关 L2 / 改规则** 缓解。  
4. 已入库书可重洗且 **novelId 稳定**。  
5. 干净文学文本删除量可忽略（回归测试约束）。

---

## 15. 附录：与 feat/novel-cleaner 的映射

| worktree | 本设计 |
|----------|--------|
| `LINE_AD_RES` 硬编码 | `lineAdPatterns` 配置 |
| `LINE_SITE_NAME_RE` | `siteNames[]` |
| L2 常量阈值 | config 字段 |
| parse 内静默 clean | preview → apply / applyClean |
| 仅 stats | 升级为 `CleanReport` + samples |
| 无 Admin | runtime-settings + Admin 面板 |

内核函数签名演进：

```ts
// 现 worktree
cleanNovelText(text, options?) → { text, stats }

// 目标
cleanNovelText(text, {
  config?: Partial<NovelCleanConfig>,  // 覆盖
  excludeLineKeys?: string[],
  excludePatterns?: string[],
  maxSamples?: number,
}) → { text, report: CleanReport }
```
