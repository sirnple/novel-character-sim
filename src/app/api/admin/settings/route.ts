import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/core/prompts/admin-auth";
import {
  envRuntimeSettings,
  getRuntimeSettings,
  patchRuntimeSettings,
  resetRuntimeSettings,
  setNovelCleanOverrides,
  type RuntimeSettings,
} from "@/lib/runtime-settings";
import {
  CHARACTER_COREF_ENV_KEYS,
  CHARACTER_COREF_FIELD_DOCS,
  resolveCharacterCorefConfig,
} from "@/lib/character-coref-config";
import {
  NOVEL_CLEAN_DEFAULTS,
  NOVEL_CLEAN_FIELD_DOCS,
  resolveNovelCleanConfig,
  validateNovelCleanPatterns,
  type NovelCleanConfig,
} from "@/lib/novel-clean-config";

export const dynamic = "force-dynamic";

const COREF_RUNTIME_KEYS: (keyof RuntimeSettings)[] = [
  "corefWindowChars",
  "corefOverlapChars",
  "corefAutoMergeThreshold",
  "corefGreyLowThreshold",
  "corefWeightExclusive",
  "corefWeightJaccard",
  "corefJaccardSparseMinCount",
  "corefJaccardSparseDiscount",
  "corefTemporalHighOverlap",
  "corefTemporalMidOverlap",
  "corefTemporalPenaltyHigh",
  "corefTemporalPenaltyMid",
  "corefTemporalPenaltyLow",
  "corefChunkGapMax",
  "corefAliasHardMergeMin",
  "corefAliasBucketMax",
  "corefGreyContextChars",
  "corefHardRejectSameUnit",
  "corefHardRejectGenderConflict",
  "corefHardRejectAgeConflict",
  "corefHardMergeSameFullName",
];

/** GET — current effective settings + env bootstrap + docs. */
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const effective = getRuntimeSettings();
  return NextResponse.json({
    effective,
    envDefaults: envRuntimeSettings(),
    corefResolved: resolveCharacterCorefConfig(undefined, effective),
    novelCleanResolved: resolveNovelCleanConfig(undefined, effective),
    novelCleanDefaults: NOVEL_CLEAN_DEFAULTS,
    docs: {
      mentionScanConcurrency: "普通用户并行 LLM 数，默认 4",
      mentionScanBatchUnits: "普通用户每 call 打包 unit 数，默认 4",
      mentionScanBatchChars: "每 call 正文字符预算，默认 16000",
      privilegedMentionScanConcurrency:
        "admin/debug 并行 LLM 数，默认 20（更高但仍限流友好，非一次拉满）",
      adminMentionScanBatchUnits: "管理员每 call unit 数，默认 1",
      coref: CHARACTER_COREF_FIELD_DOCS,
      novelClean: NOVEL_CLEAN_FIELD_DOCS,
      env: [
        "CHARACTER_MENTION_CONCURRENCY",
        "CHARACTER_MENTION_BATCH_UNITS",
        "CHARACTER_MENTION_BATCH_CHARS",
        "CHARACTER_MENTION_PRIVILEGED_CONCURRENCY",
        "CHARACTER_MENTION_ADMIN_BATCH_UNITS",
        ...Object.values(CHARACTER_COREF_ENV_KEYS),
        "NOVEL_CLEAN_ENABLED",
      ],
      howTo:
        "1) .env.local 写 CHARACTER_* / NOVEL_CLEAN_ENABLED 后重启；2) Admin「运行配置」PATCH 写入 data/runtime-settings.json 立即生效（含 novelClean）；3) 代码/测试传 partial。优先级：调用参数 > runtime-settings.json > env > 内置默认。",
    },
  });
}

/** PATCH — merge runtime overrides (persisted under data/runtime-settings.json). */
export async function PATCH(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  try {
    const body = (await req.json()) as Partial<RuntimeSettings> & {
      reset?: boolean;
      /** Drop novelClean overrides only (keep coref/mention). */
      clearNovelClean?: boolean;
      /**
       * When true with novelClean, replace overrides entirely instead of deep-merge.
       * Admin UI saves full form this way.
       */
      replaceNovelClean?: boolean;
    };
    if (body.reset) {
      return NextResponse.json({
        ok: true,
        effective: resetRuntimeSettings(),
      });
    }

    if (body.clearNovelClean) {
      const effective = setNovelCleanOverrides(null);
      return NextResponse.json({
        ok: true,
        effective,
        novelCleanResolved: resolveNovelCleanConfig(undefined, effective),
        novelCleanDefaults: NOVEL_CLEAN_DEFAULTS,
      });
    }

    const patch: Partial<RuntimeSettings> = {};
    const mentionKeys: (keyof RuntimeSettings)[] = [
      "mentionScanConcurrency",
      "mentionScanBatchUnits",
      "mentionScanBatchChars",
      "privilegedMentionScanConcurrency",
      "adminMentionScanBatchUnits",
    ];
    for (const k of [...mentionKeys, ...COREF_RUNTIME_KEYS]) {
      if (body[k] !== undefined) {
        (patch as Record<string, unknown>)[k] = body[k];
      }
    }

    if (body.novelClean !== undefined) {
      const nc = body.novelClean as Partial<NovelCleanConfig>;
      const errs = validateNovelCleanPatterns(nc || {});
      if (errs.length) {
        return NextResponse.json(
          {
            error: "novelClean 正则无效",
            details: errs,
          },
          { status: 400 },
        );
      }
      if (body.replaceNovelClean) {
        const effective = setNovelCleanOverrides(nc);
        // Still apply mention/coref patch if any
        const after =
          Object.keys(patch).length > 0
            ? patchRuntimeSettings(patch)
            : effective;
        return NextResponse.json({
          ok: true,
          effective: after,
          corefResolved: resolveCharacterCorefConfig(undefined, after),
          novelCleanResolved: resolveNovelCleanConfig(undefined, after),
          novelCleanDefaults: NOVEL_CLEAN_DEFAULTS,
        });
      }
      patch.novelClean = nc;
    }

    const effective = patchRuntimeSettings(patch);
    return NextResponse.json({
      ok: true,
      effective,
      corefResolved: resolveCharacterCorefConfig(undefined, effective),
      novelCleanResolved: resolveNovelCleanConfig(undefined, effective),
      novelCleanDefaults: NOVEL_CLEAN_DEFAULTS,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid body" },
      { status: 400 },
    );
  }
}
