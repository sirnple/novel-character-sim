# 公共文学 gold（从维基下载）

**来源：中文维基百科角色列表页**，由脚本拉取 HTML 并抽取人名。

```bash
# 重新下载 / 刷新
npx tsx scripts/eval/download-wiki-character-gold.ts
```

生成物含：

- `source`: `"wikipedia-download"`
- `sourceUrl`: 维基条目 URL  
- `fetchedAt`: 下载时间  
- `_download-manifest.json`: 本次下载摘要  

**不绑定**你本机 `novels.db`。导入正文后复制到上级目录并改 `id` 再评测。

## 当前条目

| 文件 | 维基页面 |
|------|----------|
| `hongloumeng.json` | 红楼梦角色列表 |
| `sanguoyanyi.json` | 三国演义角色列表 |
| `xiyouji.json` | 西游记角色列表 |
| `shuihuzhuan.json` | 水浒传角色列表 |
| `santi.json` | 三体系列角色列表 |
| `liulang-diqiu-novel.json` | 流浪地球_(小说) |

## 使用

```bash
cp scripts/eval/character-gold/public/santi.json scripts/eval/character-gold/santi.local.json
# 编辑 id → novel_xxx，按版本裁剪 mustFind
npm run eval:characters
```

`eval:characters` 默认**不**递归 `public/`（避免未导入时全 SKIP）。

## 许可与局限

- 维基正文 CC BY-SA；此处只存**人名列表**供评测。  
- 自动抽取会有噪声，**导入后建议人工过一遍 mustFind**。  
- 不是学术双人标注金标，但是**可复现的公开来源**，不是凭记忆编造。
