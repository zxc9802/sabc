import { expect, it } from "vitest";

import type { AssessmentRecord, MessageRecord } from "@/lib/storage/db";

import { createReportContent } from "./create-report-content";

it("separates interview statements from verified external evidence", () => {
  const userEvidence = {
    slotId: "demand-user",
    statement: "用户称已有 12 个真实订单",
    state: "specific_unverified" as const,
    origin: "user_input" as const,
  };
  const externalEvidence = {
    slotId: "demand-market",
    statement: "公开报告显示目标市场仍在增长",
    state: "verified" as const,
    origin: "external_source" as const,
    sourceTitle: "Official market report",
    sourceUrl: "https://example.com/market",
  };
  const assessment = {
    id: "assessment-1",
    projectId: "project-1",
    promptVersion: "final.v1",
    sources: [
      { title: "Official market report", url: "https://example.com/market" },
    ],
    researchStatus: "completed",
    analysis: {
      projectName: "海外电商项目",
      primaryCategory: "ecommerce",
      secondaryCategories: [],
      categoryReason: "面向公开市场的电商项目",
      dimensions: [],
      vetoRisks: [],
      criticalUnknowns: [],
      questionCandidates: [],
      research: { needed: false, reason: "", queries: [] },
    },
    scored: {
      rubricVersion: "test.v1",
      dimensions: {
        demand_evidence: {
          proposedScore: 4,
          appliedScore: 4,
          weightedScore: 16,
          confidence: 80,
          facts: ["目标市场存在需求"],
          deductions: [],
          evidence: [userEvidence, externalEvidence],
        },
      },
      totalScoreRaw: 72,
      totalScore: 72,
      confidence: 76,
      provisionalGrade: "A",
      eligibleFinalGrade: "A",
      status: "final",
      suspectedVetoes: [],
      confirmedVetoes: [],
      criticalUnknowns: [],
    },
    nextQuestion: null,
    diff: null,
    createdAt: "2026-07-22T00:00:00.000Z",
  } as unknown as AssessmentRecord;
  const messages: MessageRecord[] = [
    {
      id: "message-1",
      projectId: "project-1",
      role: "user",
      content: "我们已有 12 个真实订单",
      round: 0,
      createdAt: "2026-07-22T00:00:00.000Z",
    },
    {
      id: "advisor-1",
      projectId: "project-1",
      role: "assistant",
      content: "根据调研建议先验证复购",
      round: 0,
      createdAt: "2026-07-22T00:00:01.000Z",
      stage: "advisory",
      kind: "advisor_summary",
    },
  ];

  const report = createReportContent(assessment, messages);

  expect(report.userStatements).toEqual(["用户称已有 12 个真实订单"]);
  expect(report.confirmedFacts).toEqual(["公开报告显示目标市场仍在增长"]);
  expect(report.conversationSummary[0]).toContain("项目方：");
  expect(report.conversationSummary[1]).toContain("项目建议智能体：");
  expect(report.conversationSummary).toHaveLength(2);
});
