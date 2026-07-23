import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";
import type { ResearchSnapshotRecord } from "@/lib/research/research-types";
import type { MessageRecord, ProjectRecord } from "@/lib/storage/db";
import type { ProjectRepository } from "@/lib/storage/project-repository";
import { encodeChatStreamEvent } from "@/lib/streaming/chat-stream";

import { useAssessmentSession } from "./use-assessment-session";

const project: ProjectRecord = {
  id: "project-1",
  name: "海外电商项目",
  description: "海外电商项目",
  primaryCategory: null,
  status: "draft",
  interviewDepth: "medium",
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
};

const researchSnapshot: ResearchSnapshotRecord = {
  id: "research-project-1",
  projectId: project.id,
  queries: ["跨境电商 市场规模"],
  sources: [
    {
      title: "Market report",
      url: "https://example.com/market",
      snippet: "Demand increased.",
      query: "跨境电商 市场规模",
    },
  ],
  status: "completed",
  createdAt: "2026-07-22T00:00:02.000Z",
  updatedAt: "2026-07-22T00:00:02.000Z",
};

function finalResponse(
  researchStatus: AnalyzeProjectResponse["researchStatus"] = "completed",
): AnalyzeProjectResponse {
  return {
    projectId: project.id,
    projectName: project.name,
    primaryCategory: "ecommerce",
    secondaryCategories: [],
    categoryReason: "海外电商业务",
    promptVersion: "final.v1",
    analysis: {
      projectName: project.name,
      primaryCategory: "ecommerce",
      secondaryCategories: [],
      categoryReason: "海外电商业务",
      dimensions: [],
      vetoRisks: [],
      criticalUnknowns: [],
      questionCandidates: [],
      research: { needed: false, reason: "", queries: [] },
    },
    scored: {
      rubricVersion: "test.v1",
      dimensions: {} as never,
      totalScoreRaw: 70,
      totalScore: 70,
      confidence: 68,
      provisionalGrade: "A",
      eligibleFinalGrade: "A",
      status: "final",
      suspectedVetoes: [],
      confirmedVetoes: [],
      criticalUnknowns: [],
    },
    nextQuestion: null,
    diff: {
      gradeChange: null,
      scoreDelta: 70,
      confidenceDelta: 68,
      changedDimensions: [],
      newEvidenceStatements: [],
      summary: "最终评估",
    },
    sources:
      researchStatus === "completed"
        ? [{ title: "Market report", url: "https://example.com/market" }]
        : [],
    researchStatus,
  };
}

function chatResponse(content: string): Response {
  return new Response(
    [
      encodeChatStreamEvent({
        type: "assistant_delta",
        messageId: "assistant-1",
        delta: content,
      }),
      encodeChatStreamEvent({
        type: "complete",
        messageId: "assistant-1",
        content,
      }),
    ].join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function finalizeJobResponses(options?: { unavailable?: boolean }): Response[] {
  const unavailable = options?.unavailable ?? false;
  const snapshot = unavailable
    ? { ...researchSnapshot, sources: [], status: "unavailable" as const }
    : researchSnapshot;
  const base = {
    id: "job-1",
    stage: unavailable ? "researching" : "scoring",
    researchSnapshot: snapshot,
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:01.000Z",
  };
  return [
    Response.json({ jobId: "job-1", state: "queued" }, { status: 202 }),
    Response.json(
      unavailable
        ? {
            ...base,
            state: "failed",
            error: {
              code: "research_unavailable",
              message: "外部调研不可用。",
              retryable: true,
            },
          }
        : {
            ...base,
            state: "completed",
            assessment: finalResponse(),
          },
    ),
  ];
}

function repository(order: string[] = []): ProjectRepository {
  return {
    createProject: vi.fn().mockResolvedValue(project),
    updateInterviewDepth: vi.fn(async (_projectId, depth) => ({
      ...project,
      interviewDepth: depth,
    })),
    appendMessage: vi.fn(async () => undefined),
    saveResearchSnapshot: vi.fn(async () => {
      order.push("research");
    }),
    saveAssessment: vi.fn(async () => {
      order.push("assessment");
    }),
    saveFinalReport: vi.fn(async () => undefined),
    saveFinalization: vi.fn(async () => {
      order.push("finalization");
    }),
    getProjectWorkspace: vi.fn().mockResolvedValue(null),
    listProjects: vi.fn().mockResolvedValue([project]),
    listFinalAssessments: vi.fn().mockResolvedValue([]),
    deleteProject: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => `id-${Math.random().toString(16).slice(2)}`),
  });
});

it("creates a project and chats without saving any assessment", async () => {
  const repo = repository();
  const suggestion =
    "核心信息已经比较完整，建议结束访谈并开始调研；你也可以继续补充。";
  const fetcher = vi.fn().mockResolvedValue(chatResponse(suggestion));
  const { result } = renderHook(() =>
    useAssessmentSession({ repository: repo, fetcher }),
  );

  await act(async () => {
    await result.current.createAndAnalyze(project.description);
  });

  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe("/api/chat");
  expect(repo.saveAssessment).not.toHaveBeenCalled();
  expect(repo.saveFinalization).not.toHaveBeenCalled();
  expect(result.current.state.currentAssessment).toBeNull();
  expect(result.current.state.messages.map(({ role }) => role)).toEqual([
    "user",
    "assistant",
  ]);
  expect(result.current.state.messages.at(-1)?.content).toBe(suggestion);
  expect(repo.appendMessage).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ stage: "interview", kind: "chat" }),
  );
  expect(repo.appendMessage).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ stage: "interview", kind: "chat" }),
  );
});

it("excludes advisory messages from the finalization request", async () => {
  const interview: MessageRecord = {
    id: "interview-1",
    projectId: project.id,
    role: "user",
    content: "访谈事实",
    round: 0,
    createdAt: "2026-07-22T00:00:00.000Z",
    stage: "interview",
    kind: "chat",
  };
  const advisory: MessageRecord = {
    ...interview,
    id: "advisor-1",
    role: "assistant",
    content: "第二智能体建议",
    stage: "advisory",
    kind: "advisor_summary",
  };
  const repo = repository();
  vi.mocked(repo.getProjectWorkspace).mockResolvedValue({
    project,
    messages: [interview, advisory],
    assessments: [],
    researchSnapshot: null,
    report: null,
  });
  const [createJob, completedJob] = finalizeJobResponses();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(createJob)
    .mockResolvedValueOnce(completedJob);
  const { result } = renderHook(() =>
    useAssessmentSession({ repository: repo, fetcher }),
  );

  await act(async () => {
    await result.current.loadProject(project.id);
  });
  await act(async () => {
    await result.current.finalizeCurrent();
  });

  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(body.messages).toEqual([
    expect.objectContaining({ id: interview.id, content: interview.content }),
  ]);
});

it("sends follow-up chat without previous assessment fields", async () => {
  const repo = repository();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(chatResponse("第一问"))
    .mockResolvedValueOnce(chatResponse("第二问"));
  const { result } = renderHook(() =>
    useAssessmentSession({ repository: repo, fetcher }),
  );
  await act(async () => {
    await result.current.createAndAnalyze(project.description);
  });

  await act(async () => {
    await result.current.answerQuestion("已有十个订单");
  });

  const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
  expect(fetcher.mock.calls[1][0]).toBe("/api/chat");
  expect(body.messages.at(-1).content).toBe("已有十个订单");
  expect(body).not.toHaveProperty("previousAssessment");
  expect(body).not.toHaveProperty("questionHistory");
});

it("sends attachments with an interview answer and saves only a text summary", async () => {
  const repo = repository();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(chatResponse("First question"))
    .mockResolvedValueOnce(chatResponse("Attachment noted"));
  const { result } = renderHook(() =>
    useAssessmentSession({ repository: repo, fetcher }),
  );
  await act(async () => {
    await result.current.createAndAnalyze(project.description);
  });

  await act(async () => {
    await result.current.answerQuestion("Please read these files", [
      {
        id: "doc-1",
        name: "quote.txt",
        mimeType: "text/plain",
        kind: "document",
        text: "MOQ 500 bottles",
      },
      {
        id: "image-1",
        name: "label.png",
        mimeType: "image/png",
        kind: "image",
        dataUrl: "data:image/png;base64,AAAA",
      },
    ]);
  });

  const body = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
  expect(body.attachments).toHaveLength(2);
  expect(body.attachments[0]).toMatchObject({ name: "quote.txt" });
  expect(body.attachments[1]).toMatchObject({ name: "label.png" });
  expect(repo.appendMessage).toHaveBeenNthCalledWith(
    3,
    expect.objectContaining({
      content: expect.stringContaining("quote.txt"),
    }),
  );
  expect(JSON.stringify(vi.mocked(repo.appendMessage).mock.calls)).not.toContain(
    "data:image/png",
  );
});

it("persists research and the stage assessment without creating a report", async () => {
  const order: string[] = [];
  const repo = repository(order);
  const [createJob, completedJob] = finalizeJobResponses();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(chatResponse("继续补充订单来源。"))
    .mockResolvedValueOnce(createJob)
    .mockResolvedValueOnce(completedJob);
  const { result } = renderHook(() =>
    useAssessmentSession({ repository: repo, fetcher }),
  );
  await act(async () => {
    await result.current.createAndAnalyze(project.description);
  });

  let completed = false;
  await act(async () => {
    completed = await result.current.finalizeCurrent();
  });

  expect(completed).toBe(true);
  expect(fetcher.mock.calls[1][0]).toBe("/api/finalize-jobs");
  expect(fetcher.mock.calls[2][0]).toBe("/api/finalize-jobs/job-1");
  expect(order).toEqual(["research", "assessment"]);
  expect(repo.saveAssessment).toHaveBeenCalledWith(
    expect.objectContaining({ researchStatus: "completed" }),
  );
  expect(repo.saveFinalization).not.toHaveBeenCalled();
  expect(result.current.state.currentAssessment?.scored.totalScore).toBe(70);
  expect(result.current.state.report).toBeNull();
});

it("keeps unavailable research for retry and supports interview-only fallback", async () => {
  const repo = repository();
  const [createFailedJob, failedJob] = finalizeJobResponses({
    unavailable: true,
  });
  const [createCompletedJob, completedJob] = finalizeJobResponses();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(chatResponse("继续补充。"))
    .mockResolvedValueOnce(createFailedJob)
    .mockResolvedValueOnce(failedJob)
    .mockResolvedValueOnce(createCompletedJob)
    .mockResolvedValueOnce(completedJob);
  const { result } = renderHook(() =>
    useAssessmentSession({ repository: repo, fetcher }),
  );
  await act(async () => {
    await result.current.createAndAnalyze(project.description);
  });

  await act(async () => {
    await result.current.finalizeCurrent();
  });

  expect(result.current.state.error?.action).toBe("retry_finalize");
  expect(result.current.state.researchSnapshot?.status).toBe("unavailable");

  await act(async () => {
    await result.current.finalizeCurrent("interview_only");
  });

  const body = JSON.parse(String(fetcher.mock.calls[3][1]?.body));
  expect(body.researchMode).toBe("interview_only");
  expect(body.researchSnapshot.status).toBe("unavailable");
});
