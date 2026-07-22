export type ChatStreamEvent =
  | {
      type: "assistant_delta";
      messageId: string;
      delta: string;
    }
  | {
      type: "complete";
      messageId: string;
      content: string;
    }
  | {
      type: "error";
      code: string;
      message: string;
      retryable: boolean;
    };

export function encodeChatStreamEvent(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function readChatStream(
  response: Response,
  onEvent: (event: ChatStreamEvent) => void | Promise<void>,
): Promise<void> {
  if (!response.body) throw new ChatStreamProtocolError("missing_stream_body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = findFrameBoundary(buffer);

    while (boundary) {
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const data = frame
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) await onEvent(parseEvent(data));
      boundary = findFrameBoundary(buffer);
    }

    if (done) break;
  }

  if (buffer.trim()) {
    throw new ChatStreamProtocolError("incomplete_stream_frame");
  }
}

function parseEvent(data: string): ChatStreamEvent {
  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    throw new ChatStreamProtocolError("invalid_stream_json");
  }

  if (!isRecord(value) || typeof value.type !== "string") {
    throw new ChatStreamProtocolError("invalid_stream_event");
  }
  if (
    value.type === "assistant_delta" &&
    typeof value.messageId === "string" &&
    typeof value.delta === "string"
  ) {
    return value as ChatStreamEvent;
  }
  if (
    value.type === "complete" &&
    typeof value.messageId === "string" &&
    typeof value.content === "string"
  ) {
    return value as ChatStreamEvent;
  }
  if (
    value.type === "error" &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  ) {
    return value as ChatStreamEvent;
  }
  throw new ChatStreamProtocolError("invalid_stream_event");
}

function findFrameBoundary(
  buffer: string,
): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { index: crlf, length: 4 };
  }
  return { index: lf, length: 2 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export class ChatStreamProtocolError extends Error {
  constructor(public readonly code: string) {
    super("聊天服务返回了无法读取的数据流。");
    this.name = "ChatStreamProtocolError";
  }
}
