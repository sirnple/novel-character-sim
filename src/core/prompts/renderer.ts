import fs from "fs";
import path from "path";
import {
  parseAgentFrontmatter,
  type AgentFrontmatter,
  type ParsedAgentDocument,
} from "./frontmatter";

const PROMPTS_DIR = path.join(process.cwd(), "src", "core", "prompts");

/** Raw file cache (includes frontmatter) */
const rawCache = new Map<string, string>();
/** Parsed document cache */
const docCache = new Map<string, ParsedAgentDocument>();

function readRaw(name: string): string {
  if (rawCache.has(name)) return rawCache.get(name)!;
  const p = path.join(PROMPTS_DIR, name);
  const t = fs.readFileSync(p, "utf-8");
  rawCache.set(name, t);
  return t;
}

/** Load full agent document (frontmatter + body). Cached. */
export function loadPromptDocument(name: string): ParsedAgentDocument {
  if (docCache.has(name)) return docCache.get(name)!;
  const doc = parseAgentFrontmatter(readRaw(name));
  docCache.set(name, doc);
  return doc;
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
