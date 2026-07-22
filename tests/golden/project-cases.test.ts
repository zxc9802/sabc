import { describe, expect, it } from "vitest";

import { getRubric } from "@/lib/rubric/catalog";
import { scoreAssessment } from "@/lib/scoring/score-assessment";

import { goldenProjectCases } from "./project-cases";

describe("cross-domain golden project cases", () => {
  for (const projectCase of goldenProjectCases) {
    it(projectCase.label, () => {
      const rubric = getRubric(projectCase.category);
      const scored = scoreAssessment({
        category: projectCase.category,
        dimensions: projectCase.dimensions,
        vetoRisks: projectCase.vetoRisks,
      });

      expect(projectCase.dimensions).toHaveLength(7);
      for (const dimension of projectCase.dimensions) {
        expect(dimension.evidence.map((item) => item.slotId).sort()).toEqual(
          rubric.slots[dimension.dimension].map((slot) => slot.id).sort(),
        );
      }
      expect(scored.totalScore).toBeGreaterThanOrEqual(
        projectCase.expectedTotalRange[0],
      );
      expect(scored.totalScore).toBeLessThanOrEqual(
        projectCase.expectedTotalRange[1],
      );
      expect(scored.confidence).toBeGreaterThanOrEqual(
        projectCase.expectedConfidenceRange[0],
      );
      expect(scored.confidence).toBeLessThanOrEqual(
        projectCase.expectedConfidenceRange[1],
      );
      expect(scored.eligibleFinalGrade).toBe(projectCase.expectedGrade);
    });
  }
});
