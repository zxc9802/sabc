import type { QuestionCandidate } from "@/lib/domain/types";
import { expect, it } from "vitest";

import { selectNextQuestion } from "./select-next-question";

const candidates: QuestionCandidate[] = [
  {
    id: "q1",
    prompt: "高影响需求问题",
    reason: "验证需求",
    targetDimension: "demand_evidence",
    impact: 90,
    quickOptions: ["是", "否"],
  },
  {
    id: "q2",
    prompt: "否决风险问题",
    reason: "澄清合规风险",
    targetDimension: "risk_control",
    impact: 70,
    quickOptions: ["是", "否"],
    addressesVetoRuleId: "illegal_or_unethical",
  },
  {
    id: "q3",
    prompt: "低影响问题",
    reason: "补充信息",
    targetDimension: "timing_differentiation",
    impact: 20,
    quickOptions: ["是", "否"],
  },
];

it("chooses a suspected veto question before a higher numeric impact", () => {
  const selected = selectNextQuestion({
    candidates,
    questionHistory: [],
    suspectedVetoRuleIds: ["illegal_or_unethical"],
    interviewDepth: "medium",
    command: null,
  });

  expect(selected?.addressesVetoRuleId).toBe("illegal_or_unethical");
});

it("continues selecting after more than six prior questions", () => {
  const questionHistory = Array.from({ length: 7 }, (_, index) => ({
    id: `old-${index}`,
    targetDimension: "strategic_value" as const,
  }));

  const selected = selectNextQuestion({
    candidates,
    questionHistory,
    suspectedVetoRuleIds: [],
    interviewDepth: "high",
    command: null,
  });

  expect(selected?.id).toBe("q1");
});

it("moves to another dimension after one low-depth question", () => {
  const selected = selectNextQuestion({
    candidates,
    questionHistory: [
      { id: "old-demand", targetDimension: "demand_evidence" },
    ],
    suspectedVetoRuleIds: [],
    interviewDepth: "low",
    command: null,
  });

  expect(selected?.targetDimension).not.toBe("demand_evidence");
});

it("allows three medium-depth questions in the same dimension", () => {
  const selected = selectNextQuestion({
    candidates,
    questionHistory: [
      { id: "old-demand-1", targetDimension: "demand_evidence" },
      { id: "old-demand-2", targetDimension: "demand_evidence" },
    ],
    suspectedVetoRuleIds: [],
    interviewDepth: "medium",
    command: null,
  });

  expect(selected?.targetDimension).toBe("demand_evidence");
});

it("skips the current chain and finish returns no question", () => {
  const base = {
    candidates,
    questionHistory: [
      { id: "old-demand", targetDimension: "demand_evidence" as const },
    ],
    suspectedVetoRuleIds: [],
    interviewDepth: "high" as const,
  };

  expect(
    selectNextQuestion({ ...base, command: "skip" })?.targetDimension,
  ).not.toBe("demand_evidence");
  expect(selectNextQuestion({ ...base, command: "finish" })).toBeNull();
});

it("skips question ids that were already asked", () => {
  const selected = selectNextQuestion({
    candidates,
    questionHistory: [{ id: "q2", targetDimension: "risk_control" }],
    suspectedVetoRuleIds: ["illegal_or_unethical"],
    interviewDepth: "high",
    command: null,
  });

  expect(selected?.id).toBe("q1");
});
