import { ContinuityReviewer } from "./continuity-reviewer";
import { CharacterReviewer } from "./character-reviewer";
import { LiteraryReviewer } from "./literary-reviewer";
import type { ReviewResult } from "./types";

export interface FullReviewResult {
  continuity: ReviewResult;
  character: ReviewResult;
  literary: ReviewResult;
  allPassed: boolean;
  totalIssues: number;
}

/**
 * Run all three reviewers against a generated draft.
 * Returns individual results plus summary.
 */
export async function runFullReview(input: {
  draft: string;
  timelineEvents: string;
  characterStates: string;
  writingStyle: string;
}): Promise<FullReviewResult> {
  const [continuity, character, literary] = await Promise.all([
    new ContinuityReviewer().review({
      draft: input.draft,
      timelineEvents: input.timelineEvents,
      characterStates: input.characterStates
    }),
    new CharacterReviewer().review({
      draft: input.draft,
      characterStates: input.characterStates
    }),
    new LiteraryReviewer().review({
      draft: input.draft,
      writingStyle: input.writingStyle
    })
  ]);

  const allIssues = [
    ...continuity.issues,
    ...character.issues,
    ...literary.issues
  ];

  return {
    continuity,
    character,
    literary,
    allPassed: continuity.pass && character.pass && literary.pass,
    totalIssues: allIssues.length
  };
}

export { ContinuityReviewer, CharacterReviewer, LiteraryReviewer };
export type { ReviewResult, ReviewIssue } from "./types";
