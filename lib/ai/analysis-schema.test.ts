import { expect, it } from "vitest";

import { analysisResponseSchema } from "./analysis-schema";

function validResponse() {
  const dimensions = [
    "strategic_value",
    "demand_evidence",
    "return_potential",
    "execution_feasibility",
    "resource_fit",
    "timing_differentiation",
    "risk_control",
  ].map((dimension) => ({
    dimension,
    proposedScore: 3,
    facts: [],
    deductions: [],
    evidence: [],
  }));

  dimensions[0].evidence.push({
    slotId: "strategic_problem_importance",
    statement: "用户提供的已发生数据",
    state: "verified",
    origin: "user_input",
  });

  return {
    projectName: "测试项目",
    primaryCategory: "software",
    secondaryCategories: [],
    categoryReason: "这是软件项目",
    dimensions,
    vetoRisks: [],
    criticalUnknowns: [],
    questionCandidates: [],
    research: { needed: false, reason: "", queries: [] },
  };
}

it("parses a valid analysis response", () => {
  expect(() => analysisResponseSchema.parse(validResponse())).not.toThrow();
});

it("rejects an unknown category", () => {
  const data = validResponse();
  data.primaryCategory = "unknown_category";
  expect(() => analysisResponseSchema.parse(data)).toThrow();
});

it("rejects a dimension score of 6", () => {
  const data = validResponse();
  data.dimensions[0].proposedScore = 6;
  expect(() => analysisResponseSchema.parse(data)).toThrow();
});

it("rejects fewer than seven dimensions", () => {
  const data = validResponse();
  data.dimensions.pop();
  expect(() => analysisResponseSchema.parse(data)).toThrow();
});

it("rejects duplicate dimension keys", () => {
  const data = validResponse();
  data.dimensions[1].dimension = "strategic_value";
  expect(() => analysisResponseSchema.parse(data)).toThrow();
});

it("rejects invalid evidence state", () => {
  const data = validResponse();
  data.dimensions[0].evidence[0].state = "partial";
  expect(() => analysisResponseSchema.parse(data)).toThrow();
});

it("rejects question impact above 100", () => {
  const data = validResponse();
  data.questionCandidates.push({
    id: "q1",
    prompt: "问题",
    reason: "原因",
    targetDimension: "demand_evidence",
    impact: 150,
    quickOptions: [],
  });
  expect(() => analysisResponseSchema.parse(data)).toThrow();
});

it("rejects a model-supplied finalGrade field", () => {
  const data = { ...validResponse(), finalGrade: "S" };
  expect(() => analysisResponseSchema.parse(data)).toThrow();
});
