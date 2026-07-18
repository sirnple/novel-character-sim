/**
 * Standard agent markdown format:
 *
 * ---
 * name: agent_id
 * description: short description
 * tools:
 *   - tool_a
 *   - tool_b
 * ---
 *
 * System prompt body...
 *
 * Compatible with Claude Code / common agent frontmatter conventions.
 * `tools` is an allowlist; omit or use [] for no tools.
 */

export interface AgentFrontmatter {
  name?: string;
  description?: string;
  /** Tool allowlist (order preserved). Empty/undefined = no tools declared. */
  tools?: string[];
  /** Any extra string fields for forward compatibility */
  [key: string]: unknown;
}

export interface ParsedAgentDocument {
  frontmatter: AgentFrontmatter;
  body: string;
  /** True when a YAML frontmatter block was present */
  hasFrontmatter: boolean;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse YAML-like agent frontmatter (name, description, tools list / comma string).
 * Intentionally small — no full YAML dependency.
 */
export function parseAgentFrontmatter(raw: string): ParsedAgentDocument {
  const text = raw.replace(/^\uFEFF/, "");
  const m = text.match(FRONTMATTER_RE);
  if (!m) {
    return { frontmatter: {}, body: text, hasFrontmatter: false };
  }

  const yaml = m[1];
  const body = m[2].replace(/^\r?\n/, "");
  const frontmatter = parseSimpleYaml(yaml);
  return { frontmatter, body, hasFrontmatter: true };
}

/** Strip frontmatter; return prompt body only. */
export function stripFrontmatter(raw: string): string {
  return parseAgentFrontmatter(raw).body;
}

function parseSimpleYaml(yaml: string): AgentFrontmatter {
  const result: AgentFrontmatter = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    // tools: a, b, c  OR  tools: []  OR  tools:
    //   - a
    //   - b
    const toolsInline = trimmed.match(/^tools:\s*(.*)$/);
    if (toolsInline) {
      const rest = toolsInline[1].trim();
      if (!rest || rest === "[]") {
        // either empty list marker or block form on following lines
        if (!rest) {
          const list: string[] = [];
          i++;
          while (i < lines.length) {
            const item = lines[i].match(/^\s*-\s+(.+?)\s*$/);
            if (!item) break;
            list.push(stripQuotes(item[1].trim()));
            i++;
          }
          result.tools = list;
          continue;
        }
        result.tools = [];
        i++;
        continue;
      }
      // Inline: tools: a, b, c  or tools: [a, b]
      const unbracket = rest.replace(/^\[/, "").replace(/\]$/, "");
      result.tools = unbracket
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter(Boolean);
      i++;
      continue;
    }

    // key: value  (single-line)
    const kv = trimmed.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1];
      let value = kv[2].trim();
      // folded scalar marker >
      if (value === ">" || value === "|") {
        const parts: string[] = [];
        i++;
        while (i < lines.length) {
          const next = lines[i];
          if (/^\S/.test(next) && next.trim() !== "") break; // next top-level key
          if (next.trim() === "" && parts.length === 0) {
            i++;
            continue;
          }
          if (/^\s+/.test(next) || next.trim() === "") {
            parts.push(next.replace(/^\s+/, "").trimEnd());
            i++;
            continue;
          }
          break;
        }
        value = parts.join(value === ">" ? " " : "\n").trim();
        result[key] = value;
        continue;
      }
      result[key] = stripQuotes(value);
      i++;
      continue;
    }

    i++;
  }

  // Normalize tools to string[]
  if (result.tools != null && !Array.isArray(result.tools)) {
    result.tools = String(result.tools)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return result;
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}
