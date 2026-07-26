import "server-only";

import { z } from "zod";

import {
  createDeepSeekClientFromEnv,
  type DeepSeekClient,
  ProviderError,
} from "@/lib/ai/deepseek-client";
import {
  AnalyzeError,
  analyzeProject,
  ModelOutputError,
} from "@/lib/assessment/analyze-project";
import {
  AnySearchError,
  createAnySearchClientFromEnv,
  type AnySearchClient,
} from "@/lib/research/anysearch-client";
import {
  createResearchPlan,
  ResearchPlanError,
} from "@/lib/research/research-plan";
import type {
  ResearchSnapshotRecord,
  ResearchSource,
} from "@/lib/research/research-types";
import { scoreAssessment } from "@/lib/scoring/score-assessment";
import {
  encodeFinalizeStreamEvent,
  type FinalizeStage,
  type FinalizeStreamEvent,
} from "@/lib/streaming/finalize-stream";

const httpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
});

const researchSnapshotSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1),
  queries: z.array(z.string().min(1).max(500)).max(5),
  sources: z
    .array(
      z.strictObject({
        title: z.string().min(1).max(500),
        url: httpUrlSchema,
        snippet: z.string().max(2_500),
        query: z.string().max(500),
      }),
    )
    .max(15),
  status: z.enum(["completed", "partial", "unavailable"]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const requestSchema = z
  .strictObject({
    projectId: z.string().min(1),
    projectDescription: z.string().min(1).max(20_000),
    messages: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          role: z.enum(["user", "assistant"]),
          content: z.string().max(20_000),
          round: z.number().int().min(0),
        }),
      )
      .min(1)
      .max(200),
    interviewDepth: z.enum(["low", "medium", "high"]),
    round: z.number().int().min(0),
    researchMode: z.enum(["auto", "interview_only"]).default("auto"),
    researchSnapshot: researchSnapshotSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.researchSnapshot &&
      value.researchSnapshot.projectId !== value.projectId
    ) {
      context.addIssue({
        code: "custom",
        path: ["researchSnapshot", "projectId"],
        message: "research snapshot project mismatch",
      });
    }
  });

type FinalizeRequest = z.infer<typeof requestSchema>;

const MAX_FINAL_RESEARCH_SOURCES = 6;
const MAX_FINAL_SOURCE_SNIPPET_LENGTH = 800;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "请求体不是合法 JSON。", false);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "invalid_input", "请求参数校验失败。", false);
  }
  if (
    !process.env.DEEPSEEK_API_ENDPOINT ||
    !process.env.DEEPSEEK_MODEL ||
    !process.env.DEEPSEEK_API_KEY
  ) {
    return errorResponse(
      503,
      "missing_configuration",
      "服务端 AI 配置缺失，请检查 .env.local。",
      false,
    );
  }

  const modelClient = createDeepSeekClientFromEnv();
  const anySearchClient = createAnySearchClientFromEnv();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void streamFinalization(
        controller,
        modelClient,
        anySearchClient,
        parsed.data,
        request.signal,
      );
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function streamFinalization(
  controller: ReadableStreamDefaultController<Uint8Array>,
  modelClient: DeepSeekClient,
  anySearchClient: AnySearchClient,
  input: FinalizeRequest,
  signal: AbortSignal,
): Promise<void> {
  const encoder = new TextEncoder();
  const send = (event: FinalizeStreamEvent) => {
    controller.enqueue(encoder.encode(encodeFinalizeStreamEvent(event)));
  };
  let stage: FinalizeStage = "planning_research";

  try {
    const snapshot = await resolveResearchSnapshot({
      modelClient,
      anySearchClient,
      input,
      signal,
      send,
      setStage(next) {
        stage = next;
      },
    });

    if (snapshot.status === "unavailable" && input.researchMode === "auto") {
      send({
        type: "error",
        stage: "researching",
        code: "research_unavailable",
        message: "外部调研暂时不可用。可以重试调研，或仅依据访谈生成报告。",
        retryable: true,
      });
      return;
    }

    stage = "analyzing";
    send({ type: "status", stage });
    const result = await analyzeProject(
      modelClient,
      {
        projectId: input.projectId,
        projectDescription: input.projectDescription,
        messages: input.messages,
        questionHistory: [],
        interviewDepth: input.interviewDepth,
        round: input.round,
        final: true,
        researchSnapshot: snapshot,
        signal,
      },
      (scoreInput) => {
        stage = "scoring";
        send({ type: "status", stage });
        return scoreAssessment(scoreInput);
      },
    );
    send({ type: "assessment", result });
    send({ type: "complete" });
  } catch (error) {
    if (signal.aborted) return;
    send({ type: "error", stage, ...toSafeError(error) });
  } finally {
    if (!signal.aborted) controller.close();
  }
}

async function resolveResearchSnapshot(options: {
  modelClient: DeepSeekClient;
  anySearchClient: AnySearchClient;
  input: FinalizeRequest;
  signal: AbortSignal;
  send: (event: FinalizeStreamEvent) => void;
  setStage: (stage: FinalizeStage) => void;
}): Promise<ResearchSnapshotRecord> {
  const { input, send, signal } = options;
  const reusable =
    input.researchMode === "auto" &&
    input.researchSnapshot &&
    input.researchSnapshot.status !== "unavailable"
      ? {
          ...input.researchSnapshot,
          sources: budgetResearchSources(input.researchSnapshot.sources),
        }
      : null;
  if (reusable) {
    send({ type: "research_complete", snapshot: reusable });
    return reusable;
  }

  const now = new Date().toISOString();
  if (input.researchMode === "interview_only") {
    const snapshot: ResearchSnapshotRecord = {
      id: `research-${input.projectId}`,
      projectId: input.projectId,
      queries: [],
      sources: [],
      status: "unavailable",
      createdAt: input.researchSnapshot?.createdAt ?? now,
      updatedAt: now,
    };
    send({ type: "research_complete", snapshot });
    return snapshot;
  }

  options.setStage("planning_research");
  send({ type: "status", stage: "planning_research" });
  const plan = await createResearchPlan(options.modelClient, {
    projectDescription: input.projectDescription,
    messages: input.messages,
    signal,
  });
  send({ type: "research_plan", queries: plan.queries });

  options.setStage("researching");
  send({ type: "status", stage: "researching" });
  const researchStartedAt = Date.now();
  const results = await Promise.allSettled(
    plan.queries.map((query) => options.anySearchClient.search(query, signal)),
  );
  const sources = budgetResearchSources(uniqueSources(
    results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
  ));
  const failed = results.filter((result) => result.status === "rejected").length;
  console.info("[sabc.research.timing]", {
    queryCount: plan.queries.length,
    sourceCount: sources.length,
    failedCount: failed,
    durationMs: Date.now() - researchStartedAt,
  });
  const status =
    sources.length === 0
      ? "unavailable"
      : failed > 0
        ? "partial"
        : "completed";
  const snapshot: ResearchSnapshotRecord = {
    id: `research-${input.projectId}`,
    projectId: input.projectId,
    queries: plan.queries,
    sources,
    status,
    createdAt: input.researchSnapshot?.createdAt ?? now,
    updatedAt: now,
  };
  send({ type: "research_complete", snapshot });
  return snapshot;
}

function uniqueSources(sources: ResearchSource[]): ResearchSource[] {
  return [...new Map(sources.map((source) => [source.url, source])).values()];
}

function budgetResearchSources(sources: ResearchSource[]): ResearchSource[] {
  return sources.slice(0, MAX_FINAL_RESEARCH_SOURCES).map((source) => ({
    ...source,
    snippet: source.snippet.slice(0, MAX_FINAL_SOURCE_SNIPPET_LENGTH),
  }));
}

function toSafeError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (
    error instanceof ProviderError ||
    error instanceof AnySearchError
  ) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  if (error instanceof AnalyzeError || error instanceof ResearchPlanError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  if (error instanceof ModelOutputError) {
    return { code: error.code, message: error.message, retryable: true };
  }
  return {
    code: "internal_error",
    message: "最终分析失败，请稍后重试。",
    retryable: true,
  };
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): Response {
  return Response.json({ code, message, retryable }, { status });
}
