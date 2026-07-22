import type {
  CategoryId,
  DimensionAnalysis,
  DimensionKey,
  EvidenceItem,
  EvidenceState,
  VetoRisk,
} from "@/lib/domain/types";
import { getRubric } from "@/lib/rubric/catalog";
import { expect, it } from "vitest";

import { scoreAssessment } from "./score-assessment";

const DIMENSION_KEYS: DimensionKey[] = [
  "strategic_value",
  "demand_evidence",
  "return_potential",
  "execution_feasibility",
  "resource_fit",
  "timing_differentiation",
  "risk_control",
];

function evidenceFor(
  dimension: DimensionKey,
  state: EvidenceState,
  category: CategoryId = "general",
): EvidenceItem[] {
  return getRubric(category).slots[dimension].map((slot) => ({
    slotId: slot.id,
    statement: `${slot.label}测试证据`,
    state,
    origin: "user_input",
  }));
}

function dimension(
  key: DimensionKey,
  proposedScore: number,
  state: EvidenceState,
  category: CategoryId = "general",
): DimensionAnalysis {
  return {
    dimension: key,
    proposedScore: proposedScore as DimensionAnalysis["proposedScore"],
    facts: [],
    deductions: [],
    evidence: evidenceFor(key, state, category),
  };
}

function makeAll(
  score: number,
  state: EvidenceState,
  category: CategoryId = "general",
): Parameters<typeof scoreAssessment>[0] {
  return {
    category,
    dimensions: DIMENSION_KEYS.map((key) =>
      dimension(key, score, state, category),
    ),
    vetoRisks: [],
  };
}

function makeDraftWithVeto(
  state: VetoRisk["state"],
): Parameters<typeof scoreAssessment>[0] {
  return {
    ...makeAll(4, "verified"),
    vetoRisks: [
      {
        ruleId: "illegal_or_unethical",
        state,
        reason: "测试否决",
        evidence: evidenceFor("risk_control", "verified"),
      },
    ],
  };
}

it("caps a score with only a general claim at 2", () => {
  const input = makeAll(3, "missing");
  input.dimensions = input.dimensions.map((item) =>
    item.dimension === "strategic_value"
      ? dimension("strategic_value", 5, "general_claim")
      : item,
  );

  const result = scoreAssessment(input);

  expect(result.dimensions.strategic_value.appliedScore).toBe(2);
});

it("calculates confidence from evidence states and dimension weights", () => {
  const result = scoreAssessment(makeAll(4, "verified"));

  expect(result.confidence).toBe(100);
  expect(result.totalScore).toBe(80);
  expect(result.provisionalGrade).toBe("A");
  expect(result.status).toBe("final");
});

it("counts omitted rubric slots as missing confidence", () => {
  const input = makeAll(4, "missing");
  input.dimensions[0] = {
    ...input.dimensions[0],
    evidence: [evidenceFor("strategic_value", "verified")[0]],
  };

  const result = scoreAssessment(input);

  expect(result.dimensions.strategic_value.confidence).toBe(33);
});

it("keeps a high raw score provisional when S confidence is below 80", () => {
  const result = scoreAssessment(makeAll(5, "specific_unverified"));

  expect(result.provisionalGrade).toBe("S");
  expect(result.status).toBe("provisional");
  expect(result.eligibleFinalGrade).toBe("B");
});

it("forces C only for a confirmed veto", () => {
  expect(scoreAssessment(makeDraftWithVeto("suspected")).provisionalGrade).not.toBe(
    "C",
  );

  const confirmed = scoreAssessment(makeDraftWithVeto("confirmed"));
  expect(confirmed.provisionalGrade).toBe("C");
  expect(confirmed.confirmedVetoes).toHaveLength(1);
});

it("uses all seven dimensions even when input omits some", () => {
  const result = scoreAssessment({
    category: "general",
    dimensions: [dimension("strategic_value", 3, "verified")],
    vetoRisks: [],
  });

  expect(Object.keys(result.dimensions)).toHaveLength(7);
  expect(result.dimensions.demand_evidence.appliedScore).toBe(0);
});
