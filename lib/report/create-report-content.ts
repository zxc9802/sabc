import type { AssessmentRecord, MessageRecord, ReportContent } from "@/lib/storage/db";

export function createReportContent(
  assessment: AssessmentRecord,
  messages: MessageRecord[],
): ReportContent {
  const dimensions = Object.values(assessment.scored.dimensions);
  const evidence = dimensions.flatMap((dimension) => dimension.evidence);
  const risks = [
    ...assessment.scored.confirmedVetoes,
    ...assessment.scored.suspectedVetoes,
  ].map((risk) => risk.reason);
  const opportunities = unique(
    dimensions.flatMap((dimension) => dimension.facts),
  ).slice(0, 8);
  const confirmedFacts = unique(
    evidence
      .filter((item) => item.state === "verified")
      .map((item) => item.statement),
  ).slice(0, 12);
  const userStatements = unique(
    evidence
      .filter(
        (item) => item.origin === "user_input" && item.state !== "missing",
      )
      .map((item) => item.statement),
  ).slice(0, 12);
  const gaps = unique(assessment.scored.criticalUnknowns);

  return {
    decisionSummary: `${assessment.analysis.projectName} 当前为 ${assessment.scored.eligibleFinalGrade} 级，${assessment.scored.totalScore} 分，证据置信度 ${assessment.scored.confidence}%。${assessment.analysis.categoryReason}`,
    opportunities,
    risks,
    confirmedFacts,
    userStatements,
    assumptionsAndGaps: gaps,
    nextActions: ["按当前证据执行一次小规模、可回退的验证。"],
    upgradeConditions: gaps.map((gap) => `补齐并验证：${gap}`),
    conversationSummary: messages.map((message) => {
      const speaker =
        message.role === "user"
          ? "项目方"
          : message.stage === "advisory"
            ? "项目建议智能体"
            : "AI 访谈员";
      return `${speaker}：${message.content.slice(0, 240)}`;
    }),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
