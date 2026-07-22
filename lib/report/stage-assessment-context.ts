import type { DimensionKey, Grade } from "@/lib/domain/types";
import type { ResearchStatus } from "@/lib/research/research-types";
import { DIMENSIONS } from "@/lib/rubric/catalog";
import type { AssessmentRecord } from "@/lib/storage/db";

export interface StageAssessmentContext {
  grade: Grade;
  totalScore: number;
  confidence: number;
  categoryReason: string;
  researchStatus: "not_needed" | ResearchStatus;
  dimensions: Array<{
    key: DimensionKey;
    appliedScore: number;
    facts: string[];
    deductions: string[];
  }>;
}

export function createStageAssessmentContext(
  assessment: AssessmentRecord,
): StageAssessmentContext {
  return {
    grade: assessment.scored.eligibleFinalGrade,
    totalScore: assessment.scored.totalScore,
    confidence: assessment.scored.confidence,
    categoryReason: assessment.analysis.categoryReason,
    researchStatus: assessment.researchStatus,
    dimensions: DIMENSIONS.map(({ key }) => {
      const dimension = assessment.scored.dimensions[key];
      return {
        key,
        appliedScore: dimension.appliedScore,
        facts: dimension.facts.slice(0, 8),
        deductions: dimension.deductions.slice(0, 8),
      };
    }),
  };
}
