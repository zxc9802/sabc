import { afterEach, beforeEach, expect, it } from "vitest";

import type { ResearchSnapshotRecord } from "@/lib/research/research-types";

import type { AssessmentRecord, FinalReportRecord } from "./db";
import { db } from "./db";
import { createProjectRepository } from "./project-repository";

const repository = createProjectRepository();

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

function assessment(
  projectId: string,
  status: "provisional" | "final" = "provisional",
): AssessmentRecord {
  return {
    id: crypto.randomUUID(),
    projectId,
    promptVersion: "test.v1",
    sources: [],
    researchStatus: "not_needed",
    analysis: {
      projectName: "测试项目",
      primaryCategory: "software",
      secondaryCategories: [],
      categoryReason: "测试",
      dimensions: [],
      vetoRisks: [],
      criticalUnknowns: [],
      questionCandidates: [],
      research: { needed: false, reason: "", queries: [] },
    },
    scored: {
      rubricVersion: "test.v1",
      dimensions: {} as never,
      totalScoreRaw: 60,
      totalScore: 60,
      confidence: 50,
      provisionalGrade: "B",
      eligibleFinalGrade: "B",
      status,
      suspectedVetoes: [],
      confirmedVetoes: [],
      criticalUnknowns: [],
    },
    nextQuestion: null,
    diff: null,
    createdAt: new Date().toISOString(),
  };
}

function report(input: AssessmentRecord): FinalReportRecord {
  return {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    assessmentId: input.id,
    assessmentSnapshot: structuredClone(input),
    content: {
      decisionSummary: "先验证再投入",
      opportunities: [],
      risks: [],
      confirmedFacts: [],
      assumptionsAndGaps: [],
      nextActions: ["完成客户访谈"],
      upgradeConditions: [],
      conversationSummary: [],
    },
    createdAt: new Date().toISOString(),
  };
}

function researchSnapshot(projectId: string): ResearchSnapshotRecord {
  return {
    id: `research-${projectId}`,
    projectId,
    queries: ["跨境电商 2026 市场规模"],
    sources: [
      {
        title: "Market report",
        url: "https://example.com/report",
        snippet: "The market grew in 2026.",
        query: "跨境电商 2026 市场规模",
      },
    ],
    status: "completed",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}

it("createProject starts as draft", async () => {
  const project = await repository.createProject("做一个新软件\n更多描述");

  expect(project.status).toBe("draft");
  expect(project.name).toBe("做一个新软件");
});

it("creates projects with medium interview depth and persists changes", async () => {
  const project = await repository.createProject("depth test");

  expect(project.interviewDepth).toBe("medium");

  await repository.updateInterviewDepth(project.id, "high");
  const workspace = await repository.getProjectWorkspace(project.id);

  expect(workspace?.project.interviewDepth).toBe("high");
});

it("appendMessage preserves chronological order and round", async () => {
  const project = await repository.createProject("test");
  await repository.appendMessage({
    id: "m2",
    projectId: project.id,
    role: "assistant",
    content: "second",
    round: 1,
    createdAt: "2026-07-22T01:00:01.000Z",
  });
  await repository.appendMessage({
    id: "m1",
    projectId: project.id,
    role: "user",
    content: "first",
    round: 0,
    createdAt: "2026-07-22T01:00:00.000Z",
  });

  const workspace = await repository.getProjectWorkspace(project.id);

  expect(workspace?.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
  expect(workspace?.messages.map((message) => message.round)).toEqual([0, 1]);
});

it("saveAssessment stores a stage assessment and keeps the project provisional", async () => {
  const project = await repository.createProject("test");
  const snapshot = assessment(project.id, "final");

  await repository.saveAssessment(snapshot);
  const workspace = await repository.getProjectWorkspace(project.id);

  expect(workspace?.project.status).toBe("provisional");
  expect(workspace?.project.primaryCategory).toBe("software");
  expect(workspace?.assessments).toHaveLength(1);
  expect(workspace?.report).toBeNull();
  expect(await db.reports.where({ projectId: project.id }).count()).toBe(0);
});

it("getProjectWorkspace returns messages, assessments, and report", async () => {
  const project = await repository.createProject("test");
  const snapshot = assessment(project.id);
  await repository.saveAssessment(snapshot);
  await repository.saveFinalReport(report(snapshot));

  const workspace = await repository.getProjectWorkspace(project.id);

  expect(workspace).toMatchObject({
    project: { id: project.id, status: "provisional" },
    messages: [],
  });
  expect(workspace?.assessments).toHaveLength(1);
  expect(workspace?.report?.assessmentId).toBe(snapshot.id);
});

it("listProjects sorts by updatedAt descending", async () => {
  const first = await repository.createProject("first");
  const second = await repository.createProject("second");
  await db.projects.update(first.id, { updatedAt: "2026-07-22T00:00:00.000Z" });
  await db.projects.update(second.id, { updatedAt: "2026-07-22T00:00:01.000Z" });

  const list = await repository.listProjects();

  expect(list.map((project) => project.id)).toEqual([second.id, first.id]);
});

it("saveFinalReport keeps an immutable assessment snapshot", async () => {
  const project = await repository.createProject("test");
  const snapshot = assessment(project.id);
  await repository.saveAssessment(snapshot);
  await repository.saveFinalReport(report(snapshot));
  snapshot.scored.totalScore = 99;

  const workspace = await repository.getProjectWorkspace(project.id);

  expect(workspace?.report?.assessmentSnapshot.scored.totalScore).toBe(60);
  expect(workspace?.project.status).toBe("provisional");
});

it("stores and replaces the latest project research snapshot", async () => {
  const project = await repository.createProject("research persistence");
  const first = researchSnapshot(project.id);

  await repository.saveResearchSnapshot(first);
  await repository.saveResearchSnapshot({
    ...first,
    queries: ["跨境电商 竞争格局"],
    status: "partial",
    updatedAt: "2026-07-22T01:00:00.000Z",
  });

  const workspace = await repository.getProjectWorkspace(project.id);

  expect(workspace?.researchSnapshot).toMatchObject({
    id: first.id,
    queries: ["跨境电商 竞争格局"],
    status: "partial",
  });
  expect(await db.researchSnapshots.where({ projectId: project.id }).count()).toBe(1);
});

it("atomically saves the final assessment and report", async () => {
  const project = await repository.createProject("finalization");
  const snapshot = assessment(project.id, "final");
  const finalReport = report(snapshot);

  await repository.saveFinalization(snapshot, finalReport);

  const workspace = await repository.getProjectWorkspace(project.id);
  expect(workspace?.assessments.map(({ id }) => id)).toEqual([snapshot.id]);
  expect(workspace?.report?.id).toBe(finalReport.id);
  expect(workspace?.project.status).toBe("final");
});

it("normalizes project status from the records that actually exist", async () => {
  const untouched = await repository.createProject("untouched");
  const assessed = await repository.createProject("assessed");
  const assessedSnapshot = assessment(assessed.id, "final");
  await repository.saveAssessment(assessedSnapshot);
  const reported = await repository.createProject("reported");
  const reportedAssessment = assessment(reported.id, "final");
  await repository.saveFinalization(reportedAssessment, report(reportedAssessment));
  await db.projects.update(untouched.id, { status: "final" });
  await db.projects.update(assessed.id, { status: "draft" });
  await db.projects.update(reported.id, { status: "draft" });

  const statuses = new Map(
    (await repository.listProjects()).map(({ id, status }) => [id, status]),
  );

  expect(statuses.get(untouched.id)).toBe("draft");
  expect(statuses.get(assessed.id)).toBe("provisional");
  expect(statuses.get(reported.id)).toBe("final");
});

it("compares only projects with a saved report snapshot", async () => {
  const assessedOnly = await repository.createProject("assessment only");
  await repository.saveAssessment(assessment(assessedOnly.id, "final"));
  const reported = await repository.createProject("reported");
  const reportedAssessment = assessment(reported.id, "final");
  await repository.saveFinalization(reportedAssessment, report(reportedAssessment));

  const records = await repository.listFinalAssessments([
    assessedOnly.id,
    reported.id,
  ]);

  expect(records.map(({ project }) => project.id)).toEqual([reported.id]);
  expect(records[0].assessment.id).toBe(
    records[0].report?.assessmentSnapshot.id,
  );
});

it("atomically overwrites the previous report with the latest finalization", async () => {
  const project = await repository.createProject("regenerated report");
  const firstAssessment = assessment(project.id, "final");
  const firstReport = report(firstAssessment);
  await repository.saveFinalization(firstAssessment, firstReport);

  const nextAssessment = {
    ...assessment(project.id, "final"),
    createdAt: "2026-07-22T04:00:00.000Z",
  };
  const nextReport = {
    ...report(nextAssessment),
    createdAt: "2026-07-22T04:00:01.000Z",
  };
  await repository.saveFinalization(nextAssessment, nextReport);

  expect(await db.reports.where("projectId").equals(project.id).count()).toBe(1);
  expect((await db.reports.toArray())[0].id).toBe(nextReport.id);
  expect((await db.projects.get(project.id))?.status).toBe("final");
});

it("deleting a project removes all related records", async () => {
  const project = await repository.createProject("test");
  const snapshot = assessment(project.id);
  await repository.appendMessage({
    id: "m1",
    projectId: project.id,
    role: "user",
    content: "hello",
    round: 0,
    createdAt: new Date().toISOString(),
  });
  await repository.saveAssessment(snapshot);
  await repository.saveFinalReport(report(snapshot));
  await repository.saveResearchSnapshot(researchSnapshot(project.id));

  await repository.deleteProject(project.id);

  expect(await repository.getProjectWorkspace(project.id)).toBeNull();
  expect(await db.messages.where({ projectId: project.id }).count()).toBe(0);
  expect(await db.assessments.where({ projectId: project.id }).count()).toBe(0);
  expect(await db.evidence.where({ projectId: project.id }).count()).toBe(0);
  expect(await db.reports.where({ projectId: project.id }).count()).toBe(0);
  expect(await db.researchSnapshots.where({ projectId: project.id }).count()).toBe(0);
});

it("reopening the database retains records", async () => {
  const project = await repository.createProject("persistent");
  db.close();
  await db.open();

  expect((await repository.getProjectWorkspace(project.id))?.project.name).toBe(
    "persistent",
  );
});

it("a failed assessment transaction does not leave an orphan snapshot", async () => {
  const orphan = assessment("missing-project");

  await expect(repository.saveAssessment(orphan)).rejects.toMatchObject({
    code: "project_not_found",
  });
  expect(await db.assessments.count()).toBe(0);
});
