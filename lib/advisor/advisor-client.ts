import { isAdvisoryMessage } from "@/lib/conversation/message-stage";
import type { ChatAttachment } from "@/lib/attachments/attachment-types";
import type { MessageRecord } from "@/lib/storage/db";
import {
  ChatStreamProtocolError,
  readChatStream,
} from "@/lib/streaming/chat-stream";

import type { AdvisorContext } from "./advisor-context";
import type { AdvisorMode } from "./advisor-prompt";

export interface AdvisorStreamResult {
  id: string;
  content: string;
}

export class AdvisorRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AdvisorRequestError";
  }
}

export async function requestAdvisorMessage(input: {
  fetcher: typeof fetch;
  mode: AdvisorMode;
  context: AdvisorContext;
  messages: MessageRecord[];
  attachments?: ChatAttachment[];
  signal: AbortSignal;
  onDelta: (draft: string) => void;
}): Promise<AdvisorStreamResult> {
  let response: Response;
  const fetcher = input.fetcher;
  try {
    response = await fetcher("/api/advisor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: input.mode,
        context: input.context,
        messages: input.messages.filter(isAdvisoryMessage).map(
          ({ id, role, content }) => ({ id, role, content }),
        ),
        attachments: input.attachments,
      }),
      signal: input.signal,
    });
  } catch (error) {
    if (isAbortError(error) || input.signal.aborted) {
      throw new AdvisorRequestError("aborted", "已停止生成。", false);
    }
    throw new AdvisorRequestError(
      "network_error",
      "无法连接建议智能体，请检查网络后重试。",
      true,
    );
  }

  if (!response.ok) throw await readHttpError(response);

  let draft = "";
  let completed: AdvisorStreamResult | null = null;
  try {
    await readChatStream(response, (event) => {
      switch (event.type) {
        case "assistant_delta":
          draft += event.delta;
          input.onDelta(draft);
          return;
        case "complete":
          completed = { id: event.messageId, content: event.content };
          return;
        case "error":
          throw new AdvisorRequestError(
            event.code,
            event.message,
            event.retryable,
          );
      }
    });
  } catch (error) {
    if (error instanceof AdvisorRequestError) throw error;
    if (error instanceof ChatStreamProtocolError) {
      throw new AdvisorRequestError(
        error.code,
        "建议智能体返回了无法读取的数据，请重试。",
        true,
      );
    }
    throw new AdvisorRequestError(
      "invalid_response",
      "建议智能体返回了无法读取的数据，请重试。",
      true,
    );
  }

  if (!completed) {
    throw new AdvisorRequestError(
      "incomplete_response",
      "建议智能体没有返回完整回复，请重试。",
      true,
    );
  }
  return completed;
}

async function readHttpError(response: Response): Promise<AdvisorRequestError> {
  try {
    const body = (await response.json()) as {
      code?: unknown;
      message?: unknown;
      retryable?: unknown;
    };
    return new AdvisorRequestError(
      typeof body.code === "string" ? body.code : "request_failed",
      typeof body.message === "string" ? body.message : "建议请求失败，请重试。",
      typeof body.retryable === "boolean" ? body.retryable : true,
    );
  } catch {
    return new AdvisorRequestError(
      "request_failed",
      "建议请求失败，请重试。",
      true,
    );
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
