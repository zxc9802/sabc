import { expect, it } from "vitest";

import { reportJobStore } from "@/lib/report/final-report-job-store";

import { GET } from "./route";

it("returns a known report job without allowing caches", async () => {
  const job = reportJobStore.create();
  const response = await GET(new Request("http://localhost"), {
    params: Promise.resolve({ jobId: job.id }),
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ id: job.id, state: "queued" });
});

it("returns a retryable error for an unknown report job", async () => {
  const response = await GET(new Request("http://localhost"), {
    params: Promise.resolve({ jobId: "missing" }),
  });

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    code: "job_not_found",
    message: "最终报告任务不存在或已过期，请重新生成报告。",
    retryable: true,
  });
});
