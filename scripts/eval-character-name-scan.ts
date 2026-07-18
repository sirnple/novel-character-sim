/**
 * Self-eval: gold mustFind recall against saved character rosters in novels.db.
 *
 * Does NOT re-run LLM scan — run analysis (character job) first, then:
 *   npm run eval:characters
 *   npx tsx scripts/eval-character-name-scan.ts --only=public_xiyouji
 *   npx tsx scripts/eval-character-name-scan.ts --include-public --userId=xxx
 *
 * Every report records **git code version** (commit, branch, dirty) for regression tracking.
 *
 * Writes:
 *   scripts/eval/results/char-recall-YYYYMMDD-HHmmss.json
 *   scripts/eval/results/char-recall-YYYYMMDD-HHmmss.md
 *   scripts/eval/results/history.jsonl  (one line per run)
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Gold {
  id: string;
  title: string;
  mustFind: string[];
  aliasOf?: Record<string, string>;
  /** short | long — drives pass bar (default: infer from novel length if available) */
  tier?: "short" | "long";
  notes?: string;
}

interface BookScore {
  goldId: string;
  title: string;
  tier: "short" | "long";
  passBar: number;
  mustFindCount: number;
  rosterCount: number;
  hit: string[];
  miss: string[];
  recall: number;
  passed: boolean;
  /** roster names not matching any gold (rough noise proxy, not true precision) */
  extraSample: string[];
  novelFound: boolean;
  userIdUsed: string | null;
  error?: string;
}

interface CodeVersion {
  /** Full git commit sha, or "unknown" */
  commit: string;
  /** Short sha */
  commitShort: string;
  branch: string;
  /** true if working tree has uncommitted changes */
  dirty: boolean;
  /** package.json version if present */
  packageVersion: string | null;
  /** describe --tags --always when available */
  describe: string | null;
}

interface EvalReport {
  ranAt: string;
  /** Code under test — required for comparing improvements */
  codeVersion: CodeVersion;
  dbPath: string;
  userIdFilter: string | null;
  goldFilter: string | null;
  includePublic: boolean;
  passBars: { short: number; long: number };
  books: BookScore[];
  summary: {
    scored: number;
    passed: number;
    failed: number;
    skipped: number;
    allPassed: boolean;
  };
}

// Spec: short ≥0.90, long ≥0.85
const PASS_SHORT = 0.9;
const PASS_LONG = 0.85;
const LONG_CHARS = 500_000;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const GOLD_DIR = path.join(ROOT, "scripts", "eval", "character-gold");
const RESULTS_DIR = path.join(ROOT, "scripts", "eval", "results");
const HISTORY_PATH = path.join(RESULTS_DIR, "history.jsonl");
const DEFAULT_DB = path.join(ROOT, "data", "novels.db");

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return (s || "").replace(/\s+/g, "").trim();
}

function goldMatchedInRoster(
  goldName: string,
  roster: string[],
  aliasOf: Record<string, string>,
): boolean {
  const g = normalize(goldName);
  if (!g) return false;
  for (const raw of roster) {
    const n = normalize(raw);
    if (!n) continue;
    if (n === g) return true;
    // substring either way (雪棠 ⊂ 洛雪棠) — conservative length
    if (n.length >= 2 && g.length >= 2 && (n.includes(g) || g.includes(n))) {
      return true;
    }
    if (aliasOf[n] === goldName || aliasOf[n] === g) return true;
  }
  return false;
}

function scoreRoster(
  rosterNames: string[],
  gold: Gold,
  tier: "short" | "long",
): Omit<BookScore, "goldId" | "title" | "novelFound" | "userIdUsed" | "error"> {
  const aliasOf = gold.aliasOf || {};
  const hit: string[] = [];
  const miss: string[] = [];
  for (const g of gold.mustFind) {
    if (goldMatchedInRoster(g, rosterNames, aliasOf)) hit.push(g);
    else miss.push(g);
  }
  const recall = gold.mustFind.length ? hit.length / gold.mustFind.length : 0;
  const passBar = tier === "short" ? PASS_SHORT : PASS_LONG;

  // names that don't hit any gold (noise proxy)
  const goldNorm = new Set(gold.mustFind.map(normalize));
  const extraSample: string[] = [];
  for (const raw of rosterNames) {
    const n = normalize(raw);
    const coversGold = gold.mustFind.some((g) =>
      goldMatchedInRoster(g, [raw], aliasOf),
    );
    const isAliasKey = Object.keys(aliasOf).some((k) => normalize(k) === n);
    if (!coversGold && !goldNorm.has(n) && !isAliasKey) {
      extraSample.push(raw);
    }
  }

  return {
    tier,
    passBar,
    mustFindCount: gold.mustFind.length,
    rosterCount: rosterNames.length,
    hit,
    miss,
    recall,
    passed: recall >= passBar && gold.mustFind.length > 0,
    extraSample: extraSample.slice(0, 15),
  };
}

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

function loadGoldFiles(includePublic: boolean): { path: string; gold: Gold }[] {
  if (!fs.existsSync(GOLD_DIR)) return [];
  const out: { path: string; gold: Gold }[] = [];
  for (const f of fs.readdirSync(GOLD_DIR)) {
    if (!f.endsWith(".json")) continue;
    const p = path.join(GOLD_DIR, f);
    out.push({ path: p, gold: JSON.parse(fs.readFileSync(p, "utf-8")) as Gold });
  }
  if (includePublic) {
    const pub = path.join(GOLD_DIR, "public");
    if (fs.existsSync(pub)) {
      for (const f of fs.readdirSync(pub)) {
        if (!f.endsWith(".json") || f.startsWith("_")) continue;
        const p = path.join(pub, f);
        out.push({
          path: p,
          gold: JSON.parse(fs.readFileSync(p, "utf-8")) as Gold,
        });
      }
    }
  }
  return out;
}

function captureCodeVersion(): CodeVersion {
  const run = (cmd: string): string | null => {
    try {
      return execSync(cmd, {
        cwd: ROOT,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };
  const commit = run("git rev-parse HEAD") || "unknown";
  const commitShort = run("git rev-parse --short HEAD") || commit.slice(0, 7);
  const branch = run("git rev-parse --abbrev-ref HEAD") || "unknown";
  const dirtyOut = run("git status --porcelain");
  const dirty = dirtyOut != null && dirtyOut.length > 0;
  const describe = run("git describe --tags --always --dirty");
  let packageVersion: string | null = null;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"),
    ) as { version?: string };
    packageVersion = pkg.version || null;
  } catch {
    /* */
  }
  return { commit, commitShort, branch, dirty, packageVersion, describe };
}

function listUserIdsForNovel(db: Database.Database, novelId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT user_id FROM characters WHERE novel_id = ? ORDER BY user_id`,
    )
    .all(novelId) as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

/** Primary names + aliases from CharacterProfile rows (for matching gold). */
function loadCharacterNames(
  db: Database.Database,
  novelId: string,
  userId: string | null,
): { names: string[]; userIdUsed: string | null } {
  const parseRows = (rows: { data: string }[]): string[] => {
    const out: string[] = [];
    for (const r of rows) {
      try {
        const c = JSON.parse(r.data) as {
          name?: string;
          aliases?: string[];
        };
        if (c.name) out.push(c.name);
        for (const a of c.aliases || []) {
          if (a) out.push(a);
        }
      } catch {
        /* skip */
      }
    }
    return out.filter(Boolean);
  };

  if (userId) {
    const rows = db
      .prepare(
        `SELECT data FROM characters WHERE novel_id = ? AND user_id = ?`,
      )
      .all(novelId, userId) as { data: string }[];
    return {
      names: parseRows(rows),
      userIdUsed: userId,
    };
  }

  // Prefer user with most characters for this novel
  const users = listUserIdsForNovel(db, novelId);
  if (!users.length) return { names: [], userIdUsed: null };

  let best: { names: string[]; userIdUsed: string } | null = null;
  for (const u of users) {
    const { names } = loadCharacterNames(db, novelId, u);
    if (!best || names.length > best.names.length) {
      best = { names, userIdUsed: u };
    }
  }
  return best || { names: [], userIdUsed: null };
}

function novelCharLength(db: Database.Database, novelId: string): number | null {
  try {
    const row = db
      .prepare(`SELECT length(text) AS n FROM novels WHERE id = ? LIMIT 1`)
      .get(novelId) as { n: number } | undefined;
    return row?.n ?? null;
  } catch {
    return null;
  }
}

function inferTier(gold: Gold, textLen: number | null): "short" | "long" {
  if (gold.tier === "short" || gold.tier === "long") return gold.tier;
  if (textLen != null && textLen >= LONG_CHARS) return "long";
  return "short";
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function toMarkdown(report: EvalReport): string {
  const v = report.codeVersion;
  const lines: string[] = [
    `# Character roster gold recall`,
    ``,
    `- **ranAt:** ${report.ranAt}`,
    `- **codeVersion.commit:** \`${v.commit}\``,
    `- **codeVersion.commitShort:** \`${v.commitShort}\``,
    `- **codeVersion.branch:** \`${v.branch}\``,
    `- **codeVersion.dirty:** ${v.dirty}`,
    `- **codeVersion.describe:** \`${v.describe ?? "—"}\``,
    `- **codeVersion.packageVersion:** ${v.packageVersion ?? "—"}`,
    `- **db:** \`${report.dbPath}\``,
    `- **userId filter:** ${report.userIdFilter ?? "(auto: most characters)"}`,
    `- **gold filter:** ${report.goldFilter ?? "(all loaded)"}`,
    `- **includePublic:** ${report.includePublic}`,
    `- **bars:** short ≥ ${report.passBars.short}, long ≥ ${report.passBars.long}`,
    ``,
    `## Summary`,
    ``,
    `| scored | passed | failed | skipped | allPassed |`,
    `|--------|--------|--------|---------|-----------|`,
    `| ${report.summary.scored} | ${report.summary.passed} | ${report.summary.failed} | ${report.summary.skipped} | ${report.summary.allPassed ? "yes" : "no"} |`,
    ``,
    `## Per book`,
    ``,
  ];

  for (const b of report.books) {
    const status = b.error
      ? "ERROR"
      : !b.novelFound
        ? "SKIP"
        : b.passed
          ? "PASS"
          : "FAIL";
    lines.push(`### ${b.title} (\`${b.goldId}\`) — **${status}**`);
    lines.push(``);
    if (b.error) {
      lines.push(`- error: ${b.error}`);
    } else if (!b.novelFound) {
      lines.push(`- no characters in DB for this novel id (run analysis first)`);
    } else {
      lines.push(
        `- tier: **${b.tier}** · bar ≥ ${b.passBar} · recall **${b.recall.toFixed(3)}** (${b.hit.length}/${b.mustFindCount})`,
      );
      lines.push(`- roster size: ${b.rosterCount} · userId: \`${b.userIdUsed}\``);
      lines.push(`- hit: ${b.hit.join("、") || "—"}`);
      lines.push(`- miss: ${b.miss.join("、") || "—"}`);
      if (b.extraSample.length) {
        lines.push(
          `- extra (not in gold, sample): ${b.extraSample.join("、")}`,
        );
      }
    }
    lines.push(``);
  }

  lines.push(`## How to re-run`);
  lines.push(``);
  lines.push("```bash");
  lines.push("npm run eval:characters");
  lines.push("```");
  lines.push(``);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  userId: string | null;
  dbPath: string;
  only: string | null;
  includePublic: boolean;
} {
  let userId: string | null = null;
  let dbPath = DEFAULT_DB;
  let only: string | null = null;
  let includePublic = false;
  for (const a of argv) {
    if (a.startsWith("--userId=")) userId = a.slice("--userId=".length) || null;
    if (a.startsWith("--db=")) dbPath = a.slice("--db=".length) || DEFAULT_DB;
    if (a.startsWith("--only=")) only = a.slice("--only=".length) || null;
    if (a === "--include-public") includePublic = true;
  }
  return { userId, dbPath, only, includePublic };
}

function main() {
  const { userId, dbPath, only, includePublic } = parseArgs(process.argv.slice(2));
  const codeVersion = captureCodeVersion();
  console.log(
    `Code: ${codeVersion.commitShort} (${codeVersion.branch})` +
      `${codeVersion.dirty ? " dirty" : " clean"}` +
      (codeVersion.describe ? ` · ${codeVersion.describe}` : ""),
  );

  let golds = loadGoldFiles(includePublic);
  if (only) {
    golds = golds.filter(
      (g) =>
        g.gold.id === only ||
        g.gold.title.includes(only) ||
        path.basename(g.path).includes(only),
    );
  }

  if (!golds.length) {
    console.error(`No gold JSON matched (includePublic=${includePublic}, only=${only})`);
    process.exitCode = 1;
    return;
  }

  console.log(`Gold sets: ${golds.length}`);
  golds.forEach(({ gold }) =>
    console.log(`  - ${gold.title} (${gold.id}) n=${gold.mustFind.length}`),
  );

  if (!fs.existsSync(dbPath)) {
    console.error(`\nDB not found: ${dbPath}`);
    console.error("Run character analysis first, then re-run eval.");
    process.exitCode = 1;
    return;
  }

  const db = new Database(dbPath, { readonly: true });
  const books: BookScore[] = [];

  for (const { gold } of golds) {
    try {
      const textLen = novelCharLength(db, gold.id);
      const tier = inferTier(gold, textLen);
      const { names, userIdUsed } = loadCharacterNames(db, gold.id, userId);

      if (!names.length) {
        books.push({
          goldId: gold.id,
          title: gold.title,
          tier,
          passBar: tier === "short" ? PASS_SHORT : PASS_LONG,
          mustFindCount: gold.mustFind.length,
          rosterCount: 0,
          hit: [],
          miss: [...gold.mustFind],
          recall: 0,
          passed: false,
          extraSample: [],
          novelFound: false,
          userIdUsed: null,
        });
        continue;
      }

      const sc = scoreRoster(names, gold, tier);
      books.push({
        goldId: gold.id,
        title: gold.title,
        novelFound: true,
        userIdUsed,
        ...sc,
      });
    } catch (e) {
      books.push({
        goldId: gold.id,
        title: gold.title,
        tier: gold.tier || "short",
        passBar: PASS_SHORT,
        mustFindCount: gold.mustFind.length,
        rosterCount: 0,
        hit: [],
        miss: [...gold.mustFind],
        recall: 0,
        passed: false,
        extraSample: [],
        novelFound: false,
        userIdUsed: null,
        error: (e as Error).message,
      });
    }
  }

  const scored = books.filter((b) => b.novelFound && !b.error);
  const passed = scored.filter((b) => b.passed).length;
  const failed = scored.filter((b) => !b.passed).length;
  const skipped = books.filter((b) => !b.novelFound || b.error).length;

  const report: EvalReport = {
    ranAt: new Date().toISOString(),
    codeVersion,
    dbPath,
    userIdFilter: userId,
    goldFilter: only,
    includePublic,
    passBars: { short: PASS_SHORT, long: PASS_LONG },
    books,
    summary: {
      scored: scored.length,
      passed,
      failed,
      skipped,
      allPassed: scored.length > 0 && failed === 0 && skipped === 0,
    },
  };

  // Console
  console.log("\n--- Results ---");
  console.log(
    `codeVersion: ${codeVersion.commitShort} dirty=${codeVersion.dirty} branch=${codeVersion.branch}`,
  );
  for (const b of books) {
    if (!b.novelFound) {
      console.log(`[SKIP] ${b.title}: no roster in DB`);
      continue;
    }
    if (b.error) {
      console.log(`[ERR]  ${b.title}: ${b.error}`);
      continue;
    }
    const tag = b.passed ? "PASS" : "FAIL";
    console.log(
      `[${tag}] ${b.title}: recall=${b.recall.toFixed(3)} (≥${b.passBar} ${b.tier}) ` +
        `hit=${b.hit.length}/${b.mustFindCount} miss=${b.miss.join("、") || "—"} ` +
        `roster=${b.rosterCount}`,
    );
  }
  console.log(
    `\nSummary: scored=${scored.length} passed=${passed} failed=${failed} skipped=${skipped} ` +
      `allPassed=${report.summary.allPassed}`,
  );

  // Persist
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const id = stamp();
  const jsonPath = path.join(RESULTS_DIR, `char-recall-${id}.json`);
  const mdPath = path.join(RESULTS_DIR, `char-recall-${id}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  fs.writeFileSync(mdPath, toMarkdown(report), "utf-8");
  fs.appendFileSync(
    HISTORY_PATH,
    JSON.stringify({
      ranAt: report.ranAt,
      id,
      codeVersion: {
        commit: codeVersion.commit,
        commitShort: codeVersion.commitShort,
        branch: codeVersion.branch,
        dirty: codeVersion.dirty,
        describe: codeVersion.describe,
        packageVersion: codeVersion.packageVersion,
      },
      summary: report.summary,
      books: books.map((b) => ({
        id: b.goldId,
        title: b.title,
        recall: b.recall,
        passed: b.passed,
        novelFound: b.novelFound,
      })),
      json: path.relative(ROOT, jsonPath),
    }) + "\n",
    "utf-8",
  );

  console.log(`\nWrote:\n  ${path.relative(ROOT, jsonPath)}\n  ${path.relative(ROOT, mdPath)}`);
  console.log(`  history: ${path.relative(ROOT, HISTORY_PATH)}`);

  // Exit non-zero if any scored book failed (skipped-only → 0 so CI can still warn)
  if (failed > 0) process.exitCode = 1;
  if (scored.length === 0) {
    console.log(
      "\nNo books scored. Run Flash character analysis for gold novel ids, then re-run.",
    );
    process.exitCode = 1;
  }
}

main();
