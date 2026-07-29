/**
 * Display window + find cap — shipped helpers for long-novel Phase 1.
 */
import { assert, suite, test } from "../lib/test-harness";
import {
  BODY_WINDOW_CHARS,
  expandEarlier,
  loadFullWindow,
  takeTailWindow,
  toAbsoluteOffset,
} from "../../src/lib/text-window";
import {
  findMatchOffsets,
  resolveGlobalMatch,
} from "../../src/components/text-find";
import { FIND_MATCH_CAP } from "../../src/lib/text-window";

export function runTextWindowTests(): void {
  suite("text-window + findMatchOffsets", () => {
    test("takeTailWindow short text is full", () => {
      const w = takeTailWindow("短文");
      assert.equal(w.baseOffset, 0);
      assert.equal(w.hasEarlier, false);
      assert.equal(w.text, "短文");
    });

    test("takeTailWindow long text uses tail", () => {
      const full = "前".repeat(5000) + "后".repeat(BODY_WINDOW_CHARS);
      const w = takeTailWindow(full);
      assert.equal(w.totalLength, full.length);
      assert.equal(w.hasEarlier, true);
      assert.equal(w.text.length, BODY_WINDOW_CHARS);
      assert.equal(w.baseOffset, full.length - BODY_WINDOW_CHARS);
      assert.ok(w.text.startsWith("后"));
    });

    test("expandEarlier moves base toward start", () => {
      const full = "A".repeat(BODY_WINDOW_CHARS + 3000);
      let w = takeTailWindow(full);
      w = expandEarlier(full, w, 1000);
      assert.equal(w.baseOffset, full.length - BODY_WINDOW_CHARS - 1000);
      assert.equal(w.hasEarlier, true);
    });

    test("toAbsoluteOffset adds base", () => {
      const w = { text: "xyz", baseOffset: 100, totalLength: 200, hasEarlier: true };
      assert.equal(toAbsoluteOffset(w, 2), 102);
    });

    test("loadFullWindow", () => {
      const w = loadFullWindow("全文");
      assert.equal(w.hasEarlier, false);
      assert.equal(w.baseOffset, 0);
    });

    test("findMatchOffsets caps at FIND_MATCH_CAP", () => {
      const text = "的".repeat(FIND_MATCH_CAP + 50);
      const hits = findMatchOffsets(text, "的");
      assert.equal(hits.length, FIND_MATCH_CAP);
    });

    test("findMatchOffsets pure CJK without lowercasing crash", () => {
      const hits = findMatchOffsets("林晚推开木窗", "林晚");
      assert.equal(hits.length, 1);
      assert.equal(hits[0], 0);
    });

    test("resolveGlobalMatch maps across segments", () => {
      const segs = [
        [10, 4000, 8000], // body
        [2, 5], // prose
      ];
      assert.deepEqual(resolveGlobalMatch(segs, 0), {
        segmentIndex: 0,
        localOffset: 10,
      });
      assert.deepEqual(resolveGlobalMatch(segs, 2), {
        segmentIndex: 0,
        localOffset: 8000,
      });
      assert.deepEqual(resolveGlobalMatch(segs, 3), {
        segmentIndex: 1,
        localOffset: 2,
      });
      assert.equal(resolveGlobalMatch(segs, 99), null);
    });
  });
}
