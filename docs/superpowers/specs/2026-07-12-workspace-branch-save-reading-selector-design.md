# Spec B — Workspace 主线保存走分支 + novels.text 退场 + READING 分支选择器

## 背景

Spec A 已让每部小说入库时即落一行 `branches`（id=`"main"`、name=`"主线"`、text=`novels.text`）代表主线分支。但当前 workspace 的 3 条读写路径仍直接依赖 `novels.text`：

1. **写入** — Writer/Save：主线保存走 `appendNovelContent` → 追加到 `novels.text`。
2. **写作流** — Simulation/Stream：`getNovel(userId, novelId).text` 作为前文写进 prompt。
3. **阅读** — /api/novels GET：返回 `novels.text` 作读者全文。

Spec B 把这三条路径全部改为从 `branches` 表读主线分支（或用户指定分支）。改造后 `novels.text` **不再写**，仅保留为导入原件（此后不受续写追加影响）。分支成为正文唯一权威。

## 架构

### 数据流（改后）

```
WRITER-SAVE（workspace 保存）
   saveTarget="main" → POST /api/writer/save {novelId, content, branchId="main"}
     → appendBranchContent(userId, novelId, "main", content)
     → getBranch(userId, novelId, "main") → fullText

SIMULATION-STREAM（写作流生成）
   workspace 创建 task 时 → POST /api/simulation/stream {..., branchId: activeBranchId}
     → getBranch(userId, novelId, branchId).text → 前文写进 prompt
     → 生成 prose 结果

READING（阅读页）
   页加载 → GET /api/novels?novelId=X&branchId=main → fullText=main branch.text
   分支选择器切分支 → GET /api/novels?novelId=X&branchId=IF-id → fullText=IF branch.text
```

### novels.text 退场策略

- `getNovel` 保留，novel 元数据（title/id）仍需要
- `appendNovelContent` 标记 **deprecated**，不再被任何路径调用；保留实现以备降级但注释"deprecated"
- `novels.text` 列留在表中（导入源），规格 B 以后不再有代码追加到它

## 组件改动清单

### `src/lib/db.ts`

- `appendNovelContent` 上方加 `/** @deprecated — use appendBranchContent(userId, novelId, "main", content) instead */`。
- 不需要新增函数——`appendBranchContent` / `getBranch` 已在 Task 1 加了 `novelId` 入参。

### `src/app/api/writer/save/route.ts`

- 移除 `import { appendNovelContent, getNovel }` 的导入（`getNovel` 如果不再用也移除）。
- 主线分支（第 33-36 行）改为：

```ts
    // Main text save — now writes to the main branch (id="main")
    appendBranchContent(userId, novelId, "main", content);
    const updated = getBranch(userId, novelId, "main");
    return NextResponse.json({ success: true, fullText: updated?.text || "" });
```

- 当前第 22 行的 `appendBranchContent(userId, branchId, content)` 补 `novelId` 入参：`appendBranchContent(userId, novelId, branchId, content)`。第 29 行 `getBranch(userId, id)` 补 `getBranch(userId, novelId, id)`。

### `src/app/api/novels/route.ts`

- GET 加取 `branchId` query 参数，略省为 `"main"`（默认主线分支）：

```ts
  const id = request.nextUrl.searchParams.get("id");
  const branchId = request.nextUrl.searchParams.get("branchId") || "main";

  if (id) {
    const branch = getBranch(userId, id, branchId);
    if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    const storyInfo = getStoryInfo(userId, id);
    const characters = getCharacters(userId, id);
    const novel = getNovel(userId, id); // for title
    return NextResponse.json({ id, title: novel?.title || "", text: branch.text, storyInfo, characters });
  }
```

- `import` 加 `getBranch, ensureMainBranch` 来自 `@/lib/db`（`getNovel` 保留）。
- 可容错：如果 branchId="main" 且分支不存在 → `ensureMainBranch(userId, id)` 后重试。

### `src/app/api/simulation/stream/route.ts`

- 现有 `const dbNovel = getNovel(userId, novelId)` 改为读对应的分支（第 84-89 行）：

```ts
      const { branchId } = body;
      const effectiveBranchId = branchId || "main";
      const dbBranch = getBranch(userId, novelId, effectiveBranchId);
      if (dbBranch) {
        dbNovelText = dbBranch.text;
        dbStoryInfo = getStoryInfo(userId, novelId);
        dbTimeline = getTimeline(userId, novelId);
        debugLog("StreamRoute", `Branch loaded: id=${effectiveBranchId}, text=${dbNovelText.length}chars`);
      } else {
        debugLog("StreamRoute", `Branch NOT FOUND novelId=${novelId} branchId=${effectiveBranchId}`);
      }
```

- `import` 加 `getBranch`（`ensureMainBranch` 不需——若 main 不存在由 DB 兜底建好）。

### `src/components/writing-workspace.tsx`

- `handleSaveFromDialog`（第 466-473 行）里主线保存新增 `branchId: "main"`：
  - line 466 `const body: any = { novelId, content: outputText };` 改为：
  ```ts
  const body: any = { novelId, content: outputText, branchId: saveTarget === "main" ? "main" : (saveBranchId || undefined) };
  ```
  支线保持不变（`fillId` 为 `saveBranchId`）。

- Simulation body（第 390-403 行）新增 `branchId` 字段：从 `useNovel().activeBranchId` 或从 write page 的 `activeBranchId` prop 取。解构 `const { ..., activeBranchId } = useNovel();` 加 `branchId: activeBranchId || "main"`。

### `src/app/novel/[id]/read/page.tsx` — 阅读分支选择器

- 页面顶部从 `useNovel` 解构加 `branches` 和 `activeBranchId`，本地加 state `const [selectedBranchId, setSelectedBranchId] = useState<string>(activeBranchId || "main")`。
- 加载和切分支时分发 `GET /api/novels?novelId=X&branchId=selectedBranchId` ——拿到 `{ text }` 后 set 本地全文 state（`const [readingText, setReadingText] = useState(novelText)`）并用 `readingText` 渲染全文。
- 页面顶部 header (约 40 行) 加分支选择器：显示当前分支名、点击弹下拉列出所有分支（`branches` 列表 + 主线 "主线"）。
- 可选：切分支后更新 URL query `?branchId=` 方便分享。

## 错误处理

- 保存时 main 分支不存在 → `appendBranchContent` 里的 getBranch 返回 undefined 不续（不崩）。应兜底：先调 `ensureMainBranch(novelId)` 再 append。写进 `writer/save/route.ts`。
- stream 时分支不存在 → `dbNovelText` 为空，引擎拿空 text 写出正文行为未变（原版同理）。
- READING 时分支不存 → 回退主线并提示"分支未找到"。

## 测试

- 旧小说（有 novels.text 但无 main 分支）→ WRITING 主线保存 → `ensureMainBranch` 兜底 → main 分支获取最新的 append 正文 ✓；READING 页选中 main 能看见正文 ✓。
- 新建小说（在 spec A 之后导入）→ main 分支已有初始文本 → WRITING 保存走 appendBranch → getBranch 能正确反映正文更新。
- 分支选择器：读页选 IF 线分支 → GET /api/novels?vovelId=X&branchId=IF-id → 返回 IF 分支正文；读主线选回 main。
- Simulation：写区选 IF 线后触发生成 → stream body {branchId: IF-id} → getBranch(IF) → prompt 前文为该分支文本 ✓。

## 范围外

- novels.text 完全删列不在此 spec（可能永久保留作导入源）。
- 其它端调用 `getNovel` 改 `getBranch` 之类的全部走不改（`/api/novels` list 仍用 novels 表元数据）。
- Agent panel 的分支绑定已在 Spec A 完成。本 spec 只改 workspace 的后端读写路径。

## 风险

- 旧数据中某些小说 novels.text 已与 main 分支不同步（Spec A 落地后开始每次 create 同步）。Spec B 落地后首次读可能看到"起点原本"而非累积续写——首次 ensureMainBranch synced 只在 import 时触发。solution：写入路径加 `ensureMainBranch` 兜底。
- `novels.text` 是很多别的 DB 函数的输入源头（如 extractor 的 chunking），但这些不算 Spec B scope；本 spec 假设 novels.text 仍存且依然 read-only。