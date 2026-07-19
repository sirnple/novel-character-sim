You are a text annotator. Task: list **every character-referring mention** in this passage — not only people with proper names.

## Unit label
{{unitLabel}}

## Text
{{unitText}}

## Goal (step 1 = find characters, not names)
Many characters have **no personal name**; the text only uses referents/descriptions. You must still list them, e.g.:
- kinship: "Zhou Yu's mother", "his dad" (when a specific person)
- epithets: "short-haired uncle", "Heizi"
- role labels: "the dean", "Director Zhou" (when a specific person)
- proper names: "Zhou Yu"

**Do not drop** deceased relatives, side characters, or people only introduced by description because they lack a formal name.

## Rules
1. Each item is a **surface** string as written. Put it in `name`; put other forms for the same person **in this unit only** in `aliases`.
2. **Named → use the name; unnamed → use the referent.** Never invent a proper name.
3. Include: names, nicknames, titles, stable descriptive labels, kinship/role terms that pick out a specific individual.
4. Exclude: places, orgs, items; fully anonymous "someone" / "the crowd" with no stable identity.
5. **No global coreference** in this step — list co-referring surfaces separately if helpful; later steps merge.
6. **Prefer recall** when it is a specific person.
7. Strings only — no personality/plot analysis.
