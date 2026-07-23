import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";
import type { ResearchSnapshotRecord } from "@/lib/research/research-types";
import type {
  FinalizeStage,
  FinalizeStreamEvent,
} from "@/lib/streaming/finalize-stream";

export type FinalizeJobState = "queued" | "running" | "completed" | "failed";

export interface FinalizeJobSnapshot {
  id: string;
  state: FinalizeJobState;
  stage?: FinalizeStage;
  researchQueries?: string[];
  researchSnapshot?: ResearchSnapshotRecord;
  assessment?: AnalyzeProjectResponse;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

interface FinalizeJobStoreOptions {
  now?: () => number;
  retentionMs?: number;
}

export class FinalizeJobStore {
  private readonly jobs = new Map<string, FinalizeJobSnapshot>();
  private readonly now: () => number;
  private readonly retentionMs: number;

  constructor(options: FinalizeJobStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.retentionMs = options.retentionMs ?? 30 * 60 * 1000;
  }

  create(): FinalizeJobSnapshot {
    this.cleanup();
    const timestamp = new Date(this.now()).toISOString();
    const job: FinalizeJobSnapshot = {
      id: crypto.randomUUID(),
      state: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  apply(jobId: string, event: FinalizeStreamEvent): void {
    const job = this.jobs.get(jobId);
    if (!job || job.state === "completed" || job.state === "failed") return;

    job.updatedAt = new Date(this.now()).toISOString();
    switch (event.type) {
      case "status":
        job.state = "running";
        job.stage = event.stage;
        break;
      case "research_plan":
        job.state = "running";
        job.researchQueries = [...event.queries];
        break;
      case "research_complete":
        job.state = "running";
        job.researchSnapshot = structuredClone(event.snapshot);
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

  get(jobId: string): FinalizeJobSnapshot | null {
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

export const finalizeJobStore = new FinalizeJobStore();

