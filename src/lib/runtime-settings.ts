/**
 * Central runtime settings: env defaults + in-process overrides (admin API).
 * Prefer this over reading process.env in call sites.
 *
 * Mention-scan keys (legacy env still honored as bootstrap):
 * - CHARACTER_MENTION_CONCURRENCY
 * - CHARACTER_MENTION_BATCH_UNITS
 * - CHARACTER_MENTION_BATCH_CHARS
 */
import fs from "fs";
import path from "path";
import { runtimeEnv } from "@/lib/runtime-env";
import { isServerDebugMode } from "@/lib/debug-mode";
import { getUserById } from "@/lib/db";

// ── Defaults (product) ──────────────────────────────────────────────

/** Parallel LLM calls for mention scan (normal users). */
export const MENTION_SCAN_CONCURRENCY_DEFAULT = 4;

/**
 * Units packed into one LLM call (normal users).
 * Admin mode forces 1 for clearer debugging / attribution.
 */
export const MENTION_SCAN_BATCH_UNITS_DEFAULT = 4;

/** Soft char budget per LLM call body. */
export const MENTION_SCAN_BATCH_CHARS_DEFAULT = 16_000;

/** When admin/debug: no concurrency cap (run all ready batches). */
export const MENTION_SCAN_CONCURRENCY_UNLIMITED = 0;

// ── Schema ──────────────────────────────────────────────────────────

export interface RuntimeSettings {
  /** Parallel mention-scan LLM calls; 0 = unlimited (privileged only by resolve). */
  mentionScanConcurrency: number;
  /** Units per LLM call for normal users (admin resolve uses 1). */
  mentionScanBatchUnits: number;
  mentionScanBatchChars: number;
  /** Admin/debug always unlimited concurrency when true (default true). */
  privilegedUnlimitedConcurrency: boolean;
  /** Admin batch units override (default 1). */
  adminMentionScanBatchUnits: number;
}

export interface MentionScanResolved {
  concurrency: number;
  batchUnits: number;
  batchChars: number;
  /** True when concurrency is uncapped (admin/debug). */
  unlimitedConcurrency: boolean;
  /** admin | debug | user */
  mode: "admin" | "debug" | "user";
}

type Store = {
  overrides: Partial<RuntimeSettings>;
  loaded: boolean;
};

function store(): Store {
  const g = globalThis as typeof globalThis & { __ncsRuntimeSettings?: Store };
  if (!g.__ncsRuntimeSettings) {
    g.__ncsRuntimeSettings = { overrides: {}, loaded: false };
  }
  return g.__ncsRuntimeSettings;
}

function settingsPath(): string {
  return path.join(process.cwd(), "data", "runtime-settings.json");
}

function parsePositiveInt(raw: string, fallback: number, min = 1): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

function parseNonNegInt(raw: string, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

/** Env + built-in defaults (no runtime overrides). */
export function envRuntimeSettings(): RuntimeSettings {
  return {
    mentionScanConcurrency: parseNonNegInt(
      runtimeEnv("CHARACTER_MENTION_CONCURRENCY", String(MENTION_SCAN_CONCURRENCY_DEFAULT)),
      MENTION_SCAN_CONCURRENCY_DEFAULT,
    ),
    mentionScanBatchUnits: parsePositiveInt(
      runtimeEnv("CHARACTER_MENTION_BATCH_UNITS", String(MENTION_SCAN_BATCH_UNITS_DEFAULT)),
      MENTION_SCAN_BATCH_UNITS_DEFAULT,
    ),
    mentionScanBatchChars: parsePositiveInt(
      runtimeEnv("CHARACTER_MENTION_BATCH_CHARS", String(MENTION_SCAN_BATCH_CHARS_DEFAULT)),
      MENTION_SCAN_BATCH_CHARS_DEFAULT,
      4_000,
    ),
    privilegedUnlimitedConcurrency: (() => {
      const v = runtimeEnv("CHARACTER_MENTION_PRIVILEGED_UNLIMITED", "true").toLowerCase();
      return v !== "0" && v !== "false" && v !== "no";
    })(),
    adminMentionScanBatchUnits: parsePositiveInt(
      runtimeEnv("CHARACTER_MENTION_ADMIN_BATCH_UNITS", "1"),
      1,
    ),
  };
}

function ensureLoaded(): void {
  const s = store();
  if (s.loaded) return;
  s.loaded = true;
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) return;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<RuntimeSettings>;
    if (raw && typeof raw === "object") {
      s.overrides = sanitizePartial(raw);
    }
  } catch (e) {
    console.warn("[runtime-settings] load failed:", (e as Error).message);
  }
}

function sanitizePartial(raw: Partial<RuntimeSettings>): Partial<RuntimeSettings> {
  const out: Partial<RuntimeSettings> = {};
  if (raw.mentionScanConcurrency != null) {
    out.mentionScanConcurrency = Math.max(0, Math.floor(Number(raw.mentionScanConcurrency)) || 0);
  }
  if (raw.mentionScanBatchUnits != null) {
    out.mentionScanBatchUnits = Math.max(1, Math.floor(Number(raw.mentionScanBatchUnits)) || 1);
  }
  if (raw.mentionScanBatchChars != null) {
    out.mentionScanBatchChars = Math.max(
      4_000,
      Math.floor(Number(raw.mentionScanBatchChars)) || MENTION_SCAN_BATCH_CHARS_DEFAULT,
    );
  }
  if (raw.privilegedUnlimitedConcurrency != null) {
    out.privilegedUnlimitedConcurrency = !!raw.privilegedUnlimitedConcurrency;
  }
  if (raw.adminMentionScanBatchUnits != null) {
    out.adminMentionScanBatchUnits = Math.max(
      1,
      Math.floor(Number(raw.adminMentionScanBatchUnits)) || 1,
    );
  }
  return out;
}

/** Effective base settings (env ⊕ file/memory overrides). */
export function getRuntimeSettings(): RuntimeSettings {
  ensureLoaded();
  return { ...envRuntimeSettings(), ...store().overrides };
}

/** Patch runtime overrides and persist to data/runtime-settings.json. */
export function patchRuntimeSettings(
  patch: Partial<RuntimeSettings>,
): RuntimeSettings {
  ensureLoaded();
  const s = store();
  s.overrides = { ...s.overrides, ...sanitizePartial(patch) };
  try {
    const p = settingsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(s.overrides, null, 2), "utf-8");
  } catch (e) {
    console.warn("[runtime-settings] persist failed:", (e as Error).message);
  }
  return getRuntimeSettings();
}

/** Clear runtime overrides (back to env-only). */
export function resetRuntimeSettings(): RuntimeSettings {
  const s = store();
  s.overrides = {};
  s.loaded = true;
  try {
    const p = settingsPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
  return getRuntimeSettings();
}

export function isAdminUserId(userId: string | undefined | null): boolean {
  if (!userId) return false;
  try {
    return !!getUserById(userId)?.isAdmin;
  } catch {
    return false;
  }
}

/**
 * Resolve mention-scan knobs for a call.
 * - admin / debug: unlimited concurrency (unless privilegedUnlimitedConcurrency=false)
 * - admin: batchUnits = adminMentionScanBatchUnits (default 1)
 * - normal: batchUnits/concurrency from settings (defaults 4 / 4)
 */
export function resolveMentionScanOptions(ctx?: {
  userId?: string | null;
  isAdmin?: boolean;
  isDebug?: boolean;
}): MentionScanResolved {
  const base = getRuntimeSettings();
  const admin =
    ctx?.isAdmin === true ||
    (ctx?.isAdmin !== false && isAdminUserId(ctx?.userId));
  const debug = ctx?.isDebug === true || (ctx?.isDebug !== false && isServerDebugMode());
  const privileged = admin || debug;

  let concurrency = base.mentionScanConcurrency;
  if (concurrency < 1) concurrency = MENTION_SCAN_CONCURRENCY_DEFAULT;

  let unlimitedConcurrency = false;
  if (privileged && base.privilegedUnlimitedConcurrency) {
    concurrency = MENTION_SCAN_CONCURRENCY_UNLIMITED;
    unlimitedConcurrency = true;
  }

  const batchUnits = admin
    ? base.adminMentionScanBatchUnits
    : base.mentionScanBatchUnits;

  const mode: MentionScanResolved["mode"] = admin
    ? "admin"
    : debug
      ? "debug"
      : "user";

  return {
    concurrency,
    batchUnits: Math.max(1, batchUnits),
    batchChars: base.mentionScanBatchChars,
    unlimitedConcurrency,
    mode,
  };
}
