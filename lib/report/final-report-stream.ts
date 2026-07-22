import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";

export type FinalReportStage = "analyzing" | "scoring";

export type FinalReportStreamEvent =
  | { type: "status"; stage: FinalReportStage }
  | { type: "assessment"; result: AnalyzeProjectResponse }
  | { type: "complete" }
  | {
      type: "error";
      stage: FinalReportStage;
      code: string;
      message: string;
      retryable: boolean;
    };

export function encodeFinalReportStreamEvent(event: FinalReportStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function readFinalReportStream(
  response: Response,
  onEvent: (event: FinalReportStreamEvent) => void | Promise<void>,
): Promise<void> {
  if (!response.body) throw new FinalReportStreamProtocolError("missing_stream_body");

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

  if (buffer.trim()) throw new FinalReportStreamProtocolError("incomplete_stream_frame");
}

function parseEvent(data: string): FinalReportStreamEvent {
  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    throw new FinalReportStreamProtocolError("invalid_stream_json");
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new FinalReportStreamProtocolError("invalid_stream_event");
  }
  if (value.type === "status" && isStage(value.stage)) {
    return value as FinalReportStreamEvent;
  }
  if (value.type === "assessment" && isRecord(value.result)) {
    return value as FinalReportStreamEvent;
  }
  if (value.type === "complete") return value as FinalReportStreamEvent;
  if (
    value.type === "error" &&
    isStage(value.stage) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  ) {
    return value as FinalReportStreamEvent;
  }
  throw new FinalReportStreamProtocolError("invalid_stream_event");
}

function findFrameBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function isStage(value: unknown): value is FinalReportStage {
  return value === "analyzing" || value === "scoring";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export class FinalReportStreamProtocolError extends Error {
  constructor(public readonly code: string) {
    super("最终报告服务返回了无法读取的数据流。");
    this.name = "FinalReportStreamProtocolError";
  }
}
