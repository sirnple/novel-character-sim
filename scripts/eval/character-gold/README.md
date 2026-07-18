# Character gold 目录说明

## 两类 gold

| 类型 | 位置 | 谁维护 | 绑定本地 DB？ |
|------|------|--------|----------------|
| **公共文学** | [`public/`](./public/) | 仓库/公共草稿 | **否**（导入正文后复制并改 `id`） |
| **你的书** | 本目录下 `"source": "user-owned"` 的 json | **你** | 是（`id` = novelId） |

## 你的书（示例，请你改 mustFind）

- `yunie-zhuoxin.json` — 欲孽灼心  
- `lvmao-wushen.json` — 绿帽武神  

## 公共文学（我准备的，在 public/）

红楼梦、三国演义、西游记、水浒传、三体、流浪地球（**小说版**人物）  
详见 [public/README.md](./public/README.md)。

## 跑评测

只评测**本目录一层**的 `*.json`（默认不扫 `public/`，避免未导入时全 SKIP）：

```bash
npm run eval:characters
```

把公共 gold 用于某次导入：

1. `cp public/santi.json ./santi.local.json`  
2. 把 `id` 改成库里的 novel id  
3. 按你导入的是第几部/是否删节 **裁剪 mustFind**  
4. `npm run eval:characters`  

## JSON 字段

见 `public/README.md` 或任一样例：`mustFind`、`aliasOf`、`tier`、`source`。
