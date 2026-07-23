import { expect, it } from "vitest";

import { readFinalizeJob } from "./finalize-job";

const base = {
  id: "job-1",
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z",
};

it("reads queued and running job snapshots", async () => {
  await expect(
    readFinalizeJob(Response.json({ ...base, state: "queued" })),
  ).resolves.toMatchObject({ id: "job-1", state: "queued" });

  await expect(
    readFinalizeJob(
      Response.json({ ...base, state: "running", stage: "researching" }),
    ),
  ).resolves.toMatchObject({ state: "running", stage: "researching" });
});

it("requires terminal payloads for completed and failed jobs", async () => {
  await expect(
    readFinalizeJob(Response.json({ ...base, state: "completed" })),
  ).rejects.toMatchObject({ code: "invalid_job_snapshot" });

  await expect(
    readFinalizeJob(Response.json({ ...base, state: "failed" })),
  ).rejects.toMatchObject({ code: "invalid_job_snapshot" });
});

it("accepts complete and failed terminal snapshots", async () => {
  const assessment = { projectId: "p1", promptVersion: "v1" };
  await expect(
    readFinalizeJob(
      Response.json({ ...base, state: "completed", assessment }),
    ),
  ).resolves.toMatchObject({ state: "completed", assessment });

  const error = { code: "provider_timeout", message: "timeout", retryable: true };
  await expect(
    readFinalizeJob(Response.json({ ...base, state: "failed", error })),
  ).resolves.toMatchObject({ state: "failed", error });
});

