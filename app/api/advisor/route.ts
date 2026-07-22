import "server-only";

import { z } from "zod";

import {
  createDeepSeekClientFromEnv,
  type DeepSeekClient,
  ProviderError,
} from "@/lib/ai/deepseek-client";
import {
  buildAdvisorData,
  buildAdvisorSystemPrompt,
  createAdvisorOpeningPrefix,
} from "@/lib/advisor/advisor-prompt";
import {
  encodeChatStreamEvent,
  type ChatStreamEvent,
} from "@/lib/streaming/chat-stream";

const boundedText = z.string().max(20_000);
const httpUrl = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
});

const contextSchema = z.strictObject({
  projectId: z.string().min(1),
  projectName: z.string().min(1).max(500),
  projectDescription: boundedText,
  categoryReason: z.string().max(2_000),
  grade: z.enum(["S", "A", "B", "C"]),
  totalScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(100),
  researchStatus: z.enum([
    "not_needed",
    "completed",
    "partial",
    "unavailable",
  ]),
  dimensions: z
    .array(
      z.strictObject({
        key: z.enum([
          "strategic_value",
          "demand_evidence",
          "return_potential",
          "execution_feasibility",
          "resource_fit",
          "timing_differentiation",
          "risk_control",
        ]),
        appliedScore: z.number().min(0).max(5),
        facts: z.array(z.string().max(2_000)).max(8),
        deductions: z.array(z.string().max(2_000)).max(8),
      }),
    )
    .max(7),
  sources: z
    .array(
      z.strictObject({
        title: z.string().min(1).max(500),
        url: httpUrl,
      }),
    )
    .max(20),
});

const messageSchema = z.strictObject({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  content: boundedText,
});

const requestSchema = z
  .strictObject({
    mode: z.enum(["opening", "reply"]),
    context: contextSchema,
    messages: z.array(messageSchema).max(100),
  })
  .superRefine((value, context) => {
    if (value.mode === "opening" && value.messages.length !== 0) {
      context.addIssue({
        code: "custom",
        path: ["messages"],
        message: "opening does not accept conversation messages",
      });
    }
    if (
      value.mode === "reply" &&
      value.messages.at(-1)?.role !== "user"
    ) {
      context.addIssue({
        code: "custom",
        path: ["messages"],
        message: "reply requires a final user message",
      });
    }
  });

type AdvisorRequest = z.infer<typeof requestSchema>;

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

  const client = createDeepSeekClientFromEnv();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void streamAdvisor(controller, client, parsed.data, request.signal);
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

async function streamAdvisor(
  controller: ReadableStreamDefaultController<Uint8Array>,
  client: DeepSeekClient,
  input: AdvisorRequest,
  signal: AbortSignal,
): Promise<void> {
  const encoder = new TextEncoder();
  const send = (event: ChatStreamEvent) => {
    controller.enqueue(encoder.encode(encodeChatStreamEvent(event)));
  };
  const messageId = crypto.randomUUID();
  let content = "";

  try {
    if (input.mode === "opening") {
      const prefix = createAdvisorOpeningPrefix(input.context.grade);
      content += prefix;
      send({ type: "assistant_delta", messageId, delta: prefix });
    }
    for await (const delta of client.stream({
      systemPrompt: buildAdvisorSystemPrompt(input.mode),
      userPrompt: buildAdvisorData(input),
      signal,
    })) {
      content += delta;
      send({ type: "assistant_delta", messageId, delta });
    }
    send({ type: "complete", messageId, content });
  } catch (error) {
    if (signal.aborted) return;
    send({ type: "error", ...toSafeError(error) });
  } finally {
    if (!signal.aborted) controller.close();
  }
}

function toSafeError(
  error: unknown,
): Omit<Extract<ChatStreamEvent, { type: "error" }>, "type"> {
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    code: "internal_error",
    message: "建议生成失败，请稍后重试。",
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
