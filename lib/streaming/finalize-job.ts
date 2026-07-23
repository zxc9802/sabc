import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";
import type { ResearchSnapshotRecord } from "@/lib/research/research-types";
import type { FinalizeStage } from "@/lib/streaming/finalize-stream";

interface JobBase {
  id: string;
  stage?: FinalizeStage;
  researchQueries?: string[];
  researchSnapshot?: ResearchSnapshotRecord;
  createdAt: string;
  updatedAt: string;
}

export type FinalizeJobSnapshot =
  | (JobBase & { state: "queued" | "running" })
  | (JobBase & {
      state: "completed";
      assessment: AnalyzeProjectResponse;
    })
  | (JobBase & {
      state: "failed";
      error: {
        code: string;
        message: string;
        retryable: boolean;
      };
    });

export async function readFinalizeJob(
  response: Response,
): Promise<FinalizeJobSnapshot> {
  const value = (await response.json()) as unknown;
  if (!isRecord(value) || !hasBase(value)) throw invalidSnapshot();

  if (value.state === "queued" || value.state === "running") {
    if (value.stage !== undefined && !isFinalizeStage(value.stage)) {
      throw invalidSnapshot();
    }
    return value as unknown as FinalizeJobSnapshot;
  }

  if (
    value.state === "completed" &&
    isRecord(value.assessment)
  ) {
    return value as unknown as FinalizeJobSnapshot;
  }

  if (
    value.state === "failed" &&
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string" &&
    typeof value.error.retryable === "boolean"
  ) {
    return value as unknown as FinalizeJobSnapshot;
  }

  throw invalidSnapshot();
}

function hasBase(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === "string" &&
    typeof value.state === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isFinalizeStage(value: unknown): value is FinalizeStage {
  return (
    value === "planning_research" ||
    value === "researching" ||
    value === "analyzing" ||
    value === "scoring"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export class FinalizeJobProtocolError extends Error {
  readonly code = "invalid_job_snapshot";

  constructor() {
    super("最终分析任务返回了无法读取的状态。");
    this.name = "FinalizeJobProtocolError";
  }
}

function invalidSnapshot(): FinalizeJobProtocolError {
  return new FinalizeJobProtocolError();
}
