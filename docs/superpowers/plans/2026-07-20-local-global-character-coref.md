# Plan: 局部消解 + 全书消解

**Spec:** `docs/superpowers/specs/2026-07-20-local-global-character-coref-design.md`  
**Date:** 2026-07-20

## PR / 提交切分

### P1 — 阶段 1 契约（局部必须消解） ✅

- [x] 改 `character-names-unit-system.md` + `.en.md`
- [x] 更新 `UNIT_NAME_SCHEMA` description

### P2 — 局部实体汇总 ✅

- [x] `LocalEntity` + `buildLocalEntitiesFromUnitHits`
- [x] workspace `localEntities`；char-job + scan_character_mentions 写入

### P3 — 阶段 2 工具：merge / split / 未覆盖 ✅

- [x] `applyEntityOps` merge/split
- [x] submit 支持 ops + 未覆盖反馈
- [x] `list_uncovered_surfaces` / `list_local_entities`
- [x] `scripts/tests/character-entity-ops.test.ts`

### P4 — 全局 Agent 与 job 接线 ✅

- [x] entity-resolve system prompts zh/en
- [x] maxSteps 48 + 新工具
- [x] char-job / analysis-tools 接线

### P5 — 验证

- [ ] 用《超凡都市》整书跑 `analyze_character_list` 抽检三对
- [x] ops 单测通过

## 实现顺序

P1 → P2 → P3 → P4 → P5（可 P1+P2 同提交，P3+P4 同提交）

## 非目标

- 启发式硬合  
- 大改 gate/detail  
