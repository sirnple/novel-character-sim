/**
 * Download **public-domain** Chinese classic novels from Wikisource.
 *
 * Legal: 明清古典小说公版。当代作品（如《三体》）有版权，本脚本不下载。
 *
 *   npm run eval:download-public-texts
 *
 * Output: data/public-novels/<slug>.txt
 *         data/public-novels/manifest.json
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "public-novels");
const API = "https://zh.wikisource.org/w/api.php";
const UA = {
  headers: {
    "User-Agent":
      "novel-character-sim/1.0 (local eval fixtures; educational; public-domain classics)",
  },
};

interface BookJob {
  slug: string;
  title: string;
  /** Wikisource chapter prefix, e.g. 紅樓夢/ */
  prefix: string;
  /** Optional gold file in character-gold/public */
  goldFile?: string;
  notes?: string;
}

/** 公版古典 only — no 三体 / 当代网文 */
const BOOKS: BookJob[] = [
  {
    slug: "hongloumeng",
    title: "红楼梦",
    prefix: "紅樓夢/",
    goldFile: "hongloumeng.json",
  },
  {
    slug: "sanguoyanyi",
    title: "三国演义",
    prefix: "三國演義/",
    goldFile: "sanguoyanyi.json",
  },
  {
    slug: "xiyouji",
    title: "西游记",
    prefix: "西遊記/",
    goldFile: "xiyouji.json",
  },
  {
    slug: "shuihuzhuan",
    title: "水浒传",
    prefix: "水滸傳/",
    goldFile: "shuihuzhuan.json",
  },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function api(params: Record<string, string>): Promise<any> {
  const u = new URL(API);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  u.searchParams.set("format", "json");
  const res = await fetch(u.toString(), UA);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${u}`);
  return res.json();
}

async function listChapterTitles(prefix: string): Promise<string[]> {
  const titles: string[] = [];
  let cont: string | undefined;
  for (;;) {
    const params: Record<string, string> = {
      action: "query",
      list: "allpages",
      apprefix: prefix,
      aplimit: "50",
    };
    if (cont) params.apcontinue = cont;
    const j = await api(params);
    for (const p of j.query?.allpages || []) {
      titles.push(p.title as string);
    }
    cont = j.continue?.apcontinue;
    if (!cont) break;
    await sleep(200);
  }
  // natural-ish sort by trailing numbers
  titles.sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ""), 10) || 0;
    const nb = parseInt(b.replace(/\D/g, ""), 10) || 0;
    if (na !== nb) return na - nb;
    return a.localeCompare(b, "zh");
  });
  return titles;
}

async function fetchPlainText(titles: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // MediaWiki allows ~20 titles per request
  for (let i = 0; i < titles.length; i += 15) {
    const batch = titles.slice(i, i + 15);
    const j = await api({
      action: "query",
      prop: "extracts",
      explaintext: "1",
      exlimit: "max",
      titles: batch.join("|"),
    });
    const pages = j.query?.pages || {};
    for (const id of Object.keys(pages)) {
      const page = pages[id];
      if (page.missing != null) continue;
      const text = String(page.extract || "").trim();
      if (text) map.set(page.title, text);
    }
    process.stdout.write(`  extracts ${Math.min(i + 15, titles.length)}/${titles.length}\r`);
    await sleep(350);
  }
  process.stdout.write("\n");
  return map;
}

async function downloadBook(job: BookJob): Promise<{
  slug: string;
  title: string;
  chapters: number;
  chars: number;
  path: string;
  source: string;
}> {
  console.log(`\n=== ${job.title} (${job.prefix}) ===`);
  const titles = await listChapterTitles(job.prefix);
  console.log(`  chapters listed: ${titles.length}`);
  if (!titles.length) {
    throw new Error(`No chapters under ${job.prefix}`);
  }
  const texts = await fetchPlainText(titles);
  const parts: string[] = [];
  parts.push(`《${job.title}》\n`);
  parts.push(
    `来源：中文维基文库（公版）\nhttps://zh.wikisource.org/wiki/${encodeURIComponent(job.prefix.replace(/\/$/, ""))}\n`,
  );
  parts.push(`下载时间：${new Date().toISOString()}\n\n`);

  let missing = 0;
  for (const t of titles) {
    const body = texts.get(t);
    if (!body) {
      missing++;
      continue;
    }
    // short chapter heading from title
    const short = t.replace(/^[^/]+\//, "");
    parts.push(`\n\n【${short}】\n\n`);
    parts.push(body);
  }
  if (missing) console.log(`  missing extracts: ${missing}`);

  const full = parts.join("").replace(/\r\n/g, "\n");
  fs.mkdirSync(OUT, { recursive: true });
  const outPath = path.join(OUT, `${job.slug}.txt`);
  fs.writeFileSync(outPath, full, "utf-8");
  console.log(`  wrote ${outPath} (${full.length} chars, ${titles.length - missing} ch)`);
  return {
    slug: job.slug,
    title: job.title,
    chapters: titles.length - missing,
    chars: full.length,
    path: path.relative(process.cwd(), outPath).replace(/\\/g, "/"),
    source: `https://zh.wikisource.org/wiki/${encodeURIComponent(job.prefix.replace(/\/$/, ""))}`,
  };
}

async function main() {
  console.log("Public-domain classics from Wikisource only.");
  console.log("Skipped (copyright): 三体、当代网文等。\n");

  const results: unknown[] = [];
  for (const job of BOOKS) {
    try {
      results.push(await downloadBook(job));
    } catch (e) {
      console.error(`FAIL ${job.title}:`, (e as Error).message);
      results.push({ slug: job.slug, error: (e as Error).message });
    }
    await sleep(500);
  }

  const manifest = {
    downloadedAt: new Date().toISOString(),
    license: "Public domain Chinese classics via Wikisource",
    note: "Do not add copyrighted modern novels (e.g. 三体) here.",
    books: results,
  };
  fs.writeFileSync(
    path.join(OUT, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );
  console.log("\nManifest:", path.join(OUT, "manifest.json"));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
