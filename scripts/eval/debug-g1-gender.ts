import fs from "node:fs";
import path from "node:path";

const dir = "scripts/eval/results";
const f = fs
  .readdirSync(dir)
  .find((x) => x.includes("13-17-48") && x.endsWith(".json"));
if (!f) throw new Error("result json not found");
const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const s2 = j.stage2.characters as any[];
const sur = (c: any) =>
  [...new Set(c.mentions.map((m: any) => m.surface))].join("/");

const out: string[] = [];
out.push("=== stage2 with 妈/爷/我/星/爸 ===");
for (const c of s2) {
  const s = sur(c);
  if (/妈|爷|我|星|黎|老师|爸|父/.test(s)) {
    out.push([c.id, "g=" + (c.gender || "?"), s].join("\t"));
  }
}

const merges = (j.stage3.scored || []).filter(
  (x: any) => x.decision === "auto_merge" || x.decision === "agent_merge",
);
const byId = Object.fromEntries(s2.map((c) => [c.id, c]));

out.push("=== merges touching 妈 or 爷 ===");
for (const m of merges) {
  const a = byId[m.idA];
  const b = byId[m.idB];
  if (!a || !b) continue;
  const sa = sur(a);
  const sb = sur(b);
  if (/妈|爷/.test(sa + sb)) {
    out.push(
      [
        m.decision,
        m.idA,
        a.gender || "?",
        sa,
        "~",
        m.idB,
        b.gender || "?",
        sb,
        "score",
        m.score,
        m.hard || "",
      ].join("\t"),
    );
    out.push(
      "  " +
        (m.breakdown || [])
          .filter((x: any) => x.hard || Math.abs(x.weighted || 0) > 0.01)
          .map(
            (x: any) =>
              x.ruleId + "=" + (x.hard || x.weighted) + ":" + x.reason,
          )
          .join("; "),
    );
  }
}

class UF {
  p = new Map<string, string>();
  add(x: string) {
    if (!this.p.has(x)) this.p.set(x, x);
  }
  find(x: string): string {
    this.add(x);
    const p = this.p.get(x)!;
    if (p !== x) {
      const r = this.find(p);
      this.p.set(x, r);
      return r;
    }
    return x;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p.set(ra, rb);
  }
}
const uf = new UF();
for (const m of merges) uf.union(m.idA, m.idB);

out.push("=== components containing both 妈 and 爷 ===");
const groups = new Map<string, any[]>();
for (const c of s2) {
  const r = uf.find(c.id);
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r)!.push(c);
}
for (const [, members] of groups) {
  const text = members.map((c) => sur(c)).join("|");
  if (/妈/.test(text) && /爷/.test(text)) {
    out.push("SIZE " + members.length);
    for (const c of members) {
      out.push("  " + c.id + "\tg=" + (c.gender || "?") + "\t" + sur(c));
    }
  }
}

out.push("=== direct pair scores 妈 vs 爷 ===");
for (const m of j.stage3.scored || []) {
  const a = byId[m.idA];
  const b = byId[m.idB];
  if (!a || !b) continue;
  const sa = sur(a);
  const sb = sur(b);
  if (
    (/妈/.test(sa) && /爷/.test(sb)) ||
    (/爷/.test(sa) && /妈/.test(sb))
  ) {
    out.push(
      [
        m.decision,
        m.idA,
        a.gender,
        sa,
        m.idB,
        b.gender,
        sb,
        m.score,
        m.hard,
      ].join("\t"),
    );
    out.push(
      "  " +
        (m.breakdown || [])
          .map(
            (x: any) =>
              x.ruleId +
              " en=" +
              x.enabled +
              " " +
              (x.hard || x.weighted) +
              " " +
              x.reason,
          )
          .join(" | "),
    );
  }
}

// genders of every entity that ended in same component as first 妈
const mom = s2.find((c) => sur(c).includes("妈妈"));
const ye = s2.find((c) => sur(c).includes("爷爷"));
if (mom && ye) {
  out.push("=== mom root " + uf.find(mom.id) + " ye root " + uf.find(ye.id));
  out.push("same component? " + (uf.find(mom.id) === uf.find(ye.id)));
}

fs.writeFileSync(
  path.join(dir, "_gender-trace.txt"),
  out.join("\n"),
  "utf8",
);
console.log("wrote", out.length, "lines");
