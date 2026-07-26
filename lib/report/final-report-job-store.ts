import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";

import type {
  FinalReportStage,
  FinalReportStreamEvent,
} from "./final-report-stream";

export type FinalReportJobState =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface FinalReportJobSnapshot {
  id: string;
  state: FinalReportJobState;
  stage?: FinalReportStage;
  assessment?: AnalyzeProjectResponse;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

interface FinalReportJobStoreOptions {
  now?: () => number;
  retentionMs?: number;
}

export class FinalReportJobStore {
  private readonly jobs = new Map<string, FinalReportJobSnapshot>();
  private readonly now: () => number;
  private readonly retentionMs: number;

  constructor(options: FinalReportJobStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.retentionMs = options.retentionMs ?? 30 * 60 * 1000;
  }

  create(): FinalReportJobSnapshot {
    this.cleanup();
    const timestamp = new Date(this.now()).toISOString();
    const job: FinalReportJobSnapshot = {
      id: crypto.randomUUID(),
      state: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  apply(jobId: string, event: FinalReportStreamEvent): void {
    const job = this.jobs.get(jobId);
    if (!job || job.state === "completed" || job.state === "failed") return;

    job.updatedAt = new Date(this.now()).toISOString();
    switch (event.type) {
      case "status":
        job.state = "running";
        job.stage = event.stage;
        break;
      case "assessment":
        job.state = "running";
        job.assessment = structuredClone(event.result);
        break;
      case "complete":
        job.state = "completed";
        break;
      case "error":
        job.state = "failed";
        job.stage = event.stage;
        job.error = {
          code: event.code,
          message: event.message,
          retryable: event.retryable,
        };
        break;
    }
  }

  get(jobId: string): FinalReportJobSnapshot | null {
    this.cleanup();
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : null;
  }

  private cleanup(): void {
    const cutoff = this.now() - this.retentionMs;
    for (const [jobId, job] of this.jobs) {
      if (
        (job.state === "completed" || job.state === "failed") &&
        Date.parse(job.updatedAt) <= cutoff
      ) {
        this.jobs.delete(jobId);
      }
    }
  }
}

export const reportJobStore = new FinalReportJobStore();
