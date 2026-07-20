/**
 * Stage-1: no suspended deictic / unanchored relation as primary name
 */
import assert from "node:assert/strict";
import { sanitizeUnitNameHit } from "../../src/core/extractor/character-unit-hit-sanitize";
import {
  isInvalidUnitPrimaryName,
  isUnanchoredRelationLabel,
} from "../../src/core/extractor/character-entity-types";

assert.ok(isUnanchoredRelationLabel("小儿子"));
assert.ok(isUnanchoredRelationLabel("女朋友"));
assert.ok(isUnanchoredRelationLabel("他爸"));
assert.ok(!isUnanchoredRelationLabel("周屿"));
assert.ok(!isUnanchoredRelationLabel("许老师"));
assert.ok(!isUnanchoredRelationLabel("周屿的父亲")); // has anchor stem X的Y

// Drop pure suspended
assert.equal(sanitizeUnitNameHit({ name: "小儿子", aliases: [] }), null);
assert.equal(sanitizeUnitNameHit({ name: "女朋友", aliases: [] }), null);
assert.equal(sanitizeUnitNameHit({ name: "他", aliases: [] }), null);
assert.equal(sanitizeUnitNameHit({ name: "他爸", aliases: [] }), null);

// Promote real name from aliases (not 小儿子)
{
  const h = sanitizeUnitNameHit({
    name: "小儿子",
    aliases: ["周屿", "屿哥"],
  });
  assert.ok(h);
  assert.ok(h!.name === "周屿" || h!.name === "屿哥", `got ${h!.name}`);
  assert.notEqual(h!.name, "小儿子");
  assert.ok(h!.aliases.includes("小儿子") || h!.aliases.includes("屿哥"));
}

// Prefer real name over title-ish when both present (soft orient)
{
  const h = sanitizeUnitNameHit({
    name: "齐天大圣",
    aliases: ["孙悟空"],
  });
  assert.ok(h);
  assert.equal(h!.name, "孙悟空");
}

// Solid epithet alone OK
{
  const h = sanitizeUnitNameHit({ name: "平头大叔", aliases: [] });
  assert.ok(h);
  assert.equal(h!.name, "平头大叔");
}

// 许老师 OK as sole name (not pure 老师)
{
  const h = sanitizeUnitNameHit({ name: "许老师", aliases: [] });
  assert.ok(h);
  assert.equal(h!.name, "许老师");
}

assert.ok(isInvalidUnitPrimaryName("女朋友"));
assert.ok(!isInvalidUnitPrimaryName("许栀"));

console.log("character-unit-hit-sanitize.test.ts OK");
