import type {
  DimensionAnalysis,
  DimensionKey,
  EvidenceItem,
  EvidenceState,
} from "@/lib/domain/types";
import { getRubric } from "@/lib/rubric/catalog";
import { expect, it } from "vitest";

import { diffAssessments } from "./assessment-diff";
import { scoreAssessment } from "./score-assessment";

function makeDimension(
  dimension: DimensionKey,
  proposedScore: number,
  state: EvidenceState,
  statement: string,
): DimensionAnalysis {
  const evidence: EvidenceItem[] = getRubric("general").slots[dimension].map(
    (slot) => ({
      slotId: slot.id,
      statement: `${statement}（${slot.label}）`,
      state,
      origin: "user_input",
    }),
  );

  return {
    dimension,
    proposedScore: proposedScore as DimensionAnalysis["proposedScore"],
    facts: statement ? [statement] : [],
    deductions: [],
    evidence,
  };
}

function makeAssessment(
  demandState: EvidenceState,
  demandStatement: string,
  demandScore: number,
) {
  return scoreAssessment({
    category: "general",
    dimensions: [
      makeDimension("strategic_value", 4, "verified", "战略匹配"),
      makeDimension(
        "demand_evidence",
        demandScore,
        demandState,
        demandStatement,
      ),
      makeDimension("return_potential", 4, "verified", "收益合理"),
      makeDimension("execution_feasibility", 4, "verified", "可执行"),
      makeDimension("resource_fit", 3, "verified", "资源匹配"),
      makeDimension("timing_differentiation", 3, "verified", "时机合适"),
      makeDimension("risk_control", 4, "verified", "风险可控"),
    ],
    vetoRisks: [],
  });
}

it("names dimensions and evidence that changed the rating", () => {
  const previous = makeAssessment("general_claim", "有需求", 2);
  const current = makeAssessment(
    "specific_unverified",
    "3 个付费意向客户",
    4,
  );

  const diff = diffAssessments(previous, current);

  expect(diff.gradeChange).toEqual({ from: "B", to: "A" });
  expect(diff.changedDimensions[0]).toMatchObject({
    dimension: "demand_evidence",
    scoreDelta: 2,
  });
  expect(diff.summary).toContain("3 个付费意向客户");
});

it("reports the first assessment as a summary", () => {
  const current = makeAssessment("verified", "需求已验证", 4);

  const diff = diffAssessments(null, current);

  expect(diff.summary).toContain("首次评级");
  expect(diff.summary).toContain(current.provisionalGrade);
});
