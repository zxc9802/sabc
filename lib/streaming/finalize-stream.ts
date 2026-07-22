import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";
import type { ResearchSnapshotRecord } from "@/lib/research/research-types";

export type FinalizeStage =
  | "planning_research"
  | "researching"
  | "analyzing"
  | "scoring";

export type FinalizeStreamEvent =
  | { type: "status"; stage: FinalizeStage }
  | { type: "research_plan"; queries: string[] }
  | { type: "research_complete"; snapshot: ResearchSnapshotRecord }
  | { type: "assessment"; result: AnalyzeProjectResponse }
  | { type: "complete" }
  | {
      type: "error";
      stage: FinalizeStage;
      code: string;
      message: string;
      retryable: boolean;
    };

export function encodeFinalizeStreamEvent(event: FinalizeStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function readFinalizeStream(
  response: Response,
  onEvent: (event: FinalizeStreamEvent) => void | Promise<void>,
): Promise<void> {
  if (!response.body) {
    throw new FinalizeStreamProtocolError("missing_stream_body");
  }

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
    throw new FinalizeStreamProtocolError("incomplete_stream_frame");
  }
}

function parseEvent(data: string): FinalizeStreamEvent {
  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    throw new FinalizeStreamProtocolError("invalid_stream_json");
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new FinalizeStreamProtocolError("invalid_stream_event");
  }
  if (
    value.type === "status" &&
    isFinalizeStage(value.stage)
  ) {
    return value as FinalizeStreamEvent;
  }
  if (
    value.type === "research_plan" &&
    Array.isArray(value.queries) &&
    value.queries.every((query) => typeof query === "string")
  ) {
    return value as FinalizeStreamEvent;
  }
  if (value.type === "research_complete" && isRecord(value.snapshot)) {
    return value as FinalizeStreamEvent;
  }
  if (value.type === "assessment" && isRecord(value.result)) {
    return value as FinalizeStreamEvent;
  }
  if (value.type === "complete") return value as FinalizeStreamEvent;
  if (
    value.type === "error" &&
    isFinalizeStage(value.stage) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  ) {
    return value as FinalizeStreamEvent;
  }
  throw new FinalizeStreamProtocolError("invalid_stream_event");
}

function isFinalizeStage(value: unknown): value is FinalizeStage {
  return (
    value === "planning_research" ||
    value === "researching" ||
    value === "analyzing" ||
    value === "scoring"
  );
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

export class FinalizeStreamProtocolError extends Error {
  constructor(public readonly code: string) {
    super("最终分析服务返回了无法读取的数据流。");
    this.name = "FinalizeStreamProtocolError";
  }
}
