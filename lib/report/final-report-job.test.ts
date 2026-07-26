import { expect, it } from "vitest";

import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";

import {
  FinalReportJobProtocolError,
  readFinalReportJob,
} from "./final-report-job";

const base = {
  id: "report-job-1",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:01.000Z",
};
const assessment = {
  projectId: "project-1",
  projectName: "Test",
} as AnalyzeProjectResponse;

it("reads running, completed, and failed report jobs", async () => {
  await expect(
    readFinalReportJob(
      Response.json({ ...base, state: "running", stage: "analyzing" }),
    ),
  ).resolves.toMatchObject({ state: "running", stage: "analyzing" });
  await expect(
    readFinalReportJob(
      Response.json({ ...base, state: "completed", assessment }),
    ),
  ).resolves.toMatchObject({ state: "completed", assessment });
  await expect(
    readFinalReportJob(
      Response.json({
        ...base,
        state: "failed",
        error: { code: "provider_timeout", message: "超时", retryable: true },
      }),
    ),
  ).resolves.toMatchObject({ state: "failed" });
});

it("rejects malformed report job snapshots", async () => {
  await expect(
    readFinalReportJob(Response.json({ ...base, state: "completed" })),
  ).rejects.toBeInstanceOf(FinalReportJobProtocolError);
});
