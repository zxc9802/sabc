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
import { scoreAssessment } from "@/lib/scoring/score-assessment";
import {
  encodeFinalReportStreamEvent,
  type FinalReportStage,
  type FinalReportStreamEvent,
} from "@/lib/report/final-report-stream";
import { currentBillingUserId } from "@/lib/main-app-billing";

const dimensionKeySchema = z.enum([
  "strategic_value",
  "demand_evidence",
  "return_potential",
  "execution_feasibility",
  "resource_fit",
  "timing_differentiation",
  "risk_control",
]);
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
const stageAssessmentSchema = z.strictObject({
  grade: z.enum(["S", "A", "B", "C"]),
  totalScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  categoryReason: z.string().max(2_000),
  researchStatus: z.enum(["not_needed", "completed", "partial", "unavailable"]),
  dimensions: z
    .array(
      z.strictObject({
        key: dimensionKeySchema,
        appliedScore: z.number().min(0).max(5),
        facts: z.array(z.string().max(2_000)).max(8),
        deductions: z.array(z.string().max(2_000)).max(8),
      }),
    )
    .max(7),
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
          stage: z.enum(["interview", "advisory"]),
        }),
      )
      .min(1)
      .max(300),
    interviewDepth: z.enum(["low", "medium", "high"]),
    researchSnapshot: researchSnapshotSchema,
    stageAssessment: stageAssessmentSchema,
  })
  .superRefine((value, context) => {
    if (value.researchSnapshot.projectId !== value.projectId) {
      context.addIssue({
        code: "custom",
        path: ["researchSnapshot", "projectId"],
        message: "research snapshot project mismatch",
      });
    }
  });

type ReportRequest = z.infer<typeof requestSchema>;

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
  const billingUserId = await currentBillingUserId();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void streamReport(
        controller,
        createDeepSeekClientFromEnv(billingUserId),
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

async function streamReport(
  controller: ReadableStreamDefaultController<Uint8Array>,
  client: DeepSeekClient,
  input: ReportRequest,
  signal: AbortSignal,
): Promise<void> {
  const encoder = new TextEncoder();
  const send = (event: FinalReportStreamEvent) => {
    controller.enqueue(encoder.encode(encodeFinalReportStreamEvent(event)));
  };
  let stage: FinalReportStage = "analyzing";
  try {
    send({ type: "status", stage });
    const result = await analyzeProject(
      client,
      {
        projectId: input.projectId,
        projectDescription: input.projectDescription,
        messages: input.messages,
        questionHistory: [],
        interviewDepth: input.interviewDepth,
        round: Math.max(...input.messages.map(({ round }) => round), 0),
        final: true,
        researchSnapshot: input.researchSnapshot,
        stageAssessment: input.stageAssessment,
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

function toSafeError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof ProviderError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof AnalyzeError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  if (error instanceof ModelOutputError) {
    return { code: error.code, message: error.message, retryable: true };
  }
  return {
    code: "internal_error",
    message: "最终报告分析失败，请稍后重试。",
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
