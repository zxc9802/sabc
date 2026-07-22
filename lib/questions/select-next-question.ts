import type {
  AskedQuestion,
  InterviewDepth,
  QuestionCandidate,
  VetoRisk,
} from "@/lib/domain/types";
import { DIMENSIONS } from "@/lib/rubric/catalog";

import type { InterviewCommand } from "./interview-command";

export interface SelectNextQuestionInput {
  candidates: QuestionCandidate[];
  questionHistory: AskedQuestion[];
  suspectedVetoRuleIds: VetoRisk["ruleId"][];
  interviewDepth: InterviewDepth;
  command: InterviewCommand | null;
}

export function selectNextQuestion(
  input: SelectNextQuestionInput
): QuestionCandidate | null {
  if (input.command === "finish") return null;

  const askedIds = new Set(input.questionHistory.map(({ id }) => id));
  let remaining = input.candidates.filter(
    ({ id }) => !askedIds.has(id),
  );
  const currentDimension = input.questionHistory.at(-1)?.targetDimension;

  if (currentDimension && input.command === "skip") {
    remaining = remaining.filter(
      ({ targetDimension }) => targetDimension !== currentDimension,
    );
  } else if (currentDimension && input.interviewDepth !== "high") {
    const cap = input.interviewDepth === "low" ? 1 : 3;
    const reversedHistory = input.questionHistory.toReversed();
    const firstDifferentIndex = reversedHistory.findIndex(
      ({ targetDimension }) => targetDimension !== currentDimension,
    );
    const chainDepth =
      firstDifferentIndex === -1
        ? reversedHistory.length
        : firstDifferentIndex;

    if (chainDepth >= cap) {
      remaining = remaining.filter(
        ({ targetDimension }) => targetDimension !== currentDimension,
      );
    }
  }

  if (remaining.length === 0) return null;

  const sorted = remaining.toSorted((a, b) => {
    const aRuleId = a.addressesVetoRuleId;
    const bRuleId = b.addressesVetoRuleId;
    const aAddressesVeto =
      !!aRuleId && input.suspectedVetoRuleIds.includes(aRuleId);
    const bAddressesVeto =
      !!bRuleId && input.suspectedVetoRuleIds.includes(bRuleId);

    if (aAddressesVeto && !bAddressesVeto) return -1;
    if (!aAddressesVeto && bAddressesVeto) return 1;

    if (b.impact !== a.impact) return b.impact - a.impact;

    const weightA = DIMENSIONS.find((d) => d.key === a.targetDimension)?.weight ?? 0;
    const weightB = DIMENSIONS.find((d) => d.key === b.targetDimension)?.weight ?? 0;
    if (weightB !== weightA) return weightB - weightA;

    return a.id.localeCompare(b.id);
  });

  return sorted[0] ?? null;
}

