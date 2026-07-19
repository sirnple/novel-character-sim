/**
 * Staging → user confirm commit must write characters to DB.
 */
import { randomUUID } from "node:crypto";
import { assert, suiteAsync, testAsync } from "../lib/test-harness";
import {
  deleteNovel,
  importNovel,
  getCharacters,
  getNovelForm,
  getStoryInfo,
} from "../../src/lib/db";
import { initRegistry } from "../../src/core/agents/init";
import { getTool } from "../../src/core/agents/registry";
import { beginNovelAnalysisWorkspace } from "../../src/core/extractor/novel-analysis-workspace";
import { commitAnalysisWorkspace } from "../../src/core/agents/commit-analysis";
import { ANALYSIS_OK } from "../../src/core/agents/agents/analysis-tools";
import type { LLMProvider } from "../../src/types";

const dummyLlm = {} as LLMProvider;

export async function runAnalysisCommitTests(): Promise<void> {
  await suiteAsync("analysis-commit", async () => {
    await testAsync("character detail staged then commit writes DB", async () => {
      initRegistry();
      const userId = `ac_${randomUUID().slice(0, 8)}`;
      const novelId = `n_${randomUUID().slice(0, 8)}`;
      const branchId = "main";
      const text =
        "第一章\n孙悟空大闹天宫。\n\n第二章\n唐僧西行，孙悟空、猪八戒同行。\n".repeat(5);
      try {
        importNovel(userId, novelId, "西游测试书", text);
        beginNovelAnalysisWorkspace(userId, novelId, branchId, {
          fullText: text,
          forceRefresh: true,
        });
        const ctx = { userId, novelId, branchId };

        // Form → workspace
        await getTool("run_form_analysis")!.execute(
          { forceRefresh: true },
          ctx,
          dummyLlm,
        );

        // Roster entities → workspace charactersDraft
        // scan_character_mentions needs LLM; stub unit extract so catalog is non-empty
        const unitScanLlm = {
          async chatWithTool() {
            return {
              characters: [
                { name: "孙悟空", aliases: ["齐天大圣"] },
                { name: "唐僧", aliases: [] },
              ],
            };
          },
          async chat() {
            return '{"characters":[]}';
          },
        } as unknown as LLMProvider;
        await getTool("scan_character_mentions")!.execute(
          { forceRefresh: true },
          ctx,
          unitScanLlm,
        );
        const ent = await getTool("submit_character_entities")!.execute(
          {
            entities_json: JSON.stringify([
              {
                name: "孙悟空",
                aliases: ["齐天大圣"],
                role: "protagonist",
                briefDescription: "石猴",
                surfaces: ["孙悟空", "齐天大圣"],
              },
              {
                name: "唐僧",
                aliases: ["玄奘"],
                role: "protagonist",
                briefDescription: "取经人",
                surfaces: ["唐僧"],
              },
            ]),
          },
          ctx,
          dummyLlm,
        );
        assert.ok(ent.content.includes("角色实体已存"), ent.content);
        assert.equal(
          getCharacters(userId, novelId).length,
          0,
          "must not write characters before commit",
        );

        // Personality-only must be rejected (was accepted before → DB only 性格)
        const onlyPers = await getTool("submit_character_detail")!.execute(
          {
            name: "孙悟空",
            detail_json: JSON.stringify({
              personality: {
                traits: ["叛逆"],
                description: "桀骜不驯的石猴大王",
              },
            }),
          },
          ctx,
          dummyLlm,
        );
        assert.ok(
          onlyPers.content.includes("过空") ||
            onlyPers.content.includes("维度不足") ||
            onlyPers.content.includes("未写入"),
          onlyPers.content,
        );

        // Full multi-dimension detail
        const det = await getTool("submit_character_detail")!.execute(
          {
            name: "孙悟空",
            detail_json: JSON.stringify({
              appearance: { summary: "毛脸雷公嘴，火眼金睛，身穿虎皮裙" },
              personality: {
                traits: ["叛逆", "义气", "急躁"],
                description: "桀骜不驯的石猴，重情重义却易冲动",
                decisionStyle: "冲动果敢",
                underPressure: "以武力应对",
              },
              drive: {
                goal: "自由自在",
                motivation: "不愿受天条束缚",
                fear: "再被压五行山",
                weakness: "急躁骄傲",
                bottomLine: "不背叛师父",
                secret: "曾大闹天宫",
              },
              behavior: {
                patterns: ["遇事先动武"],
                habits: ["挠头"],
                attitudeToAuthority: "挑战权威",
              },
              worldview: "强者为尊，公道自在人心",
              values: ["义气", "自由"],
              speakingStyle: {
                description: "口快心直，常自称俺老孙",
                catchphrases: ["俺老孙"],
                sentenceStyle: "短促有力",
                vocabulary: "市井口语",
                emotionalExpression: "怒时吼骂",
              },
              background: {
                origin: "花果山石猴",
                keyEvents: ["拜师菩提", "大闹天宫", "西行取经"],
                description: "从妖王到取经弟子",
              },
            }),
          },
          ctx,
          dummyLlm,
        );
        assert.ok(det.content.includes(ANALYSIS_OK.detail), det.content);
        assert.equal(getCharacters(userId, novelId).length, 0);

        // Relationships
        const rel = await getTool("submit_character_relationships")!.execute(
          {
            edges_json: JSON.stringify([
              {
                from: "孙悟空",
                to: "唐僧",
                type: "master_disciple",
                description: "师徒",
              },
            ]),
          },
          ctx,
          dummyLlm,
        );
        assert.ok(rel.content.includes(ANALYSIS_OK.rels), rel.content);
        assert.ok(rel.content.includes("挂接 1") || rel.content.includes("挂接"), rel.content);

        // Empty detail must be rejected
        const emptyDet = await getTool("submit_character_detail")!.execute(
          { name: "唐僧", detail_json: "{}" },
          ctx,
          dummyLlm,
        );
        assert.ok(emptyDet.content.includes("过空") || emptyDet.content.includes("未写入"), emptyDet.content);

        const result = commitAnalysisWorkspace({ userId, novelId, branchId });
        assert.ok(result.ok, result.content);
        assert.ok(
          result.committed.some((c) => c.includes("characters")),
          `expected characters committed, got ${result.committed.join(",")}`,
        );
        assert.ok(
          result.committed.some((c) => c.includes("detail=")),
          result.committed.join(","),
        );
        const chars = getCharacters(userId, novelId);
        assert.ok(chars.length >= 2, `expected >=2 chars, got ${chars.length}`);
        const wukong = chars.find((c) => c.name === "孙悟空");
        assert.ok(wukong, "孙悟空 in DB");
        assert.ok(
          (wukong!.personality?.description || "").includes("桀骜") ||
            (wukong!.appearance?.summary || "").includes("毛脸"),
          JSON.stringify(wukong),
        );
        assert.ok(
          (wukong!.drive?.goal || "").includes("自由"),
          `expected drive.goal, got ${JSON.stringify(wukong!.drive)}`,
        );
        assert.ok(
          (wukong!.behavior?.patterns || []).length > 0,
          `expected behavior patterns, got ${JSON.stringify(wukong!.behavior)}`,
        );
        assert.ok(
          (wukong!.speakingStyle?.description || "").length > 0,
          `expected speakingStyle`,
        );
        assert.ok(
          (wukong!.relationships || []).some((r) => r.characterName === "唐僧"),
          `expected relationship on 孙悟空, got ${JSON.stringify(wukong!.relationships)}`,
        );
        assert.ok(getNovelForm(userId, novelId), "form in DB");
      } finally {
        deleteNovel(userId, novelId);
      }
    });

    await testAsync("commit without userConfirmed path rejects empty confirm", async () => {
      initRegistry();
      const finish = getTool("finish_novel_analysis")!;
      const r = await finish.execute(
        {},
        { userId: "u", novelId: "n", branchId: "main" },
        dummyLlm,
      );
      assert.ok(r.content.includes("未落库"), r.content);
    });
  });
}
