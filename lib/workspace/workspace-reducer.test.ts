import { describe, expect, it } from "vitest";

import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";
import type {
  MessageRecord,
  ProjectRecord,
  ProjectWorkspaceRecord,
} from "@/lib/storage/db";
import type { ResearchSnapshotRecord } from "@/lib/research/research-types";

import {
  createInitialWorkspaceState,
  workspaceReducer,
} from "./workspace-reducer";

const project: ProjectRecord = {
  id: "project-1",
  name: "海外电商项目",
  description: "评估海外电商项目",
  primaryCategory: null,
  status: "draft",
  interviewDepth: "medium",
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
};

const userMessage: MessageRecord = {
  id: "user-1",
  projectId: project.id,
  role: "user",
  content: project.description,
  round: 0,
  createdAt: "2026-07-22T00:00:00.000Z",
};

const assistantMessage: MessageRecord = {
  id: "assistant-1",
  projectId: project.id,
  role: "assistant",
  content: "订单来自哪些国家？",
  round: 0,
  createdAt: "2026-07-22T00:00:01.000Z",
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

function finalResponse(): AnalyzeProjectResponse {
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
    sources: [{ title: "Market report", url: "https://example.com/market" }],
    researchStatus: "completed",
  };
}

function workspace(): ProjectWorkspaceRecord {
  return {
    project,
    messages: [userMessage],
    assessments: [],
    researchSnapshot: null,
    report: null,
  };
}

describe("workspaceReducer", () => {
  it("streams chat without creating an assessment", () => {
    const loaded = workspaceReducer(createInitialWorkspaceState(), {
      type: "LOAD_SUCCEEDED",
      workspace: workspace(),
    });
    const started = workspaceReducer(loaded, {
      type: "CHAT_STARTED",
      requestId: "chat-1",
      messages: [userMessage],
    });
    const streaming = workspaceReducer(started, {
      type: "STREAM_DELTA",
      requestId: "chat-1",
      messageId: "assistant-1",
      delta: "订单来自",
      round: 0,
    });
    const completed = workspaceReducer(streaming, {
      type: "STREAM_COMPLETED",
      requestId: "chat-1",
      message: assistantMessage,
    });

    expect(started.phase).toBe("chatting");
    expect(streaming.streamDraft?.content).toBe("订单来自");
    expect(completed.phase).toBe("ready");
    expect(completed.messages.at(-1)).toEqual(assistantMessage);
    expect(completed.currentAssessment).toBeNull();
    expect(completed.assessmentHistory).toEqual([]);
  });

  it("moves through finalization stages and stores research before assessment", () => {
    const loaded = workspaceReducer(createInitialWorkspaceState(), {
      type: "LOAD_SUCCEEDED",
      workspace: workspace(),
    });
    const started = workspaceReducer(loaded, {
      type: "FINALIZE_STARTED",
      requestId: "final-1",
    });
    const planned = workspaceReducer(started, {
      type: "RESEARCH_PLANNED",
      requestId: "final-1",
      queries: ["新加坡口红 市场规模"],
    });
    const researching = workspaceReducer(planned, {
      type: "FINALIZE_STATUS",
      requestId: "final-1",
      stage: "researching",
    });
    const researched = workspaceReducer(researching, {
      type: "RESEARCH_RECEIVED",
      requestId: "final-1",
      snapshot: researchSnapshot,
    });
    const assessed = workspaceReducer(researched, {
      type: "ASSESSMENT_RECEIVED",
      requestId: "final-1",
      assessment: {
        id: "assessment-final",
        projectId: project.id,
        promptVersion: "final.v1",
        sources: finalResponse().sources,
        researchStatus: "completed",
        analysis: finalResponse().analysis,
        scored: finalResponse().scored,
        nextQuestion: null,
        diff: finalResponse().diff,
        createdAt: "2026-07-22T00:00:03.000Z",
      },
    });

    expect(started.phase).toBe("planning_research");
    expect(planned.researchQueries).toEqual(["新加坡口红 市场规模"]);
    expect(researching.phase).toBe("researching");
    expect(researched.researchSnapshot).toEqual(researchSnapshot);
    expect(assessed.currentAssessment?.id).toBe("assessment-final");
    expect(assessed.phase).toBe("scoring");
  });

  it("keeps the saved research snapshot when finalization fails", () => {
    const started = workspaceReducer(
      workspaceReducer(createInitialWorkspaceState(), {
        type: "LOAD_SUCCEEDED",
        workspace: workspace(),
      }),
      { type: "FINALIZE_STARTED", requestId: "final-1" },
    );
    const researched = workspaceReducer(started, {
      type: "RESEARCH_RECEIVED",
      requestId: "final-1",
      snapshot: { ...researchSnapshot, sources: [], status: "unavailable" },
    });
    const failed = workspaceReducer(researched, {
      type: "REQUEST_FAILED",
      requestId: "final-1",
      error: {
        code: "research_unavailable",
        message: "外部调研不可用",
        retryable: true,
        action: "retry_finalize",
      },
    });

    expect(failed.phase).toBe("ready");
    expect(failed.researchSnapshot?.status).toBe("unavailable");
    expect(failed.error?.action).toBe("retry_finalize");
  });

  it("ignores stale chat and finalization events", () => {
    const started = workspaceReducer(
      workspaceReducer(createInitialWorkspaceState(), {
        type: "LOAD_SUCCEEDED",
        workspace: workspace(),
      }),
      { type: "CHAT_STARTED", requestId: "current", messages: [userMessage] },
    );

    expect(
      workspaceReducer(started, {
        type: "STREAM_DELTA",
        requestId: "stale",
        messageId: "assistant-stale",
        delta: "stale",
        round: 0,
      }),
    ).toEqual(started);
  });
});
