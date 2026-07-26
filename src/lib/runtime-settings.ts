/**
 * Central runtime settings: env defaults + in-process overrides (admin API / UI).
 * Prefer this over reading process.env in call sites.
 *
 * Mention-scan keys:
 * - CHARACTER_MENTION_CONCURRENCY
 * - CHARACTER_MENTION_BATCH_UNITS
 * - CHARACTER_MENTION_BATCH_CHARS
 * - CHARACTER_MENTION_PRIVILEGED_CONCURRENCY  (admin/debug parallel; default 30)
 * - CHARACTER_MENTION_ADMIN_BATCH_UNITS
 *
 * Coref keys (window / residual co-occur) — see character-coref-config.ts + design §10:
 * - CHARACTER_COREF_WINDOW_CHARS / OVERLAP_CHARS
 * - CHARACTER_COREF_AUTO_MERGE_THRESHOLD / GREY_LOW_THRESHOLD
 * - CHARACTER_COREF_WEIGHT_EXCLUSIVE / WEIGHT_JACCARD
 * - … (full list in CHARACTER_COREF_ENV_KEYS)
 */
import fs from "fs";
import path from "path";
import { runtimeEnv } from "@/lib/runtime-env";
import { isServerDebugMode } from "@/lib/debug-mode";
import { getUserById } from "@/lib/db";
import {
  CHARACTER_COREF_DEFAULTS,
  CHARACTER_COREF_ENV_KEYS,
  resolveCharacterCorefConfig,
  type CharacterCorefConfig,
} from "@/lib/character-coref-config";

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

/**
 * Admin/debug parallel LLM calls — higher than users, but not "fire everything"
 * (vendor rate limits). Override via env / admin UI.
 */
export const MENTION_SCAN_PRIVILEGED_CONCURRENCY_DEFAULT = 30;

// ── Schema ──────────────────────────────────────────────────────────

export interface RuntimeSettings {
  /** Parallel mention-scan LLM calls for normal users. */
  mentionScanConcurrency: number;
  /** Units per LLM call for normal users. */
  mentionScanBatchUnits: number;
  mentionScanBatchChars: number;
  /** Parallel LLM calls for admin / debug (default 30, not unlimited). */
  privilegedMentionScanConcurrency: number;
  /** Admin batch units override (default 1). */
  adminMentionScanBatchUnits: number;

  // ── Character coref (①② + residual) ──
  corefWindowChars: number;
  corefOverlapChars: number;
  corefAutoMergeThreshold: number;
  corefGreyLowThreshold: number;
  corefWeightExclusive: number;
  corefWeightJaccard: number;
  corefJaccardSparseMinCount: number;
  corefJaccardSparseDiscount: number;
  corefTemporalHighOverlap: number;
  corefTemporalMidOverlap: number;
  corefTemporalPenaltyHigh: number;
  corefTemporalPenaltyMid: number;
  corefTemporalPenaltyLow: number;
  corefChunkGapMax: number;
  corefAliasHardMergeMin: number;
  corefAliasBucketMax: number;
  corefGreyContextChars: number;
  corefHardRejectSameUnit: boolean;
  corefHardRejectGenderConflict: boolean;
  corefHardRejectAgeConflict: boolean;
  corefHardMergeSameFullName: boolean;
}

export interface MentionScanResolved {
  concurrency: number;
  batchUnits: number;
  batchChars: number;
  /** True when using privileged (higher) concurrency tier. */
  privilegedConcurrency: boolean;
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

function parseNumber(raw: string, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function parseBool(raw: string, fallback: boolean): boolean {
  const t = (raw || "").trim().toLowerCase();
  if (!t) return fallback;
  if (t === "1" || t === "true" || t === "yes" || t === "on") return true;
  if (t === "0" || t === "false" || t === "no" || t === "off") return false;
  return fallback;
}

const D = CHARACTER_COREF_DEFAULTS;
const E = CHARACTER_COREF_ENV_KEYS;

/** Env + built-in defaults (no runtime overrides). */
export function envRuntimeSettings(): RuntimeSettings {
  return {
    mentionScanConcurrency: parsePositiveInt(
      runtimeEnv(
        "CHARACTER_MENTION_CONCURRENCY",
        String(MENTION_SCAN_CONCURRENCY_DEFAULT),
      ),
      MENTION_SCAN_CONCURRENCY_DEFAULT,
    ),
    mentionScanBatchUnits: parsePositiveInt(
      runtimeEnv(
        "CHARACTER_MENTION_BATCH_UNITS",
        String(MENTION_SCAN_BATCH_UNITS_DEFAULT),
      ),
      MENTION_SCAN_BATCH_UNITS_DEFAULT,
    ),
    mentionScanBatchChars: parsePositiveInt(
      runtimeEnv(
        "CHARACTER_MENTION_BATCH_CHARS",
        String(MENTION_SCAN_BATCH_CHARS_DEFAULT),
      ),
      MENTION_SCAN_BATCH_CHARS_DEFAULT,
      4_000,
    ),
    privilegedMentionScanConcurrency: parsePositiveInt(
      runtimeEnv(
        "CHARACTER_MENTION_PRIVILEGED_CONCURRENCY",
        String(MENTION_SCAN_PRIVILEGED_CONCURRENCY_DEFAULT),
      ),
      MENTION_SCAN_PRIVILEGED_CONCURRENCY_DEFAULT,
    ),
    adminMentionScanBatchUnits: parsePositiveInt(
      runtimeEnv("CHARACTER_MENTION_ADMIN_BATCH_UNITS", "1"),
      1,
    ),

    corefWindowChars: parsePositiveInt(
      runtimeEnv(E.windowChars, String(D.windowChars)),
      D.windowChars,
      500,
    ),
    corefOverlapChars: parsePositiveInt(
      runtimeEnv(E.overlapChars, String(D.overlapChars)),
      D.overlapChars,
      0,
    ),
    corefAutoMergeThreshold: parseNumber(
      runtimeEnv(E.autoMergeThreshold, String(D.autoMergeThreshold)),
      D.autoMergeThreshold,
    ),
    corefGreyLowThreshold: parseNumber(
      runtimeEnv(E.greyLowThreshold, String(D.greyLowThreshold)),
      D.greyLowThreshold,
    ),
    corefWeightExclusive: parseNumber(
      runtimeEnv(E.weightExclusive, String(D.weightExclusive)),
      D.weightExclusive,
    ),
    corefWeightJaccard: parseNumber(
      runtimeEnv(E.weightJaccard, String(D.weightJaccard)),
      D.weightJaccard,
    ),
    corefJaccardSparseMinCount: parsePositiveInt(
      runtimeEnv(E.jaccardSparseMinCount, String(D.jaccardSparseMinCount)),
      D.jaccardSparseMinCount,
    ),
    corefJaccardSparseDiscount: parseNumber(
      runtimeEnv(E.jaccardSparseDiscount, String(D.jaccardSparseDiscount)),
      D.jaccardSparseDiscount,
    ),
    corefTemporalHighOverlap: parseNumber(
      runtimeEnv(E.temporalHighOverlap, String(D.temporalHighOverlap)),
      D.temporalHighOverlap,
    ),
    corefTemporalMidOverlap: parseNumber(
      runtimeEnv(E.temporalMidOverlap, String(D.temporalMidOverlap)),
      D.temporalMidOverlap,
    ),
    corefTemporalPenaltyHigh: parseNumber(
      runtimeEnv(E.temporalPenaltyHigh, String(D.temporalPenaltyHigh)),
      D.temporalPenaltyHigh,
    ),
    corefTemporalPenaltyMid: parseNumber(
      runtimeEnv(E.temporalPenaltyMid, String(D.temporalPenaltyMid)),
      D.temporalPenaltyMid,
    ),
    corefTemporalPenaltyLow: parseNumber(
      runtimeEnv(E.temporalPenaltyLow, String(D.temporalPenaltyLow)),
      D.temporalPenaltyLow,
    ),
    corefChunkGapMax: parsePositiveInt(
      runtimeEnv(E.chunkGapMax, String(D.chunkGapMax)),
      D.chunkGapMax,
      0,
    ),
    corefAliasHardMergeMin: parsePositiveInt(
      runtimeEnv(E.aliasHardMergeMin, String(D.aliasHardMergeMin)),
      D.aliasHardMergeMin,
    ),
    corefAliasBucketMax: parsePositiveInt(
      runtimeEnv(E.aliasBucketMax, String(D.aliasBucketMax)),
      D.aliasBucketMax,
      0,
    ),
    corefGreyContextChars: parsePositiveInt(
      runtimeEnv(E.greyContextChars, String(D.greyContextChars)),
      D.greyContextChars,
      50,
    ),
    corefHardRejectSameUnit: parseBool(
      runtimeEnv(E.hardRejectSameUnit, String(D.hardRejectSameUnit)),
      D.hardRejectSameUnit,
    ),
    corefHardRejectGenderConflict: parseBool(
      runtimeEnv(
        E.hardRejectGenderConflict,
        String(D.hardRejectGenderConflict),
      ),
      D.hardRejectGenderConflict,
    ),
    corefHardRejectAgeConflict: parseBool(
      runtimeEnv(E.hardRejectAgeConflict, String(D.hardRejectAgeConflict)),
      D.hardRejectAgeConflict,
    ),
    corefHardMergeSameFullName: parseBool(
      runtimeEnv(E.hardMergeSameFullName, String(D.hardMergeSameFullName)),
      D.hardMergeSameFullName,
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
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<RuntimeSettings> & {
      privilegedUnlimitedConcurrency?: boolean;
    };
    if (raw && typeof raw === "object") {
      s.overrides = sanitizePartial(raw);
    }
  } catch (e) {
    console.warn("[runtime-settings] load failed:", (e as Error).message);
  }
}

function optNum(
  out: Partial<RuntimeSettings>,
  key: keyof RuntimeSettings,
  raw: unknown,
  opts?: { min?: number; floor?: boolean },
): void {
  if (raw == null) return;
  const n = Number(raw);
  if (!Number.isFinite(n)) return;
  let v = opts?.floor ? Math.floor(n) : n;
  if (opts?.min != null) v = Math.max(opts.min, v);
  (out as Record<string, unknown>)[key] = v;
}

function optBool(
  out: Partial<RuntimeSettings>,
  key: keyof RuntimeSettings,
  raw: unknown,
): void {
  if (raw == null) return;
  if (typeof raw === "boolean") {
    (out as Record<string, unknown>)[key] = raw;
    return;
  }
  if (typeof raw === "string" || typeof raw === "number") {
    (out as Record<string, unknown>)[key] = parseBool(String(raw), false);
  }
}

function sanitizePartial(raw: Partial<RuntimeSettings>): Partial<RuntimeSettings> {
  const out: Partial<RuntimeSettings> = {};

  optNum(out, "mentionScanConcurrency", raw.mentionScanConcurrency, {
    min: 1,
    floor: true,
  });
  optNum(out, "mentionScanBatchUnits", raw.mentionScanBatchUnits, {
    min: 1,
    floor: true,
  });
  optNum(out, "mentionScanBatchChars", raw.mentionScanBatchChars, {
    min: 4_000,
    floor: true,
  });
  optNum(
    out,
    "privilegedMentionScanConcurrency",
    raw.privilegedMentionScanConcurrency,
    { min: 1, floor: true },
  );
  optNum(out, "adminMentionScanBatchUnits", raw.adminMentionScanBatchUnits, {
    min: 1,
    floor: true,
  });

  optNum(out, "corefWindowChars", raw.corefWindowChars, { min: 500, floor: true });
  optNum(out, "corefOverlapChars", raw.corefOverlapChars, { min: 0, floor: true });
  optNum(out, "corefAutoMergeThreshold", raw.corefAutoMergeThreshold);
  optNum(out, "corefGreyLowThreshold", raw.corefGreyLowThreshold);
  optNum(out, "corefWeightExclusive", raw.corefWeightExclusive);
  optNum(out, "corefWeightJaccard", raw.corefWeightJaccard);
  optNum(out, "corefJaccardSparseMinCount", raw.corefJaccardSparseMinCount, {
    min: 1,
    floor: true,
  });
  optNum(out, "corefJaccardSparseDiscount", raw.corefJaccardSparseDiscount);
  optNum(out, "corefTemporalHighOverlap", raw.corefTemporalHighOverlap);
  optNum(out, "corefTemporalMidOverlap", raw.corefTemporalMidOverlap);
  optNum(out, "corefTemporalPenaltyHigh", raw.corefTemporalPenaltyHigh);
  optNum(out, "corefTemporalPenaltyMid", raw.corefTemporalPenaltyMid);
  optNum(out, "corefTemporalPenaltyLow", raw.corefTemporalPenaltyLow);
  optNum(out, "corefChunkGapMax", raw.corefChunkGapMax, { min: 0, floor: true });
  optNum(out, "corefAliasHardMergeMin", raw.corefAliasHardMergeMin, {
    min: 1,
    floor: true,
  });
  optNum(out, "corefAliasBucketMax", raw.corefAliasBucketMax, {
    min: 0,
    floor: true,
  });
  optNum(out, "corefGreyContextChars", raw.corefGreyContextChars, {
    min: 50,
    floor: true,
  });
  optBool(out, "corefHardRejectSameUnit", raw.corefHardRejectSameUnit);
  optBool(
    out,
    "corefHardRejectGenderConflict",
    raw.corefHardRejectGenderConflict,
  );
  optBool(out, "corefHardRejectAgeConflict", raw.corefHardRejectAgeConflict);
  optBool(out, "corefHardMergeSameFullName", raw.corefHardMergeSameFullName);

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
 * - admin / debug: privileged concurrency (default 30), not uncapped
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
  const debug =
    ctx?.isDebug === true ||
    (ctx?.isDebug !== false && isServerDebugMode());
  const privileged = admin || debug;

  const concurrency = privileged
    ? Math.max(1, base.privilegedMentionScanConcurrency)
    : Math.max(1, base.mentionScanConcurrency);

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
    privilegedConcurrency: privileged,
    mode,
  };
}

/** Resolved coref knobs (env ⊕ runtime overrides ⊕ optional call-site patch). */
export function getCharacterCorefConfig(
  partial?: Partial<CharacterCorefConfig>,
): CharacterCorefConfig {
  return resolveCharacterCorefConfig(partial, getRuntimeSettings());
}
