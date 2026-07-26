import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { DIMENSIONS } from "@/lib/rubric/catalog";
import type {
  AssessmentRecord,
  MessageRecord,
  ProjectRecord,
  ProjectWorkspaceRecord,
} from "@/lib/storage/db";
import type { ProjectRepository } from "@/lib/storage/project-repository";
import { encodeChatStreamEvent } from "@/lib/streaming/chat-stream";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigation.push,
    replace: navigation.replace,
  }),
}));

import { AdvisorScreen } from "./advisor-screen";

function workspace(): ProjectWorkspaceRecord {
  const project: ProjectRecord = {
    id: "project-1",
    name: "跨境口红项目",
    description: "在新加坡销售口红",
    primaryCategory: "ecommerce",
    status: "provisional",
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
        facts: [],
        deductions: [],
        evidence: [],
      },
    ]),
  ) as AssessmentRecord["scored"]["dimensions"];
  const assessment = {
    id: "assessment-1",
    projectId: project.id,
    promptVersion: "final.v1",
    sources: [],
    researchStatus: "completed",
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
    createdAt: "2026-07-22T01:00:00.000Z",
  } satisfies AssessmentRecord;
  const base: MessageRecord = {
    id: "interview-1",
    projectId: project.id,
    role: "user",
    content: "这条访谈消息不应显示",
    round: 0,
    createdAt: project.createdAt,
    stage: "interview",
    kind: "chat",
  };
  return {
    project,
    assessments: [assessment],
    researchSnapshot: null,
    report: null,
    messages: [
      base,
      {
        ...base,
        id: "summary-1",
        role: "assistant",
        content: "根据调研，目前建议将这个项目评为 A 级。",
        stage: "advisory",
        kind: "advisor_summary",
      },
      {
        ...base,
        id: "advisor-user-1",
        content: "我还可以怎么提高等级？",
        stage: "advisory",
        kind: "chat",
      },
      {
        ...base,
        id: "advisor-answer-1",
        role: "assistant",
        content: "先补齐复购证据。",
        stage: "advisory",
        kind: "chat",
      },
    ],
  };
}

function repository(value: ProjectWorkspaceRecord | null): ProjectRepository {
  return {
    createProject: vi.fn(),
    updateInterviewDepth: vi.fn(),
    appendMessage: vi.fn(async (message) => {
      value?.messages.push(message);
    }),
    saveResearchSnapshot: vi.fn(),
    saveAssessment: vi.fn(),
    saveFinalReport: vi.fn(),
    saveFinalization: vi.fn(),
    getProjectWorkspace: vi.fn(async () => value),
    listProjects: vi.fn(async () => (value ? [value.project] : [])),
    listFinalAssessments: vi.fn(async () => []),
    deleteProject: vi.fn(),
  };
}

beforeEach(() => {
  navigation.push.mockReset();
  navigation.replace.mockReset();
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "advisor-user-2") });
});

it("shows advisory history only and continues through the advisor API", async () => {
  const user = userEvent.setup();
  const value = workspace();
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      [
        encodeChatStreamEvent({
          type: "assistant_delta",
          messageId: "advisor-answer-2",
          delta: "当前证据仍缺少稳定复购数据。",
        }),
        encodeChatStreamEvent({
          type: "complete",
          messageId: "advisor-answer-2",
          content: "当前证据仍缺少稳定复购数据。",
        }),
      ].join(""),
    ),
  );
  render(
    <AdvisorScreen
      projectId={value.project.id}
      repository={repository(value)}
      fetcher={fetcher}
    />,
  );

  expect(
    await screen.findByText(/^根据调研，目前建议将这个项目评为 A 级。/),
  ).toBeVisible();
  expect(screen.queryByLabelText("报告等级")).not.toBeInTheDocument();
  expect(screen.queryByText("评级依据")).not.toBeInTheDocument();
  expect(screen.queryByText("导出 PDF")).not.toBeInTheDocument();
  expect(screen.getByText("评估讨论")).toHaveAttribute("aria-current", "step");
  expect(screen.queryByText("这条访谈消息不应显示")).not.toBeInTheDocument();
  expect(screen.getByText("先补齐复购证据。")).toBeVisible();

  await user.type(
    screen.getByLabelText("继续和建议智能体讨论"),
    "为什么不是 S 级？",
  );
  await user.click(screen.getByRole("button", { name: "发送" }));
  expect(
    await screen.findByText("当前证据仍缺少稳定复购数据。"),
  ).toBeVisible();
  expect(fetcher.mock.calls[0][0]).toBe("/api/advisor");
  expect(fetcher.mock.calls.map(([url]) => url)).not.toContain("/api/finalize");
});

it("renders advisor emphasis without exposing markdown markers", async () => {
  const value = workspace();
  const advisorAnswer = value.messages.find(
    ({ id }) => id === "advisor-answer-1",
  );
  if (!advisorAnswer) throw new Error("Missing advisor fixture message");
  advisorAnswer.content = "Prioritize **repeat-purchase evidence** first.";

  render(
    <AdvisorScreen
      projectId={value.project.id}
      repository={repository(value)}
      fetcher={vi.fn()}
    />,
  );

  const emphasized = await screen.findByText("repeat-purchase evidence", {
    selector: "strong",
  });
  expect(emphasized).toBeVisible();
  expect(emphasized.closest("p")).not.toHaveTextContent("**");
});

it("routes incomplete projects back to research recovery", async () => {
  const value = workspace();
  value.assessments = [];
  render(
    <AdvisorScreen
      projectId={value.project.id}
      repository={repository(value)}
      fetcher={vi.fn()}
    />,
  );

  await waitFor(() => {
    expect(navigation.replace).toHaveBeenCalledWith("/research/project-1");
  });
});

it("streams an opening chat message when the advisor conversation is empty", async () => {
  const value = workspace();
  value.messages = value.messages.filter(({ stage }) => stage === "interview");
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      [
        encodeChatStreamEvent({
          type: "assistant_delta",
          messageId: "summary-2",
          delta: "根据调研，目前建议将这个项目评为 A 级。",
        }),
        encodeChatStreamEvent({
          type: "complete",
          messageId: "summary-2",
          content: "根据调研，目前建议将这个项目评为 A 级。",
        }),
      ].join(""),
    ),
  );

  render(
    <AdvisorScreen
      projectId={value.project.id}
      repository={repository(value)}
      fetcher={fetcher}
    />,
  );

  expect(
    await screen.findByText("根据调研，目前建议将这个项目评为 A 级。"),
  ).toBeVisible();
  expect(navigation.replace).not.toHaveBeenCalledWith("/research/project-1");
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).mode).toBe("opening");
});

it("shows a clear deleted-project state", async () => {
  render(
    <AdvisorScreen
      projectId="missing"
      repository={repository(null)}
      fetcher={vi.fn()}
    />,
  );

  expect(await screen.findByText("项目不存在或已被删除。")) .toBeVisible();
  expect(screen.getByRole("link", { name: "返回项目列表" })).toHaveAttribute(
    "href",
    "/",
  );
});

it("does not generate a report until the user clicks the explicit action", async () => {
  const user = userEvent.setup();
  const value = workspace();
  value.researchSnapshot = {
    id: "research-project-1",
    projectId: value.project.id,
    queries: ["新加坡口红 市场"],
    sources: [],
    status: "completed",
    createdAt: "2026-07-22T01:00:00.000Z",
    updatedAt: "2026-07-22T01:00:00.000Z",
  };
  const finalResult = {
    projectId: value.project.id,
    projectName: value.project.name,
    primaryCategory: "ecommerce",
    secondaryCategories: [],
    categoryReason: "海外电商",
    promptVersion: "report.v1",
    analysis: value.assessments[0].analysis,
    scored: value.assessments[0].scored,
    nextQuestion: null,
    diff: null,
    sources: [],
    researchStatus: "completed",
  } as const;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        { jobId: "report-job-1", state: "queued" },
        { status: 202 },
      ),
    )
    .mockResolvedValueOnce(
      Response.json({
        id: "report-job-1",
        state: "completed",
        assessment: finalResult,
        createdAt: "2026-07-26T00:00:00.000Z",
        updatedAt: "2026-07-26T00:00:01.000Z",
      }),
    );

  render(
    <AdvisorScreen
      projectId={value.project.id}
      repository={repository(value)}
      fetcher={fetcher}
    />,
  );

  await screen.findByText("先补齐复购证据。");
  expect(fetcher.mock.calls.map(([url]) => url)).not.toContain(
    "/api/report-jobs",
  );
  await user.click(screen.getByRole("button", { name: "生成最终报告" }));

  expect(fetcher).toHaveBeenNthCalledWith(
    1,
    "/api/report-jobs",
    expect.any(Object),
  );
  expect(fetcher).toHaveBeenNthCalledWith(
    2,
    "/api/report-jobs/report-job-1",
  );
  await waitFor(() => {
    expect(navigation.push).toHaveBeenCalledWith("/report/project-1");
  });
});
