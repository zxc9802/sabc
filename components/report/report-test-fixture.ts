import { DIMENSIONS } from "@/lib/rubric/catalog";
import type {
  AssessmentRecord,
  FinalReportRecord,
  ProjectRecord,
} from "@/lib/storage/db";

export function reportFixture(): {
  project: ProjectRecord;
  report: FinalReportRecord;
} {
  const project: ProjectRecord = {
    id: "project-1",
    name: "跨境口红项目",
    description: "在新加坡销售口红",
    primaryCategory: "ecommerce",
    status: "final",
    interviewDepth: "medium",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T01:00:00.000Z",
  };
  const dimensions = Object.fromEntries(
    DIMENSIONS.map(({ key, label, weight }) => [
      key,
      {
        proposedScore: 4,
        appliedScore: 4,
        weightedScore: weight * 0.8,
        confidence: 80,
        facts: [`${label}已有证据`],
        deductions: [],
        evidence: [],
      },
    ]),
  ) as unknown as AssessmentRecord["scored"]["dimensions"];
  const assessment: AssessmentRecord = {
    id: "assessment-1",
    projectId: project.id,
    promptVersion: "final.v1",
    sources: [
      { title: "市场调研报告", url: "https://example.com/market-report" },
    ],
    researchStatus: "completed",
    analysis: {
      projectName: project.name,
      primaryCategory: "ecommerce",
      secondaryCategories: [],
      categoryReason: "海外电商项目",
      dimensions: [],
      vetoRisks: [],
      criticalUnknowns: [],
      questionCandidates: [],
      research: { needed: false, reason: "", queries: [] },
    },
    scored: {
      rubricVersion: "test.v1",
      dimensions,
      totalScoreRaw: 78,
      totalScore: 78,
      confidence: 80,
      provisionalGrade: "A",
      eligibleFinalGrade: "A",
      status: "final",
      suspectedVetoes: [],
      confirmedVetoes: [],
      criticalUnknowns: [],
    },
    nextQuestion: null,
    diff: null,
    createdAt: "2026-07-22T01:00:00.000Z",
  };
  return {
    project,
    report: {
      id: "report-1",
      projectId: project.id,
      assessmentId: assessment.id,
      assessmentSnapshot: assessment,
      content: {
        decisionSummary: "建议先做小规模验证，再扩大投入。",
        opportunities: ["目标客群清楚"],
        risks: ["合规要求待确认"],
        confirmedFacts: ["公开资料显示目标市场持续增长"],
        userStatements: ["项目方计划销售口红"],
        assumptionsAndGaps: ["尚无复购数据"],
        nextActions: ["完成 20 名消费者访谈"],
        upgradeConditions: ["获得 10 个真实订单"],
        conversationSummary: [
          "AI 访谈员：目前有哪些订单？",
          "项目建议智能体：建议先验证复购。",
        ],
      },
      createdAt: "2026-07-22T02:00:00.000Z",
    },
  };
}
