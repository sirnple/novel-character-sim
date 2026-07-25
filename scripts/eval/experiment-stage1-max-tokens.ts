/**
 * Experiment: how often thinking=enabled hits max_tokens / empty content
 * at a fixed quality budget (default 12288).
 *
 *   npx tsx scripts/eval/experiment-stage1-max-tokens.ts
 *   npx tsx scripts/eval/experiment-stage1-max-tokens.ts --maxWindows=5 --qualityMax=12288
 *
 * Records every chatWithTool attempt via LLM metrics; writes JSON+MD report.
 */
import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import { loadEnvLocal } from "../lib/load-env-local";

function loadEnvFiles() {
  const cwd = process.cwd();
  for (const name of [".env", ".env.local"]) {
    const p = path.join(cwd, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf-8").split(/\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      // .env.local overrides .env for this experiment
      if (name === ".env.local" || process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = val;
      }
    }
  }
  loadEnvLocal(cwd);
}

loadEnvFiles();
// Prefer .env.local provider if both set (fix load order above for .env.local override)
process.env.LLM_METRICS = "1";
process.env.LLM_SAVE_COT = process.env.LLM_SAVE_COT || "0"; // keep cot off to save disk unless set

import { createLLMProvider } from "../../src/core/llm/factory";
import { runStage1WindowScan } from "../../src/core/character-analysis";
import {
  beginChatWithToolMetrics,
  endChatWithToolMetrics,
  summarizeChatWithToolMetrics,
  type ChatWithToolAttemptMetric,
} from "../../src/core/llm/chat-with-tool-metrics";

type BookSpec = {
  id: string;
  title: string;
  path?: string;
  novelId?: string;
  /** Cap text length for huge classics (chars). 0 = full. */
  maxChars?: number;
};

const TW = String.raw`C:\Users\57864\Repositories\TextWrite`;

/** 实验书单：无三国/水浒；TextWrite 任选几本 + 西游记 + 流浪地球 */
const DEFAULT_BOOKS: BookSpec[] = [
  {
    id: "liulang",
    title: "流浪地球",
    path: String.raw`C:\Users\57864\Downloads\[2000-2]《流浪地球》.txt`,
  },
  {
    id: "xiyouji",
    title: "西游记",
    path: path.join(process.cwd(), "data/public-novels/xiyouji.txt"),
  },
  {
    id: "shennvfu",
    title: "神女赋",
    path: path.join(TW, "《神女赋》.txt"),
  },
  {
    id: "fanren-p1",
    title: "凡人修仙传-part1",
    path: path.join(TW, "凡人修仙传-part1.txt"),
  },
  {
    id: "nvdi",
    title: "女帝称尊",
    path: path.join(TW, "女帝称尊.txt"),
  },
  {
    id: "fenghuo",
    title: "烽火烟波楼",
    path: path.join(TW, "烽火烟波楼.txt"),
  },
];

function readNovelFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  let text = buf.toString("utf8");
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 5 || /Ã.|Â./.test(text.slice(0, 200))) {
    text = iconv.decode(buf, "gbk");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

function parseArgs() {
  // Defaults for this experiment: 5 windows/book, higher concurrency
  let maxWindows: number | null = 5;
  let qualityMax = 30_000;
  let concurrency = 6;
  let windowChars = 6000;
  let overlapChars = 800;
  for (const a of process.argv.slice(2)) {
    let m: RegExpMatchArray | null;
    if ((m = a.match(/^--maxWindows=(\d+)$/))) {
      maxWindows = Math.max(1, parseInt(m[1]!, 10));
    } else if ((m = a.match(/^--qualityMax=(\d+)$/))) {
      qualityMax = Math.max(1024, parseInt(m[1]!, 10));
    } else if ((m = a.match(/^--concurrency=(\d+)$/))) {
      concurrency = Math.max(1, Math.min(12, parseInt(m[1]!, 10)));
    } else if ((m = a.match(/^--windowChars=(\d+)$/))) {
      windowChars = Math.max(500, parseInt(m[1]!, 10));
    } else if ((m = a.match(/^--overlapChars=(\d+)$/))) {
      overlapChars = Math.max(0, parseInt(m[1]!, 10));
    }
  }
  return { maxWindows, qualityMax, concurrency, windowChars, overlapChars };
}

async function runBook(
  book: BookSpec,
  opts: ReturnType<typeof parseArgs>,
): Promise<{
  book: BookSpec;
  textLen: number;
  windowCount: number;
  elapsedSec: number;
  attempts: ChatWithToolAttemptMetric[];
  summary: ReturnType<typeof summarizeChatWithToolMetrics>;
  error?: string;
}> {
  if (!book.path || !fs.existsSync(book.path)) {
    return {
      book,
      textLen: 0,
      windowCount: 0,
      elapsedSec: 0,
      attempts: [],
      summary: summarizeChatWithToolMetrics([]),
      error: `missing file: ${book.path}`,
    };
  }
  let text = readNovelFile(book.path);
  if (book.maxChars && book.maxChars > 0 && text.length > book.maxChars) {
    text = text.slice(0, book.maxChars);
  }

  beginChatWithToolMetrics({ label: book.id });
  const llm = createLLMProvider("analysis");
  // Force quality budget: chatWithTool uses max(options.maxTokens, floor)
  const t0 = Date.now();
  let windowCount = 0;
  try {
    const { windows, byWindow } = await runStage1WindowScan(text, llm, {
      config: {
        windowChars: opts.windowChars,
        overlapChars: opts.overlapChars,
      },
      maxWindows: opts.maxWindows,
      concurrency: opts.concurrency,
      maxTokens: opts.qualityMax,
      onWindowDone: (r, i, total) => {
        windowCount = total;
        const n = r.characters.length;
        const tag = r.error ? `FAIL ${r.error.slice(0, 80)}` : `ok n=${n}`;
        console.log(`[exp] ${book.id} ${r.window.label} (${i + 1}/${total}) ${tag}`);
      },
    });
    windowCount = windows.length;
    void byWindow;
  } catch (e) {
    const attempts = endChatWithToolMetrics();
    return {
      book,
      textLen: text.length,
      windowCount,
      elapsedSec: Math.round((Date.now() - t0) / 1000),
      attempts,
      summary: summarizeChatWithToolMetrics(attempts),
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const attempts = endChatWithToolMetrics();
  return {
    book,
    textLen: text.length,
    windowCount,
    elapsedSec: Math.round((Date.now() - t0) / 1000),
    attempts,
    summary: summarizeChatWithToolMetrics(attempts),
  };
}

async function main() {
  const opts = parseArgs();
  console.log(
    `[exp] qualityMax=${opts.qualityMax} windowChars=${opts.windowChars} ` +
      `overlap=${opts.overlapChars} maxWindows=${opts.maxWindows ?? "all"} ` +
      `concurrency=${opts.concurrency} provider=${process.env.LLM_PROVIDER}`,
  );

  const books = DEFAULT_BOOKS.filter((b) => b.path && fs.existsSync(b.path!));
  if (!books.length) {
    throw new Error("No experiment books found on disk");
  }
  console.log(`[exp] books: ${books.map((b) => b.id).join(", ")}`);

  const perBook = [];
  for (const book of books) {
    console.log(`\n[exp] === ${book.title} (${book.id}) ===`);
    const row = await runBook(book, opts);
    perBook.push(row);
    const s = row.summary;
    console.log(
      `[exp] ${book.id} done ${row.elapsedSec}s windows=${row.windowCount} ` +
        `enabled=${s.enabledAttempts} budgetInsufficient=${s.budgetInsufficientCount}` +
        ` rate=${(s.budgetInsufficientRate * 100).toFixed(1)}%` +
        (row.error ? ` error=${row.error}` : ""),
    );
  }

  const allAttempts = perBook.flatMap((b) => b.attempts);
  const overall = summarizeChatWithToolMetrics(allAttempts);

  const outDir = path.join("scripts", "eval", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const jsonPath = path.join(outDir, `exp-max-tokens-${stamp}.json`);
  const mdPath = path.join(outDir, `exp-max-tokens-${stamp}.md`);

  const payload = {
    experiment: "stage1-thinking-max-tokens",
    ranAt: new Date().toISOString(),
    qualityMax: opts.qualityMax,
    windowChars: opts.windowChars,
    overlapChars: opts.overlapChars,
    maxWindows: opts.maxWindows,
    definition: {
      budgetInsufficient:
        "thinking===enabled && (finish==='length' || contentLen===0)",
      note: "contentLen/reasoningLen are character lengths; maxTokens is token budget",
    },
    overall,
    perBook: perBook.map((b) => ({
      id: b.book.id,
      title: b.book.title,
      path: b.book.path,
      textLen: b.textLen,
      maxChars: b.book.maxChars ?? null,
      windowCount: b.windowCount,
      elapsedSec: b.elapsedSec,
      error: b.error,
      summary: b.summary,
      attempts: b.attempts,
    })),
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  const md: string[] = [
    `# Experiment: Stage1 thinking max_tokens insufficiency`,
    ``,
    `- qualityMax (token budget for thinking=enabled): **${opts.qualityMax}**`,
    `- windowChars=${opts.windowChars}, overlap=${opts.overlapChars}`,
    `- maxWindows=${opts.maxWindows ?? "all"}, concurrency=${opts.concurrency}`,
    ``,
    `## Definition`,
    ``,
    `**budgetInsufficient** = \`thinking=enabled\` AND (\`finish=length\` OR \`contentLen=0\`).`,
    ``,
    `## Overall`,
    ``,
    `| metric | value |`,
    `|---|---|`,
    `| total attempts | ${overall.totalAttempts} |`,
    `| thinking=enabled | ${overall.enabledAttempts} |`,
    `| thinking=disabled | ${overall.disabledAttempts} |`,
    `| **budgetInsufficient** | **${overall.budgetInsufficientCount}** (${(overall.budgetInsufficientRate * 100).toFixed(1)}% of enabled) |`,
    `| finish=length | ${overall.finishLengthCount} |`,
    `| content empty on enabled | ${overall.contentEmptyOnEnabled} |`,
    `| parseOk=false | ${overall.parseFailCount} |`,
    ``,
    `## Per book`,
    ``,
  ];
  for (const b of perBook) {
    const s = b.summary;
    md.push(`### ${b.book.title} (\`${b.book.id}\`)`);
    md.push(``);
    md.push(
      `- textLen=${b.textLen} windows=${b.windowCount} elapsed=${b.elapsedSec}s` +
        (b.error ? ` **error:** ${b.error}` : ""),
    );
    md.push(
      `- enabled=${s.enabledAttempts} budgetInsufficient=${s.budgetInsufficientCount} ` +
        `rate=${(s.budgetInsufficientRate * 100).toFixed(1)}% finish=length=${s.finishLengthCount}`,
    );
    md.push(``);
    if (b.attempts.length) {
      md.push(`| # | thinking | maxTokens | finish | contentLen | reasoningLen | completionTokens | budget? | parse |`);
      md.push(`|---|---|---|---|---|---|---|---|---|`);
      b.attempts.forEach((a, i) => {
        md.push(
          `| ${i + 1} | ${a.thinking} | ${a.maxTokens} | ${a.finish ?? ""} | ${a.contentLen} | ${a.reasoningLen} | ${a.completionTokens ?? ""} | ${a.budgetInsufficient ? "YES" : ""} | ${a.parseOk === null ? "" : a.parseOk ? "ok" : "fail"} |`,
        );
      });
      md.push(``);
    }
  }
  fs.writeFileSync(mdPath, md.join("\n"), "utf8");

  console.log(`\n[exp] OVERALL enabled=${overall.enabledAttempts} ` +
    `budgetInsufficient=${overall.budgetInsufficientCount} ` +
    `(${(overall.budgetInsufficientRate * 100).toFixed(1)}%)`);
  console.log(`[exp] wrote ${jsonPath}`);
  console.log(`[exp] wrote ${mdPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
