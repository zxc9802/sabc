import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { finalizeJobStore } from "@/lib/finalization/finalize-job-store";

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/finalize-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validRequest() {
  return {
    projectId: "p1",
    projectDescription: "测试项目",
    messages: [
      { id: "m1", role: "user", content: "项目事实", round: 0 },
    ],
    interviewDepth: "medium",
    round: 1,
    researchMode: "interview_only",
  };
}

beforeEach(() => {
  process.env.DEEPSEEK_API_ENDPOINT = "https://provider.example/chat/completions";
  process.env.DEEPSEEK_MODEL = "deepseek-v4-pro";
  process.env.DEEPSEEK_API_KEY = "route-test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEEPSEEK_API_ENDPOINT;
  delete process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPSEEK_API_KEY;
});

it("returns a job id before the provider finishes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>(() => {
          // Keep the provider pending to prove job creation is immediate.
        }),
    ),
  );

  const response = await POST(request(validRequest()));
  const body = (await response.json()) as { jobId: string; state: string };

  expect(response.status).toBe(202);
  expect(body).toEqual({
    jobId: expect.any(String),
    state: "queued",
  });
  expect(finalizeJobStore.get(body.jobId)).not.toBeNull();
});

it("preserves finalization validation and configuration errors", async () => {
  expect((await POST(request({ projectId: "p1" }))).status).toBe(400);

  delete process.env.DEEPSEEK_API_KEY;
  expect((await POST(request(validRequest()))).status).toBe(503);
});

