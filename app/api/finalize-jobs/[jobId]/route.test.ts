import { expect, it } from "vitest";

import { finalizeJobStore } from "@/lib/finalization/finalize-job-store";

import { GET } from "./route";

it("returns a known job without allowing caches", async () => {
  const job = finalizeJobStore.create();
  const response = await GET(new Request("http://localhost"), {
    params: Promise.resolve({ jobId: job.id }),
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ id: job.id, state: "queued" });
});

it("returns a safe retryable error for an unknown job", async () => {
  const response = await GET(new Request("http://localhost"), {
    params: Promise.resolve({ jobId: "missing" }),
  });

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    code: "job_not_found",
    message: "分析任务不存在或已过期，请重新开始最终分析。",
    retryable: true,
  });
});

