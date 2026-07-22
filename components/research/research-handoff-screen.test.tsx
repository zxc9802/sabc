import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";
import { DIMENSIONS } from "@/lib/rubric/catalog";
import type { ResearchSnapshotRecord } from "@/lib/research/research-types";
import type {
  AssessmentRecord,
  FinalReportRecord,
  MessageRecord,
  ProjectRecord,
  ProjectWorkspaceRecord,
} from "@/lib/storage/db";
import type { ProjectRepository } from "@/lib/storage/project-repository";
import { encodeFinalizeStreamEvent } from "@/lib/streaming/finalize-stream";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
}));

import { ResearchHandoffScreen } from "./research-handoff-screen";

const project: ProjectRecord = {
  id: "project-1",
  name: "跨境项目",
  description: "在新加坡销售口红",
  primaryCategory: "ecommerce",
  status: "draft",
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
      facts: [`${key} 已验证`],
      deductions: [],
      evidence: [],
    },
  ]),
) as AssessmentRecord["scored"]["dimensions"];

const finalResult: AnalyzeProjectResponse = {
  projectId: project.id,
  projectName: project.name,
  primaryCategory: "ecommerce",
  secondaryCategories: [],
  categoryReason: "海外电商项目",
  promptVersion: "final.v1",
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
  sources: [{ title: "市场报告", url: "https://example.com/market" }],
  researchStatus: "completed",
};

const snapshot: ResearchSnapshotRecord = {
  id: "research-project-1",
  projectId: project.id,
  queries: ["新加坡 口红 市场"],
  sources: [
    {
      title: "市场报告",
      url: "https://example.com/market",
      snippet: "市场持续增长。",
      query: "新加坡 口红 市场",
    },
  ],
  status: "completed",
  createdAt: "2026-07-22T02:00:00.000Z",
  updatedAt: "2026-07-22T02:00:00.000Z",
};

function finalizationResponse(): Response {
  return new Response(
    [
      encodeFinalizeStreamEvent({ type: "status", stage: "planning_research" }),
      encodeFinalizeStreamEvent({ type: "research_plan", queries: snapshot.queries }),
      encodeFinalizeStreamEvent({ type: "status", stage: "researching" }),
      encodeFinalizeStreamEvent({ type: "research_complete", snapshot }),
      encodeFinalizeStreamEvent({ type: "status", stage: "analyzing" }),
      encodeFinalizeStreamEvent({ type: "status", stage: "scoring" }),
      encodeFinalizeStreamEvent({ type: "assessment", result: finalResult }),
      encodeFinalizeStreamEvent({ type: "complete" }),
    ].join(""),
  );
}

function createRepository(input?: {
  report?: FinalReportRecord | null;
  assessment?: AssessmentRecord;
  summary?: MessageRecord;
}): { repository: ProjectRepository; workspace: ProjectWorkspaceRecord } {
  const workspace: ProjectWorkspaceRecord = {
    project: { ...project },
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
      ...(input?.summary ? [input.summary] : []),
    ],
    assessments: input?.assessment
      ? [input.assessment]
      : input?.report
        ? [input.report.assessmentSnapshot]
        : [],
    researchSnapshot: input?.assessment || input?.report ? snapshot : null,
    report: input?.report ?? null,
  };
  const repository: ProjectRepository = {
    createProject: vi.fn(),
    updateInterviewDepth: vi.fn(),
    appendMessage: vi.fn(async (message) => {
      workspace.messages.push(message);
    }),
    saveResearchSnapshot: vi.fn(async (value) => {
      workspace.researchSnapshot = value;
    }),
    saveAssessment: vi.fn(async (assessment) => {
      workspace.assessments.push(assessment);
      workspace.project = {
        ...workspace.project,
        status: "provisional",
      };
    }),
    saveFinalReport: vi.fn(),
    saveFinalization: vi.fn(async (assessment, report) => {
      workspace.assessments.push(assessment);
      workspace.report = report;
      workspace.project = {
        ...workspace.project,
        status: assessment.scored.status,
      };
    }),
    getProjectWorkspace: vi.fn(async () => workspace),
    listProjects: vi.fn(async () => [workspace.project]),
    listFinalAssessments: vi.fn(async () => []),
    deleteProject: vi.fn(),
  };
  return { repository, workspace };
}

function savedReport(): FinalReportRecord {
  const assessment: AssessmentRecord = {
    id: "assessment-1",
    projectId: project.id,
    promptVersion: finalResult.promptVersion,
    sources: finalResult.sources,
    researchStatus: finalResult.researchStatus,
    analysis: finalResult.analysis,
    scored: finalResult.scored,
    nextQuestion: null,
    diff: null,
    createdAt: "2026-07-22T03:00:00.000Z",
  };
  return {
    id: "report-1",
    projectId: project.id,
    assessmentId: assessment.id,
    assessmentSnapshot: assessment,
    content: {
      decisionSummary: "建议先验证需求。",
      opportunities: [],
      risks: [],
      confirmedFacts: [],
      assumptionsAndGaps: [],
      nextActions: [],
      upgradeConditions: [],
      conversationSummary: [],
    },
    createdAt: "2026-07-22T03:00:01.000Z",
  };
}

beforeEach(() => {
  navigation.replace.mockReset();
  let nextId = 0;
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => `generated-${++nextId}`),
  });
});

it("saves only the stage assessment and enters the second agent", async () => {
  const { repository, workspace } = createRepository();
  const fetcher = vi.fn().mockResolvedValueOnce(finalizationResponse());
  render(
    <ResearchHandoffScreen
      projectId={project.id}
      repository={repository}
      fetcher={fetcher}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "正在调研你的项目" }),
  ).toBeVisible();
  await waitFor(() => {
    expect(navigation.replace).toHaveBeenCalledWith("/advisor/project-1");
  });

  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/finalize"]);
  expect(workspace.assessments).toHaveLength(1);
  expect(workspace.report).toBeNull();
  expect(workspace.messages.some(({ stage }) => stage === "advisory")).toBe(false);
});

it("resumes from a saved stage assessment without repeating research", async () => {
  const saved = savedReport();
  const { repository } = createRepository({
    assessment: saved.assessmentSnapshot,
  });
  const fetcher = vi.fn();
  render(
    <ResearchHandoffScreen
      projectId={project.id}
      repository={repository}
      fetcher={fetcher}
    />,
  );

  await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
  expect(fetcher).not.toHaveBeenCalled();
});

it("redirects immediately when both report and advisor summary are saved", async () => {
  const report = savedReport();
  const summary: MessageRecord = {
    id: "summary-1",
    projectId: project.id,
    role: "assistant",
    content: "根据目前的情况，我把这个项目评为 A 级。",
    round: 0,
    createdAt: "2026-07-22T03:00:02.000Z",
    stage: "advisory",
    kind: "advisor_summary",
  };
  const { repository } = createRepository({ report, summary });
  const fetcher = vi.fn();
  render(
    <ResearchHandoffScreen
      projectId={project.id}
      repository={repository}
      fetcher={fetcher}
    />,
  );

  await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
  expect(fetcher).not.toHaveBeenCalled();
});
