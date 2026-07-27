import "server-only";

import { z } from "zod";

import {
  createDeepSeekClientFromEnv,
  type DeepSeekClient,
  ProviderError,
} from "@/lib/ai/deepseek-client";
import { chatAttachmentsSchema } from "@/lib/attachments/attachment-schema";
import { currentBillingUserId } from "@/lib/main-app-billing";
import {
  buildInterviewData,
  buildInterviewSystemPrompt,
} from "@/lib/conversation/interview-prompt";
import {
  encodeChatStreamEvent,
  type ChatStreamEvent,
} from "@/lib/streaming/chat-stream";

const requestSchema = z.strictObject({
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
  attachments: chatAttachmentsSchema.optional(),
});

type ChatRequest = z.infer<typeof requestSchema>;

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

  const client = createDeepSeekClientFromEnv(await currentBillingUserId());
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void streamChat(controller, client, parsed.data, request.signal);
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

async function streamChat(
  controller: ReadableStreamDefaultController<Uint8Array>,
  client: DeepSeekClient,
  input: ChatRequest,
  signal: AbortSignal,
): Promise<void> {
  const encoder = new TextEncoder();
  const send = (event: ChatStreamEvent) => {
    controller.enqueue(encoder.encode(encodeChatStreamEvent(event)));
  };
  const messageId = crypto.randomUUID();
  let content = "";

  try {
    for await (const delta of client.stream({
      systemPrompt: buildInterviewSystemPrompt(input.interviewDepth),
      userPrompt: buildInterviewData(input),
      attachments: input.attachments,
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
    message: "聊天生成失败，请稍后重试。",
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
