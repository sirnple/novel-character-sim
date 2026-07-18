/**
 * Share overview snapshot builder — no body text, character whitelist.
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  buildSharePayload,
  mintShareToken,
  toShareCharacter,
} from "../../src/lib/share-payload";
import type { CharacterProfile, StoryInfo } from "../../src/types";

function minimalCharacter(over: Partial<CharacterProfile> & { name: string }): CharacterProfile {
  return {
    id: over.id || "c1",
    name: over.name,
    aliases: over.aliases || [],
    appearance: over.appearance || { summary: "" },
    personality: over.personality || {
      traits: [],
      description: "",
      decisionStyle: "",
      underPressure: "",
    },
    drive: over.drive || {
      goal: "",
      motivation: "",
      fear: "",
      weakness: "",
      bottomLine: "",
      secret: "",
    },
    behavior: over.behavior || {
      patterns: [],
      habits: [],
      attitudeToAuthority: "",
    },
    worldview: over.worldview || "",
    values: over.values || [],
    speakingStyle: over.speakingStyle || {
      description: "",
      catchphrases: [],
      sentenceStyle: "",
      vocabulary: "",
      emotionalExpression: "",
    },
    voice: over.voice || { description: "" },
    background: over.background || {
      origin: "",
      keyEvents: [],
      description: "",
    },
    relationships: over.relationships || [],
  };
}

export function runSharePayloadTests(): void {
  suite("share-payload", () => {
    test("mintShareToken is long enough and url-safe-ish", () => {
      const t = mintShareToken();
      assert.ok(t.length >= 20);
      assert.equal(t, encodeURIComponent(t));
      const t2 = mintShareToken();
      assert.notEqual(t, t2);
    });

    test("toShareCharacter omits secret and non-whitelist fields", () => {
      const full = minimalCharacter({
        name: "林黛玉",
        aliases: ["颦颦"],
        appearance: { summary: "娇弱" },
        personality: {
          traits: ["敏感"],
          description: "多愁",
          decisionStyle: "感性",
          underPressure: "哭",
        },
        drive: {
          goal: "真情",
          motivation: "孤独",
          fear: "抛弃",
          weakness: "体弱",
          bottomLine: "不屈",
          secret: "绝密不可外传",
        },
        relationships: [
          {
            characterId: "x",
            characterName: "贾宝玉",
            type: "知己",
            description: "木石前盟",
            history: "long history should not fully force include",
            dynamics: "密",
          },
        ],
      });
      const s = toShareCharacter(full);
      const json = JSON.stringify(s);
      assert.equal(s.name, "林黛玉");
      assert.deepEqual(s.aliases, ["颦颦"]);
      assert.equal(s.drive?.goal, "真情");
      assert.equal(s.drive?.motivation, "孤独");
      assert.equal(s.drive?.fear, "抛弃");
      assert.ok(!("secret" in (s.drive || {})));
      assert.ok(!json.includes("绝密不可外传"));
      assert.ok(!("decisionStyle" in (s.personality || {})));
      assert.ok(!("weakness" in (s.drive || {})));
      assert.ok(!("background" in s));
      assert.ok(!("speakingStyle" in s));
      assert.equal(s.relationships?.[0]?.characterName, "贾宝玉");
      assert.equal(s.relationships?.[0]?.type, "知己");
      assert.equal(s.relationships?.[0]?.description, "木石前盟");
      assert.ok(!("history" in (s.relationships?.[0] || {})));
    });

    test("buildSharePayload snapshots story and characters without body", () => {
      const story = {
        title: "红楼",
        plotSummary: "情",
        mainStoryline: "主线",
        subPlots: [],
        chapterOutlines: [],
        worldSetting: {
          timePeriod: "清",
          location: "大观园",
          socialStructure: "",
          powerSystem: "",
          factions: [],
          rules: [],
          atmosphere: "",
        },
        backgroundInfo: "",
        themes: ["悲剧"],
        writingStyle: {
          genre: "",
          styleDescription: "",
          narrativeTechniques: [],
          languageFeatures: "",
          pacingDescription: "",
          tone: "",
          examplePassages: [],
          contentRating: "G",
        },
      } as StoryInfo;

      const payload = buildSharePayload({
        title: "红楼梦",
        language: "zh",
        story,
        characters: [
          minimalCharacter({
            name: "宝玉",
            drive: {
              goal: " equanimity",
              motivation: "",
              fear: "",
              weakness: "",
              bottomLine: "",
              secret: "BODY_TEXT_LEAK_TEST",
            },
          }),
        ],
        generatedAt: "2026-07-19T00:00:00.000Z",
      });

      assert.equal(payload.version, 1);
      assert.equal(payload.title, "红楼梦");
      assert.equal(payload.language, "zh");
      assert.equal(payload.generatedAt, "2026-07-19T00:00:00.000Z");
      assert.equal(payload.story?.plotSummary, "情");
      assert.equal(payload.characters.length, 1);
      const dump = JSON.stringify(payload);
      assert.ok(!dump.includes("BODY_TEXT_LEAK_TEST"));
      assert.ok(!("text" in payload));
      assert.ok(!dump.includes("fullText"));
    });

    test("buildSharePayload allows null story and empty characters separately", () => {
      const onlyStory = buildSharePayload({
        title: "T",
        story: {
          title: "T",
          plotSummary: "p",
          mainStoryline: "",
          subPlots: [],
          chapterOutlines: [],
          worldSetting: {
            timePeriod: "",
            location: "",
            socialStructure: "",
            powerSystem: "",
            factions: [],
            rules: [],
            atmosphere: "",
          },
          backgroundInfo: "",
          themes: [],
          writingStyle: {
            genre: "",
            styleDescription: "",
            narrativeTechniques: [],
            languageFeatures: "",
            pacingDescription: "",
            tone: "",
            examplePassages: [],
            contentRating: "G",
          },
        } as StoryInfo,
        characters: [],
      });
      assert.ok(onlyStory.story);
      assert.equal(onlyStory.characters.length, 0);

      const onlyChars = buildSharePayload({
        title: "T",
        story: null,
        characters: [minimalCharacter({ name: "A" })],
      });
      assert.equal(onlyChars.story, null);
      assert.equal(onlyChars.characters.length, 1);
    });
  });
}
