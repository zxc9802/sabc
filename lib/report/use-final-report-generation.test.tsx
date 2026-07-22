import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";
import { DIMENSIONS } from "@/lib/rubric/catalog";
import type {
  AssessmentRecord,
  ProjectRecord,
  ProjectWorkspaceRecord,
} from "@/lib/storage/db";
import type { ProjectRepository } from "@/lib/storage/project-repository";

import { encodeFinalReportStreamEvent } from "./final-report-stream";
import { useFinalReportGeneration } from "./use-final-report-generation";

const project: ProjectRecord = {
  id: "project-1",
  name: "跨境项目",
  description: "在新加坡销售口红",
  primaryCategory: "ecommerce",
  status: "provisional",
  interviewDepth: "medium",
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
      facts: [`${key} 事实`],
      deductions: [],
      evidence: [],
    },
  ]),
) as AssessmentRecord["scored"]["dimensions"];

function result(): AnalyzeProjectResponse {
  return {
    projectId: project.id,
    projectName: project.name,
    primaryCategory: "ecommerce",
    secondaryCategories: [],
    categoryReason: "海外电商",
    promptVersion: "report.v1",
    analysis: {
      projectName: project.name,
      primaryCategory: "ecommerce",
      secondaryCategories: [],
      categoryReason: "海外电商",
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
    sources: [{ title: "市场来源", url: "https://example.com/market" }],
    researchStatus: "completed",
  };
}

function workspace(): ProjectWorkspaceRecord {
  const stageAssessment: AssessmentRecord = {
    id: "stage-assessment-1",
    projectId: project.id,
    promptVersion: "stage.v1",
    sources: result().sources,
    researchStatus: "completed",
    analysis: result().analysis,
    scored: result().scored,
    nextQuestion: null,
    diff: null,
    createdAt: "2026-07-22T01:00:00.000Z",
  };
  return {
    project,
    messages: [
      {
        id: "interview-1",
        projectId: project.id,
        role: "user",
        content: project.description,
        round: 0,
        createdAt: project.createdAt,
        stage: "interview",
        kind: "chat",
      },
      {
        id: "advisor-1",
        projectId: project.id,
        role: "assistant",
        content: "根据调研建议为 A 级。",
        round: 0,
        createdAt: "2026-07-22T02:00:00.000Z",
        stage: "advisory",
        kind: "chat",
      },
    ],
    assessments: [stageAssessment],
    researchSnapshot: {
      id: "research-1",
      projectId: project.id,
      queries: ["新加坡口红 市场"],
      sources: [
        {
          title: "市场来源",
          url: "https://example.com/market",
          snippet: "市场信息",
          query: "新加坡口红 市场",
        },
      ],
      status: "completed",
      createdAt: "2026-07-22T01:00:00.000Z",
      updatedAt: "2026-07-22T01:00:00.000Z",
    },
    report: null,
  };
}

function repository(value: ProjectWorkspaceRecord): ProjectRepository {
  return {
    createProject: vi.fn(),
    updateInterviewDepth: vi.fn(),
    appendMessage: vi.fn(),
    saveResearchSnapshot: vi.fn(),
    saveAssessment: vi.fn(),
    saveFinalReport: vi.fn(),
    saveFinalization: vi.fn(),
    getProjectWorkspace: vi.fn(async () => value),
    listProjects: vi.fn(async () => [value.project]),
    listFinalAssessments: vi.fn(async () => []),
    deleteProject: vi.fn(),
  };
}

function successResponse(): Response {
  return new Response(
    [
      encodeFinalReportStreamEvent({ type: "status", stage: "analyzing" }),
      encodeFinalReportStreamEvent({ type: "status", stage: "scoring" }),
      encodeFinalReportStreamEvent({ type: "assessment", result: result() }),
      encodeFinalReportStreamEvent({ type: "complete" }),
    ].join(""),
  );
}

beforeEach(() => {
  let id = 0;
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => `generated-${++id}`) });
});

it("generates and saves a final report only when generate is called", async () => {
  const value = workspace();
  const repo = repository(value);
  const fetcher = vi.fn().mockResolvedValue(successResponse());
  const { result: hook } = renderHook(() =>
    useFinalReportGeneration({ projectId: project.id, repository: repo, fetcher }),
  );

  expect(fetcher).not.toHaveBeenCalled();
  let completed = false;
  await act(async () => {
    completed = await hook.current.generate();
  });

  expect(completed).toBe(true);
  expect(fetcher).toHaveBeenCalledWith("/api/report", expect.any(Object));
  expect(repo.saveFinalization).toHaveBeenCalledWith(
    expect.objectContaining({ promptVersion: "report.v1" }),
    expect.objectContaining({ assessmentId: expect.any(String) }),
  );
  expect(hook.current.phase).toBe("idle");
});

it("keeps provider failures out of storage", async () => {
  const repo = repository(workspace());
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      encodeFinalReportStreamEvent({
        type: "error",
        stage: "analyzing",
        code: "provider_timeout",
        message: "生成超时",
        retryable: true,
      }),
    ),
  );
  const { result: hook } = renderHook(() =>
    useFinalReportGeneration({ projectId: project.id, repository: repo, fetcher }),
  );

  await act(async () => {
    await hook.current.generate();
  });

  expect(hook.current.error?.code).toBe("provider_timeout");
  expect(repo.saveFinalization).not.toHaveBeenCalled();
});

it("retries only the local transaction after a save failure", async () => {
  const repo = repository(workspace());
  vi.mocked(repo.saveFinalization)
    .mockRejectedValueOnce(new Error("storage full"))
    .mockResolvedValueOnce(undefined);
  const fetcher = vi.fn().mockResolvedValue(successResponse());
  const { result: hook } = renderHook(() =>
    useFinalReportGeneration({ projectId: project.id, repository: repo, fetcher }),
  );

  await act(async () => {
    await hook.current.generate();
  });
  expect(hook.current.error?.code).toBe("storage_failed");
  await act(async () => {
    await hook.current.retrySave();
  });

  expect(fetcher).toHaveBeenCalledOnce();
  expect(repo.saveFinalization).toHaveBeenCalledTimes(2);
  expect(hook.current.error).toBeNull();
});
