import { expect, it } from "vitest";

import { DIMENSIONS } from "@/lib/rubric/catalog";
import type { AssessmentRecord } from "@/lib/storage/db";

import { createStageAssessmentContext } from "./stage-assessment-context";

it("creates a bounded stage assessment context for final analysis", () => {
  const dimensions = Object.fromEntries(
    DIMENSIONS.map(({ key, weight }) => [
      key,
      {
        proposedScore: 4,
        appliedScore: 4,
        weightedScore: weight * 0.8,
        confidence: 80,
        facts: ["已验证事实"],
        deductions: ["仍需验证"],
        evidence: [],
      },
    ]),
  ) as AssessmentRecord["scored"]["dimensions"];
  const assessment = {
    analysis: { categoryReason: "海外电商" },
    researchStatus: "completed",
    scored: {
      eligibleFinalGrade: "A",
      totalScore: 78,
      confidence: 80,
      dimensions,
    },
  } as AssessmentRecord;

  const context = createStageAssessmentContext(assessment);

  expect(context).toMatchObject({
    grade: "A",
    totalScore: 78,
    confidence: 80,
    researchStatus: "completed",
  });
  expect(context.dimensions).toHaveLength(7);
});
