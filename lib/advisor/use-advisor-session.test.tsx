import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { DIMENSIONS } from "@/lib/rubric/catalog";
import type {
  AssessmentRecord,
  MessageRecord,
  ProjectRecord,
} from "@/lib/storage/db";
import type { ProjectRepository } from "@/lib/storage/project-repository";
import { encodeChatStreamEvent } from "@/lib/streaming/chat-stream";

import { useAdvisorSession } from "./use-advisor-session";

const project: ProjectRecord = {
  id: "project-1",
  name: "跨境项目",
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

const summary: MessageRecord = {
  id: "summary-1",
  projectId: project.id,
  role: "assistant",
  content: "根据目前的情况，我把这个项目评为 A 级。",
  round: 0,
  createdAt: "2026-07-22T02:00:01.000Z",
  stage: "advisory",
  kind: "advisor_summary",
};

function repository(includeSummary = true): ProjectRepository {
  return {
    createProject: vi.fn(),
    updateInterviewDepth: vi.fn(),
    appendMessage: vi.fn(async () => undefined),
    saveResearchSnapshot: vi.fn(),
    saveAssessment: vi.fn(),
    saveFinalReport: vi.fn(),
    saveFinalization: vi.fn(),
    getProjectWorkspace: vi.fn().mockResolvedValue({
      project,
      messages: [
        {
          ...summary,
          id: "interview-1",
          role: "user",
          content: "访谈内容",
          stage: "interview",
          kind: "chat",
        },
        ...(includeSummary ? [summary] : []),
      ],
      assessments: [assessment],
      researchSnapshot: null,
      report: null,
    }),
    listProjects: vi.fn().mockResolvedValue([project]),
    listFinalAssessments: vi.fn().mockResolvedValue([]),
    deleteProject: vi.fn(),
  };
}

function completeResponse(content = "当前证据仍缺少稳定复购数据。"): Response {
  return new Response(
    [
      encodeChatStreamEvent({
        type: "assistant_delta",
        messageId: "answer-1",
        delta: content,
      }),
      encodeChatStreamEvent({
        type: "complete",
        messageId: "answer-1",
        content,
      }),
    ].join(""),
  );
}

beforeEach(() => {
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => "user-question-1"),
  });
});

it("generates an ordinary opening message from the saved stage assessment", async () => {
  const repo = repository(false);
  const fetcher = vi.fn().mockResolvedValue(
    completeResponse("根据调研，目前建议将这个项目评为 A 级。"),
  );
  const { result } = renderHook(() =>
    useAdvisorSession({ projectId: project.id, repository: repo, fetcher }),
  );

  await waitFor(() => expect(result.current.phase).toBe("ready"));

  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(body.mode).toBe("opening");
  expect(repo.appendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      role: "assistant",
      stage: "advisory",
      kind: "chat",
    }),
  );
  expect(result.current.messages).toEqual([
    expect.objectContaining({ kind: "chat" }),
  ]);
  expect(result.current.assessment?.id).toBe(assessment.id);
  expect(result.current.report).toBeUndefined();
});

it("persists advisory follow-ups and excludes interview messages", async () => {
  const repo = repository();
  const fetcher = vi.fn().mockResolvedValue(completeResponse());
  const { result } = renderHook(() =>
    useAdvisorSession({ projectId: project.id, repository: repo, fetcher }),
  );
  await waitFor(() => expect(result.current.phase).toBe("ready"));

  await act(async () => {
    await result.current.send("为什么不是 S 级？");
  });

  expect(repo.appendMessage).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      role: "user",
      content: "为什么不是 S 级？",
      stage: "advisory",
      kind: "chat",
    }),
  );
  expect(repo.appendMessage).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      role: "assistant",
      stage: "advisory",
      kind: "chat",
    }),
  );
  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(fetcher.mock.calls[0][0]).toBe("/api/advisor");
  expect(body.messages.map((message: { content: string }) => message.content)).toEqual([
    summary.content,
    "为什么不是 S 级？",
  ]);
  expect(body.messages).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ content: "访谈内容" })]),
  );
});

it("sends advisory attachments and saves only their names in history", async () => {
  const repo = repository();
  const fetcher = vi.fn().mockResolvedValue(completeResponse("Attachment checked."));
  const { result } = renderHook(() =>
    useAdvisorSession({ projectId: project.id, repository: repo, fetcher }),
  );
  await waitFor(() => expect(result.current.phase).toBe("ready"));

  await act(async () => {
    await result.current.send("Read these materials", [
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

  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(body.attachments).toHaveLength(2);
  expect(repo.appendMessage).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      role: "user",
      content: expect.stringContaining("label.png"),
    }),
  );
  expect(JSON.stringify(vi.mocked(repo.appendMessage).mock.calls)).not.toContain(
    "data:image/png",
  );
});

it("retries a failed reply without saving the user message twice", async () => {
  const repo = repository();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        encodeChatStreamEvent({
          type: "error",
          code: "provider_timeout",
          message: "生成超时",
          retryable: true,
        }),
      ),
    )
    .mockResolvedValueOnce(completeResponse());
  const { result } = renderHook(() =>
    useAdvisorSession({ projectId: project.id, repository: repo, fetcher }),
  );
  await waitFor(() => expect(result.current.phase).toBe("ready"));

  await act(async () => {
    await result.current.send("为什么不是 S 级？");
  });
  expect(result.current.error?.retryable).toBe(true);

  await act(async () => {
    await result.current.retry();
  });

  const savedUsers = vi
    .mocked(repo.appendMessage)
    .mock.calls.filter(([message]) => message.role === "user");
  expect(savedUsers).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
