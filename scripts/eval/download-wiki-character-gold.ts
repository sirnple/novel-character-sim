/**
 * Download character lists from Chinese Wikipedia → gold JSON.
 *
 *   npm run eval:download-wiki-gold
 *
 * Output: scripts/eval/character-gold/public/*.json
 *         scripts/eval/character-gold/public/_download-manifest.json
 *         scripts/eval/character-gold/public/_raw/<file>.names.txt  (full extract for audit)
 */
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(
  process.cwd(),
  "scripts",
  "eval",
  "character-gold",
  "public",
);
const RAW_DIR = path.join(OUT_DIR, "_raw");

interface WikiJob {
  file: string;
  id: string;
  title: string;
  tier: "short" | "long";
  wikiTitle: string;
  maxMustFind: number;
  notes?: string;
  /** Prefer these if present in extract (page order still used for rest) */
  prefer?: string[];
}

const JOBS: WikiJob[] = [
  {
    file: "hongloumeng",
    id: "public_hongloumeng",
    title: "红楼梦",
    tier: "long",
    wikiTitle: "红楼梦角色列表",
    maxMustFind: 35,
    prefer: [
      "贾宝玉",
      "林黛玉",
      "薛宝钗",
      "王熙凤",
      "贾母",
      "贾政",
      "王夫人",
      "贾琏",
      "贾赦",
      "贾珍",
      "贾探春",
      "贾迎春",
      "贾惜春",
      "贾元春",
      "史湘云",
      "妙玉",
      "秦可卿",
      "李纨",
      "薛蟠",
      "袭人",
      "晴雯",
      "平儿",
      "鸳鸯",
      "香菱",
      "刘姥姥",
      "贾环",
      "赵姨娘",
      "邢夫人",
      "尤氏",
      "贾蓉",
      "薛宝琴",
      "紫鹃",
      "香菱",
      "甄士隐",
      "贾雨村",
    ],
  },
  {
    file: "sanguoyanyi",
    id: "public_sanguoyanyi",
    title: "三国演义",
    tier: "long",
    wikiTitle: "三国演义角色列表",
    maxMustFind: 40,
    prefer: [
      "刘备",
      "关羽",
      "张飞",
      "诸葛亮",
      "赵云",
      "曹操",
      "孙权",
      "周瑜",
      "司马懿",
      "吕布",
      "貂蝉",
      "董卓",
      "袁绍",
      "孙策",
      "鲁肃",
      "黄忠",
      "马超",
      "魏延",
      "庞统",
      "姜维",
      "曹丕",
      "司马昭",
      "邓艾",
      "陆逊",
      "张辽",
      "张郃",
      "许褚",
      "典韦",
      "徐庶",
      "司马徽",
      "刘表",
      "刘璋",
      "孙坚",
      "黄盖",
      "甘宁",
      "太史慈",
      "貂蝉",
      "貂蟬",
    ],
  },
  {
    file: "xiyouji",
    id: "public_xiyouji",
    title: "西游记",
    tier: "long",
    wikiTitle: "西游记角色列表",
    maxMustFind: 35,
    prefer: [
      "孙悟空",
      "唐三藏",
      "唐僧",
      "猪八戒",
      "沙悟净",
      "沙和尚",
      "白龙马",
      "观音",
      "观音菩萨",
      "如来",
      "玉皇大帝",
      "太上老君",
      "牛魔王",
      "铁扇公主",
      "红孩儿",
      "白骨精",
      "金角大王",
      "银角大王",
      "二郎神",
      "哪吒",
      "东海龙王",
      "唐太宗",
      "菩提祖师",
      "混世魔王",
      "黄袍怪",
      "女儿国国王",
    ],
  },
  {
    file: "shuihuzhuan",
    id: "public_shuihuzhuan",
    title: "水浒传",
    tier: "long",
    wikiTitle: "水浒传角色列表",
    maxMustFind: 40,
    prefer: [
      "宋江",
      "卢俊义",
      "吴用",
      "公孙胜",
      "林冲",
      "鲁智深",
      "武松",
      "李逵",
      "史进",
      "柴进",
      "杨志",
      "花荣",
      "秦明",
      "呼延灼",
      "燕青",
      "时迁",
      "高俅",
      "蔡京",
      "晁盖",
      "王伦",
      "戴宗",
      "石秀",
      "杨雄",
      "阮小七",
      "阮小二",
      "阮小五",
      "朱仝",
      "雷横",
      "张顺",
      "李俊",
    ],
  },
  {
    file: "santi",
    id: "public_santi",
    title: "三体",
    tier: "long",
    wikiTitle: "三体系列角色列表",
    maxMustFind: 35,
    prefer: [
      "汪淼",
      "叶文洁",
      "史强",
      "丁仪",
      "杨冬",
      "叶哲泰",
      "绍琳",
      "申玉菲",
      "潘寒",
      "魏成",
      "常伟思",
      "麦克·伊文斯",
      "罗辑",
      "庄颜",
      "章北海",
      "东方延绪",
      "程心",
      "云天明",
      "托马斯·维德",
      "艾AA",
      "关一帆",
      "智子",
      "维德",
    ],
  },
  {
    file: "liulang-diqiu-novel",
    id: "public_liulang_diqiu_novel",
    title: "流浪地球（小说）",
    tier: "short",
    wikiTitle: "流浪地球_(小说)",
    maxMustFind: 10,
    prefer: ["小星老师", "阿东", "灵儿", "爸爸", "妈妈", "父亲"],
    notes:
      "小说条目几乎无角色表；mustFind 仅用 prefer（通行小说人物），preferOnly。非电影。",
  },
];

// preferOnly flags by file
const PREFER_ONLY = new Set(["liulang-diqiu-novel"]);

const UA =
  "novel-character-sim-gold-bot/1.0 (educational eval; contact: local-dev)";

const BLACKLIST = new Set(
  `
红楼梦 三国演义 西游记 水浒传 三体 流浪地球 维基百科 自由的百科全书 编辑 注释 参考 分类
姓名 字 籍贯 列传 首回 末回 史构 备注 简介 目录 列表 角色 人物 人名 历史 小说 东漢 东汉
三國 三国 西晉 西晋 皇族 皇后 宦官 鲜卑 乌桓 羌族 山越 南蛮 黄巾 起义 虚构 真实
刘慈欣 科幻 纳米 材料 文革 武斗 批斗 红卫兵 相对论 四大奇书 水滸傳 宋代 梁山泊
吴承恩 天竺 神仙 菩萨 长生不死 姜祺 蘭上星白 曾祖父 页面 不存在 外部 链接
科学幻想 科幻世界 太阳 发动机 太阳系 宇宙 季节 日出 电影 氦闪 比邻星
罗贯中 中国 历史 掌故 发现
`.split(/\s+/).filter(Boolean),
);

async function fetchWikiHtml(wikiTitle: string): Promise<string> {
  const url =
    "https://zh.wikipedia.org/api/rest_v1/page/html/" +
    encodeURIComponent(wikiTitle);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${wikiTitle}`);
  return await res.text();
}

function cleanName(raw: string): string | null {
  let n = raw
    .replace(/&nbsp;/g, "")
    .replace(/&#\d+;/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, "")
    .replace(/[（(].*$/, "")
    .replace(/的$/, "")
    .trim();
  // "汉灵帝" style already ok; strip leading ** 
  n = n.replace(/^\*+|\*+$/g, "");
  if (n.length < 2 || n.length > 12) return null;
  if (BLACKLIST.has(n)) return null;
  if (!/^[\u4e00-\u9fff·•A-Za-z0-9．.]+$/.test(n)) return null;
  if (/^[的了在是不上下中大小我你他她它一二三四五六七八九十]+$/.test(n))
    return null;
  return n;
}

function extractFromHtml(html: string): string[] {
  const ordered: string[] = [];
  const push = (s: string) => {
    const n = cleanName(s);
    if (n) ordered.push(n);
  };

  // 1) h2-h4 headings (三体 uses h3 per character)
  let m: RegExpExecArray | null;
  const reH =
    /<h([2-4])[^>]*>[\s\S]*?<span[^>]*class="mw-headline"[^>]*id="([^"]*)"[^>]*>([^<]*)/gi;
  while ((m = reH.exec(html))) {
    const text = m[3] || decodeURIComponent(m[2].replace(/\.([0-9A-F]{2})/g, "%$1"));
    push(text);
  }
  // simpler h3
  const reH3 = /<h3[^>]*>\s*(?:<span[^>]*>)*([^<]{2,20})/gi;
  while ((m = reH3.exec(html))) push(m[1]);

  // 2) First cell of table rows: <tr>...<td>...<a title="X"> or text
  const reRow =
    /<tr[^>]*>\s*<td[^>]*>\s*(?:<b>)?(?:<a[^>]*title="([^"]+)"[^>]*>)?(?:<[^>]+>)*([\u4e00-\u9fff·A-Za-z0-9．.]{2,12})/gi;
  while ((m = reRow.exec(html))) {
    push(m[1] || m[2]);
  }

  // 3) wikilinks with person-like titles
  const reA = /<a[^>]+title="([^"]{2,16})"[^>]*>/gi;
  while ((m = reA.exec(html))) {
    const t = m[1];
    if (t.includes("编辑") || t.includes("Category") || t.includes("页面"))
      continue;
    if (t.includes("（") && t.includes("页")) continue;
    push(t);
  }

  // 4) 九纹龙史进 style list items
  const reLi =
    /<li[^>]*>\s*(?:\d+\s*)?(?:[\u4e00-\u9fff]{2,6}\s+)?([\u4e00-\u9fff]{2,4})/g;
  while ((m = reLi.exec(html))) push(m[1]);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of ordered) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function buildMustFind(
  extracted: string[],
  prefer: string[] | undefined,
  max: number,
  /** If true, only keep prefer ∩ extracted (or prefer alone if extract empty of people) */
  preferOnly?: boolean,
): string[] {
  const set = new Set(extracted);
  const out: string[] = [];
  const seen = new Set<string>();

  for (const p of prefer || []) {
    const n = cleanName(p);
    if (!n || seen.has(n)) continue;
    // keep prefer if in extract OR always for curated prefer list
    if (set.has(n) || prefer) {
      seen.add(n);
      out.push(n);
    }
    if (out.length >= max) return out;
  }

  if (preferOnly) return out;

  for (const n of extracted) {
    if (seen.has(n)) continue;
    if (/^(东汉|西汉|魏国|蜀汉|东吴|晋朝|北宋|南宋|出版社|科幻|小说)$/.test(n))
      continue;
    if (n.length >= 6) continue; // long phrases not names
    seen.add(n);
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const meta: unknown[] = [];

  for (const job of JOBS) {
    process.stdout.write(`${job.wikiTitle} ... `);
    try {
      const html = await fetchWikiHtml(job.wikiTitle);
      const extracted = extractFromHtml(html);
      fs.writeFileSync(
        path.join(RAW_DIR, `${job.file}.names.txt`),
        extracted.join("\n") + "\n",
        "utf-8",
      );
      const mustFind = buildMustFind(
        extracted,
        job.prefer,
        job.maxMustFind,
        PREFER_ONLY.has(job.file),
      );
      const sourceUrl = `https://zh.wikipedia.org/wiki/${encodeURIComponent(job.wikiTitle)}`;
      const gold = {
        id: job.id,
        title: job.title,
        tier: job.tier,
        source: "wikipedia-download",
        sourceUrl,
        sourceWikiTitle: job.wikiTitle,
        fetchedAt: new Date().toISOString(),
        licenseNote:
          "Names extracted from Chinese Wikipedia (CC BY-SA). For evaluation only.",
        mustFind,
        aliasOf: {} as Record<string, string>,
        notes:
          (job.notes || "") +
          ` 维基抽取候选 ${extracted.length}，mustFind ${mustFind.length}。prefer 名单保证主线人物在列。导入正文后请校对 id 与 mustFind。`,
      };
      fs.writeFileSync(
        path.join(OUT_DIR, `${job.file}.json`),
        JSON.stringify(gold, null, 2) + "\n",
        "utf-8",
      );
      console.log(`OK mustFind=${mustFind.length} raw=${extracted.length}`);
      console.log(`   sample: ${mustFind.slice(0, 10).join("、")}`);
      meta.push({
        file: job.file,
        wiki: job.wikiTitle,
        url: sourceUrl,
        raw: extracted.length,
        mustFind: mustFind.length,
        sample: mustFind.slice(0, 12),
      });
    } catch (e) {
      console.log(`FAIL ${(e as Error).message}`);
      meta.push({ file: job.file, error: (e as Error).message });
    }
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "_download-manifest.json"),
    JSON.stringify({ fetchedAt: new Date().toISOString(), jobs: meta }, null, 2) +
      "\n",
    "utf-8",
  );
  console.log("\nDone. See public/_download-manifest.json and public/_raw/");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
