import { expect, it } from "vitest";

import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";
import type { ResearchSnapshotRecord } from "@/lib/research/research-types";

import { FinalizeJobStore } from "./finalize-job-store";

const assessment = {
  projectId: "p1",
  projectName: "Test",
} as AnalyzeProjectResponse;

const researchSnapshot = {
  id: "research-p1",
  projectId: "p1",
  queries: ["market"],
  sources: [],
  status: "completed",
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z",
} satisfies ResearchSnapshotRecord;

it("moves a job from queued through running to completed", () => {
  const store = new FinalizeJobStore();
  const job = store.create();

  expect(store.get(job.id)).toMatchObject({ state: "queued" });

  store.apply(job.id, { type: "status", stage: "analyzing" });
  store.apply(job.id, { type: "research_plan", queries: ["market"] });
  store.apply(job.id, {
    type: "research_complete",
    snapshot: researchSnapshot,
  });
  store.apply(job.id, { type: "assessment", result: assessment });
  store.apply(job.id, { type: "complete" });

  expect(store.get(job.id)).toMatchObject({
    state: "completed",
    stage: "analyzing",
    researchQueries: ["market"],
    researchSnapshot,
    assessment,
  });
});

it("stores a safe terminal failure", () => {
  const store = new FinalizeJobStore();
  const job = store.create();

  store.apply(job.id, { type: "status", stage: "researching" });
  store.apply(job.id, {
    type: "error",
    stage: "researching",
    code: "provider_timeout",
    message: "AI 服务响应超时，请重新分析。",
    retryable: true,
  });

  expect(store.get(job.id)).toMatchObject({
    state: "failed",
    stage: "researching",
    error: {
      code: "provider_timeout",
      message: "AI 服务响应超时，请重新分析。",
      retryable: true,
    },
  });
});

it("returns cloned snapshots that cannot mutate registry state", () => {
  const store = new FinalizeJobStore();
  const job = store.create();
  store.apply(job.id, { type: "research_plan", queries: ["market"] });

  const snapshot = store.get(job.id);
  snapshot?.researchQueries?.push("mutated");

  expect(store.get(job.id)?.researchQueries).toEqual(["market"]);
});

it("expires terminal jobs after thirty minutes", () => {
  let now = Date.parse("2026-07-23T00:00:00.000Z");
  const store = new FinalizeJobStore({ now: () => now });
  const job = store.create();
  store.apply(job.id, { type: "assessment", result: assessment });
  store.apply(job.id, { type: "complete" });

  now += 30 * 60 * 1000 - 1;
  expect(store.get(job.id)).not.toBeNull();

  now += 1;
  expect(store.get(job.id)).toBeNull();
  expect(store.get("missing")).toBeNull();
});

