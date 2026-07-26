import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";

import type { FinalReportStage } from "./final-report-stream";

interface JobBase {
  id: string;
  stage?: FinalReportStage;
  createdAt: string;
  updatedAt: string;
}

export type FinalReportJobSnapshot =
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

export async function readFinalReportJob(
  response: Response,
): Promise<FinalReportJobSnapshot> {
  const value = (await response.json()) as unknown;
  if (!isRecord(value) || !hasBase(value)) throw invalidSnapshot();

  if (value.state === "queued" || value.state === "running") {
    return value as unknown as FinalReportJobSnapshot;
  }
  if (value.state === "completed" && isRecord(value.assessment)) {
    return value as unknown as FinalReportJobSnapshot;
  }
  if (
    value.state === "failed" &&
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string" &&
    typeof value.error.retryable === "boolean"
  ) {
    return value as unknown as FinalReportJobSnapshot;
  }

  throw invalidSnapshot();
}

function hasBase(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === "string" &&
    typeof value.state === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.stage === undefined || isStage(value.stage))
  );
}

function isStage(value: unknown): value is FinalReportStage {
  return value === "analyzing" || value === "scoring";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export class FinalReportJobProtocolError extends Error {
  readonly code = "invalid_report_job_snapshot";

  constructor() {
    super("最终报告任务返回了无法读取的状态。");
    this.name = "FinalReportJobProtocolError";
  }
}

function invalidSnapshot(): FinalReportJobProtocolError {
  return new FinalReportJobProtocolError();
}
