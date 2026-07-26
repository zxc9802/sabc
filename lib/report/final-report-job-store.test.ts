import { expect, it } from "vitest";

import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";

import { FinalReportJobStore } from "./final-report-job-store";

const assessment = {
  projectId: "project-1",
  projectName: "Test",
} as AnalyzeProjectResponse;

it("moves a report job from queued through running to completed", () => {
  const store = new FinalReportJobStore();
  const job = store.create();

  store.apply(job.id, { type: "status", stage: "analyzing" });
  store.apply(job.id, { type: "assessment", result: assessment });
  store.apply(job.id, { type: "complete" });

  expect(store.get(job.id)).toMatchObject({
    state: "completed",
    stage: "analyzing",
    assessment,
  });
});

it("stores failures and expires terminal report jobs after thirty minutes", () => {
  let now = Date.parse("2026-07-26T00:00:00.000Z");
  const store = new FinalReportJobStore({ now: () => now });
  const job = store.create();

  store.apply(job.id, {
    type: "error",
    stage: "analyzing",
    code: "provider_timeout",
    message: "生成超时",
    retryable: true,
  });
  expect(store.get(job.id)).toMatchObject({
    state: "failed",
    error: {
      code: "provider_timeout",
      message: "生成超时",
      retryable: true,
    },
  });

  now += 30 * 60 * 1000;
  expect(store.get(job.id)).toBeNull();
});
