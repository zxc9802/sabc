import { expect, it } from "vitest";

import { DIMENSIONS } from "@/lib/rubric/catalog";
import type { ResearchSnapshotRecord } from "@/lib/research/research-types";
import type {
  AssessmentRecord,
  ProjectRecord,
} from "@/lib/storage/db";

import { createAdvisorContext } from "./advisor-context";

function fixture(): {
  project: ProjectRecord;
  assessment: AssessmentRecord;
  researchSnapshot: ResearchSnapshotRecord;
} {
  const project: ProjectRecord = {
    id: "project-1",
    name: "跨境口红项目",
    description: "在新加坡销售口红",
    primaryCategory: "ecommerce",
    status: "final",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T01:00:00.000Z",
  };
  const dimensions = Object.fromEntries(
    DIMENSIONS.map(({ key, weight }) => [
      key,
      {
        proposedScore: 4,
        appliedScore: 4,
        weightedScore: weight * 0.8,
        confidence: 80,
        facts: Array.from({ length: 10 }, (_, index) => `事实 ${index + 1}`),
        deductions: Array.from(
          { length: 10 },
          (_, index) => `扣分 ${index + 1}`,
        ),
        evidence: [],
      },
    ]),
  ) as AssessmentRecord["scored"]["dimensions"];
  const assessment = {
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
      categoryReason: "面向海外消费者的电商项目",
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
  } satisfies AssessmentRecord;
  const researchSnapshot: ResearchSnapshotRecord = {
    id: "research-1",
    projectId: project.id,
    queries: ["新加坡口红 市场需求"],
    sources: [
      {
        title: "市场调研报告",
        url: "https://example.com/market-report",
        snippet: "公开市场资料",
        query: "新加坡口红 市场需求",
      },
    ],
    status: "completed",
    createdAt: "2026-07-22T01:30:00.000Z",
    updatedAt: "2026-07-22T01:30:00.000Z",
  };
  return { project, assessment, researchSnapshot };
}

it("creates a bounded advisor context without requiring a report", () => {
  const { project, assessment, researchSnapshot } = fixture();
  const context = createAdvisorContext(project, assessment, researchSnapshot);

  expect(context).toMatchObject({
    projectId: project.id,
    projectName: project.name,
    grade: "A",
    totalScore: 78,
    confidence: 80,
    researchStatus: "completed",
  });
  expect(context.dimensions).toHaveLength(7);
  expect(context.dimensions[0].facts).toHaveLength(8);
  expect(context.dimensions[0].deductions).toHaveLength(8);
  expect(context.sources).toEqual([
    { title: "市场调研报告", url: "https://example.com/market-report" },
  ]);
  expect(context).not.toHaveProperty("report");
});
