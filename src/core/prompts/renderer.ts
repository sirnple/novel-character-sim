import fs from "fs";
import path from "path";
import {
  parseAgentFrontmatter,
  type AgentFrontmatter,
  type ParsedAgentDocument,
} from "./frontmatter";

const PROMPTS_DIR = path.join(process.cwd(), "src", "core", "prompts");

/** Raw file cache (includes frontmatter); invalidated when mtime changes. */
const rawCache = new Map<string, { mtimeMs: number; text: string }>();
/** Parsed document cache; key = name + mtimeMs */
const docCache = new Map<string, ParsedAgentDocument>();

function readRaw(name: string): { mtimeMs: number; text: string } {
  const p = path.join(PROMPTS_DIR, name);
  const mtimeMs = fs.statSync(p).mtimeMs;
  const hit = rawCache.get(name);
  if (hit && hit.mtimeMs === mtimeMs) return hit;
  const text = fs.readFileSync(p, "utf-8");
  const entry = { mtimeMs, text };
  rawCache.set(name, entry);
  // Drop stale parsed doc for this file
  for (const key of docCache.keys()) {
    if (key.startsWith(`${name}@`)) docCache.delete(key);
  }
  return entry;
}

/** Load full agent document (frontmatter + body). Cached until file mtime changes. */
export function loadPromptDocument(name: string): ParsedAgentDocument {
  const { mtimeMs, text } = readRaw(name);
  const cacheKey = `${name}@${mtimeMs}`;
  const hit = docCache.get(cacheKey);
  if (hit) return hit;
  const doc = parseAgentFrontmatter(text);
  docCache.set(cacheKey, doc);
  return doc;
}

/**
 * Load full prompt file text (frontmatter + body). Cached.
 * Prefer this for Admin display / edit defaults.
 */
export function loadPromptRaw(name: string): string {
  return readRaw(name).text;
}

/**
 * Load prompt template body (frontmatter stripped). Cached.
 * Safe for LLM system/user prompts — never injects YAML headers.
 */
export function loadPromptFile(name: string): string {
  return loadPromptDocument(name).body;
}

/** Frontmatter only from a prompt file (empty object if none). */
export function loadPromptFrontmatter(name: string): AgentFrontmatter {
  return loadPromptDocument(name).frontmatter;
}

/** Clear md cache (tests / hot-reload after file edit). */
export function clearPromptFileCache(): void {
  rawCache.clear();
  docCache.clear();
}

/**
 * Render an in-memory template string with {{variable}} and {{#block}}...{{/block}}.
 */
export function renderTemplate(template: string, vars: Record<string, any> = {}): string {
  let t = template;

  // Handle block sections: {{#key}}...{{/key}} — shown only if vars[key] is truthy
  t = t.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    return vars[key] ? content.trim() + "\n" : "";
  });

  // Handle {{.}} as the value of the current block variable
  t = t.replace(/\{\{\.\}\}/g, (match, offset) => {
    const before = t.slice(0, offset);
    const re = /\{\{#(\w+)\}\}/g;
    let lastKey = "";
    let m;
    while ((m = re.exec(before)) !== null) {
      lastKey = m[1];
    }
    return lastKey ? String(vars[lastKey] ?? "") : match;
  });

  // Handle {{variable}} replacements
  t = t.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
    const keys = key.split(".");
    let val: any = vars;
    for (const k of keys) {
      val = val?.[k];
      if (val === undefined) return `{{${key}}}`;
    }
    return String(val ?? "");
  });

  return t;
}

/**
 * Render a prompt template file with {{variable}} and {{#block}}...{{/block}} syntax.
 */
export function renderPrompt(templateName: string, vars: Record<string, any> = {}): string {
  return renderTemplate(loadPromptFile(templateName), vars);
}
