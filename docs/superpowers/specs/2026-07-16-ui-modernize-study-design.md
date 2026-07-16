# Spec — 深夜书房 UI 重塑（UI Modernize · Late Night Study）

**日期**: 2026-07-16  
**状态**: 已批准，待实现  
**分支 / Worktree**: `feat/ui-modernize` · `.worktrees/feat-ui-modernize`  
**相关决策**: 用户确认深度=视觉重塑、气质=深夜书房、结构=双层界面（暖深色外壳 + 纸面正文区）

---

## 1. 问题

当前前端可读性与「写作产品」气质不足：

| 现象 | 原因 |
|------|------|
| 字偏小、挤、难扫读 | 大量 `text-[9px]` / `text-[10px]` / `text-[11px]` / `text-xs` 作主文案 |
| 中文像「宋体 UI」、空间利用率差 | 未加载中文 Web 字体；UI 大量 `font-mono`，中文回落系统宋体/等宽感 |
| 终端 / IDE 感强 | 近黑 `#0a0a0a` + 冷中性 + 全大写 mono 英文标签 |
| 长文与工具区混为一谈 | 阅读/生成正文没有独立纸面层级，对比与行高未为中文优化 |

目标用户：长时间阅读与续写中文小说的创作者。产品第一任务是**舒服地读与写**，其次才是 Agent / 库管理。

---

## 2. 已确认决策

| # | 决策 | 选择 |
|---|------|------|
| D1 | 改版深度 | **C · 视觉风格重塑**（非仅抬字号） |
| D2 | 气质 | **A · 深夜书房**（暖深色、纸感阅读、琥珀/朱砂强调） |
| D3 | 界面结构 | **A · 双层**：外壳/侧栏/工具栏暖深色；阅读与成稿正文区暖纸色 |
| D4 | 落地路径 | **Design Tokens 驱动**（globals + Tailwind + 语义 class），不全量抽组件库 |
| D5 | 主题切换 | **本期不做** 明暗切换 |
| D6 | 业务逻辑 | **不改** API / 状态机 / Agent 行为 |
| D7 | Admin | 只继承全局字体与 CSS 变量底色；不单独做 Admin 视觉大改 |

---

## 3. 目标与非目标

### 目标

1. 引入现代中文无衬线 UI 字体；纸面正文使用中文衬线，告别系统宋体作 UI 默认。  
2. 建立可读的字号阶梯：UI 正文 ≥14px，辅助 ≥12px；纸面正文 17–18px、行高约 1.85–2.0。  
3. 中文 UI 文案不再使用 `font-mono`；mono 仅保留给代码、JSON、ID、调试类内容。  
4. 统一「深夜书房」色板与圆角/边框 token，替换散落的 `bg-[#0…]` / 冷灰边框。  
5. 阅读页、写作成稿输出区呈现清晰纸面「稿纸」区块（圆角、轻阴影、与深色外壳分离）。  
6. 侧栏与顶栏更人性化：触控高度、列表间距、中文品牌文案优先。

### 非目标

- 明/暗主题切换、用户可配置字号  
- 完整 UI 组件库（Button/Card 抽象层）重写  
- 改路由结构、功能增删、Agent 协议  
- 像素级复刻某个外部产品  
- 全面重写 Admin 后台信息架构  

---

## 4. 设计系统

### 4.1 字体

| 角色 | 字体栈 | 用途 |
|------|--------|------|
| **UI** (`font-sans`) | `"Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif` | 导航、侧栏、按钮、表单、卡片说明 |
| **Prose** (`font-prose` / `.font-prose`) | `"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif` | **仅**纸面长文：阅读页正文、Novel 输出、写作结果展示 |
| **Mono** (`font-mono`) | `ui-monospace, "Cascadia Code", "SF Mono", Menlo, monospace` | 代码块、JSON、技术 ID、字数偏移等 |

加载方式：Next.js `next/font/google`（`Noto_Sans_SC` + `Noto_Serif_SC`）挂到 `layout.tsx` 的 `html`/`body`，经 CSS 变量接入 Tailwind。

### 4.2 字号阶梯（Tailwind 语义建议）

| Token / 用法 | 约等于 | 场景 |
|--------------|--------|------|
| `text-2xs`（若扩展）或 `text-xs` | 12px | 辅助标签、badge、次要 meta（**禁止更小作为可点文案**） |
| `text-sm` | 14px | 默认 UI 正文、侧栏列表、按钮 |
| `text-base` | 16px | 弹窗说明、表单输入 |
| `text-lg` | 18px | 页面标题 |
| `.prose-novel` | 17–18px / leading ~1.9 | 纸面正文 |

清理规则：删除或升级现有 `text-[9px]`、`text-[10px]`、`text-[11px]`；若确为 badge，至少 12px 或改为图标。

### 4.3 色板（HSL CSS 变量 + 命名）

实现时写入 `:root`（可同步覆盖现有 shadcn 风格变量，使 `bg-background` 等与新气质一致）。

| 名称 | 约值 | 角色 |
|------|------|------|
| **Ink** | `#14110f` | 应用外壳背景 |
| **Panel** | `#1c1816` | 顶栏、侧栏、深色卡片 |
| **Panel elevated** | `#241f1c` | 悬停/次级表面 |
| **Line** | `#3a322c` | 边框、分割线 |
| **Ember** | `#d4774a` | 主强调（按钮、链接、焦点环） |
| **Ember soft** | `rgba(212,119,74,0.12)` | 选中底、弱强调底 |
| **Mist** | `#a89f96` | 次要文字 |
| **Fog** | `#6f675f` | 更弱的 hint 文字 |
| **Snow** | `#f5f0e8` | 深色上的主文字 |
| **Paper** | `#f3ebe0` | 纸面背景 |
| **Ink-on-paper** | `#2a241f` | 纸面正文 |
| **Paper line** | `#e0d4c4` | 纸面内边框/分隔 |

语义映射建议：

- `--background` → Ink  
- `--card` → Panel  
- `--primary` / `--accent` / `--ring` → Ember  
- `--muted-foreground` → Mist  
- `--border` → Line  
- 新增：`--paper`、`--paper-foreground`、`--panel`

### 4.4 形状与间距

| Token | 值 | 说明 |
|-------|-----|------|
| `--radius` | `0.75rem` | 卡片/弹窗略更圆润，书房感 |
| 纸面 | `rounded-xl` + 轻阴影 | 与外壳分离 |
| 列表行 | min-height ~40px | 侧栏可点行 |
| 页面水平 padding | `p-4 sm:p-6` 维持，纸面内 `px-6 sm:px-10 py-8` |

### 4.5 布局签名（Signature）

**「暖深色桌面 + 摊开的稿纸」**：

- 外壳始终 Ink/Panel  
- 凡「给人读的小说正文」进入 `.surface-paper`（或 `bg-paper text-paper-foreground font-prose prose-novel`）  
- 稿纸：有限宽（约 `max-w-3xl`～`max-w-[48rem]`）、居中、圆角、与两侧深色形成明确对比  

这是本改版唯一强烈视觉记忆点；其余控件保持克制，不做多余装饰纹理。

---

## 5. 范围与文件

### 5.1 基础设施（先做）

| 文件 | 改动 |
|------|------|
| `src/app/layout.tsx` | 加载 Noto Sans/Serif SC；body 类名切换到 token |
| `src/app/globals.css` | 重写 CSS 变量；`.surface-paper`、`.prose-novel`、滚动条适配暖深色 |
| `tailwind.config.ts` | `fontFamily`、`colors`（paper/ink/ember/panel）、可选 `fontSize.2xs` |

### 5.2 外壳与导航

| 文件 | 改动 |
|------|------|
| `src/components/app-shell.tsx` | 顶栏 Panel 色；品牌中文「小说工作台」；去 mono 标题；字号/触控 |
| `src/components/global-library-sidebar.tsx` | 列表密度、字号、选中 Ember soft、导入按钮 |
| `src/components/auth-bar.tsx` | 表单可读性、标签 ≥12px、去中文 mono |
| `src/app/page.tsx` | 空状态更友好、字号与文案层级 |

### 5.3 小说主流程

| 文件 | 改动 |
|------|------|
| `src/app/novel/[id]/page.tsx` | 概览标题/按钮/卡片 token 化 |
| `src/app/novel/[id]/read/page.tsx` | **纸面阅读区** + 工具条仍深色 |
| `src/app/novel/[id]/write/page.tsx` | 若有独立 chrome，对齐 token |
| `src/components/writing-workspace.tsx` | 成稿/输出区纸面；控件区深色；字号 |
| `src/components/novel-output.tsx` | 纸面 + prose 字体 |
| `src/components/markdown.tsx` | 在纸面上下文下的标题/段落样式 |
| `src/components/extract-modules-panel.tsx` 等概览相关 | token 与字号 |

### 5.4 工具面板（保持深色，抬可读性）

| 文件 | 改动 |
|------|------|
| `src/components/agent-panel.tsx` | 字号底线；中文去 mono；JSON/pre 保留 mono |
| `src/components/review-panel.tsx` | 同上 |
| 其他仍使用 `font-mono` + 过小字号的组件 | 批量替换规则见 §6 |

### 5.5 弹窗与次要

- 导入小说 modal（`app-shell` 内）  
- 登录/注册（`auth-bar`）  
- `library-detail-modal`、角色编辑等：统一边框/背景/字号  

### 5.6 显式排除

- `src/app/admin/**`：仅被动继承全局字体与变量，不做专门信息架构改版  
- API routes、`src/core/**`、DB  

---

## 6. 实现策略

### 6.1 顺序

1. **Token + 字体**（layout / globals / tailwind）— 立刻可见底色与字体变化  
2. **Shell + 侧栏 + 首页** — 第一印象  
3. **阅读页纸面** — 签名元素落地  
4. **写作工作区 + novel-output** — 成稿纸面  
5. **概览与其余面板** — 字号与硬编码色清理  
6. **Agent / Review** — 可读性底线，不破坏信息密度结构  
7. **扫尾**：全库搜 `text-[9px]`、`#0a0a0a`、`font-mono` 误用  

### 6.2 替换规则

| 旧模式 | 新模式 |
|--------|--------|
| `bg-[#0a0a0a]` / `#0c0c0c` / `#0e0e0e` | `bg-background` / `bg-card` / `bg-panel`（以 token 为准） |
| `border-neutral-800` | `border-border` 或 `border-line` |
| `text-orange-*` 主强调 | `text-primary` / Ember 系 |
| `font-mono` + 中文 UI 文案 | 去掉 mono；标题用 `font-sans font-semibold` |
| `text-[9px]`–`text-[11px]` | ≥ `text-xs`（12px）；主文案 `text-sm` |
| 阅读/输出纯 `text-neutral-*` 深色上长文 | 包一层 `.surface-paper` |

### 6.3 纸面挂载约定

以下必须使用纸面表面：

- 阅读页正文容器  
- 写作完成/预览中的长篇小说输出  
- `NovelOutput` 主展示区  

以下**不**使用纸面：

- Agent 对话气泡、工具日志  
- 侧栏列表  
- 表单、设置、模块勾选  

### 6.4 可访问性底线

- 可点控件字号 ≥12px，推荐 14px  
- 焦点环使用 Ember/`ring-primary`  
- 尊重 `prefers-reduced-motion`（若新增过渡）  
- 纸面正文对比：Ink-on-paper on Paper 需保持清晰（避免灰字）  

---

## 7. 验收标准

1. **字体**：UI 为 Noto Sans SC（或等价无衬线），非系统宋体；阅读正文为衬线纸面。  
2. **字号**：主流程界面无可读主文案小于 12px；纸面正文目测明显大于现 UI。  
3. **双层**：阅读页与成稿区视觉上是「纸」，外壳是「暖深色桌面」。  
4. **气质**：强调色为暖 Ember，无大面积冷纯黑终端感；品牌中文可读。  
5. **功能**：导入、打开小说、阅读、写作、侧栏库、登录弹窗交互与改前一致。  
6. **构建**：`npm run build` 通过；既有 `npm test` 通过。  
7. **无业务回归**：不改 API 契约与核心引擎。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 字体加载导致布局偏移 | `next/font` 自托管 + `display: swap`；固定主要字号 |
| 纸面在小屏过亮 | 纸面限宽、外边距保留 Ink；移动端减少双栏压迫 |
| Agent 面板抬字号后变长 | 保持折叠结构；仅抬正文与控件，不强制放大 pre 块 |
| 遗漏硬编码色 | 实现末尾全库 grep 扫尾 |
| 与未改浅色旧组件混搭 | 统一改到 token；若个别组件仍用 shadcn 浅色变量，通过 `:root` 变量一并变暖深色 |

---

## 9. 成功后的观感（一句话）

打开应用像走进一间暖灯深夜书房：工具在深色桌面上，小说正文摊在稿纸上；字够大、中文清爽，不再像写代码的终端。
