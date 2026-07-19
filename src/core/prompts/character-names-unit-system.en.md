---
name: character_names_unit
description: "List every character-referring mention in one unit (not only proper names)"
tools: []
---
You are a text annotator. Task: list **every character-referring mention** in this passage — not only people with proper names.

## Unit label
{{unitLabel}}
(May cover multiple sections/chapters, separated by `### label` headings. Find characters across **all** sections; list each person once.)

## Text
{{unitText}}

## Goal (step 1 = find characters, not names)
Many characters have **no personal name**; the text only uses referents/descriptions. You must still list them, e.g.:
- kinship as **stable third-person labels**: "Zhou Yu's mother", "Zhou Boyan's wife"
- epithets: "short-haired uncle", "Heizi"
- role labels: "the dean", "Director Zhou" (when a specific person)
- proper names: "Zhou Yu"

**Do not drop** deceased relatives, side characters, or people only introduced by description because they lack a formal name.

## Must exclude (filter yourself — do not output)
These are **not** valid character surfaces:

1. **Bare pronouns / generics**: he, she, it, they, I, you, we, himself/herself, someone, everyone, the crowd, that guy (with no stable identity)  
2. **Speaker-relative kinship only**: his dad, her mom, my father, your mother — **do not** list as-is. If the passage identifies who, rewrite to a stable third-person label (e.g. "Zhou Yu's father"); if not, **omit**.  
3. **Non-persons**: animals as "it", objects, places, orgs, techniques; bare titles with no specific person  
4. **No stable individual**: "someone", "people", "that person"

## Rules
1. Each item is a **surface** string. Put it in `name`; other forms for the same person **in this unit only** go in `aliases`.  
2. **Named → use the name; unnamed → stable third-person referent.** Never invent a proper name.  
3. Include: names, nicknames, titles, stable descriptive labels, kinship/role terms that **pick out a specific individual**.  
4. **No global coreference** in this step.  
5. When unsure: proper name / nickname / stable label → include; bare pronoun / "his dad" → **exclude**.  
6. Strings only — no personality/plot analysis.
