import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { DimensionKey } from "@/lib/domain/types";
import { reportJobStore } from "@/lib/report/final-report-job-store";

import { POST } from "./route";

const dimensionKeys: DimensionKey[] = [
  "strategic_value",
  "demand_evidence",
  "return_potential",
  "execution_feasibility",
  "resource_fit",
  "timing_differentiation",
  "risk_control",
];

function request(body: unknown): Request {
  return new Request("http://localhost/api/report-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validRequest() {
  return {
    projectId: "project-1",
    projectDescription: "在新加坡销售口红",
    messages: [
      {
        id: "interview-1",
        role: "user",
        content: "项目事实",
        round: 0,
        stage: "interview",
      },
    ],
    interviewDepth: "medium",
    researchSnapshot: {
      id: "research-project-1",
      projectId: "project-1",
      queries: ["新加坡口红 市场"],
      sources: [],
      status: "completed",
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    },
    stageAssessment: {
      grade: "A",
      totalScore: 78,
      confidence: 80,
      categoryReason: "海外电商项目",
      researchStatus: "completed",
      dimensions: dimensionKeys.map((key) => ({
        key,
        appliedScore: 4,
        facts: ["阶段事实"],
        deductions: [],
      })),
    },
  };
}

beforeEach(() => {
  process.env.DEEPSEEK_API_ENDPOINT = "https://provider.example/chat/completions";
  process.env.DEEPSEEK_MODEL = "gpt-5.6-luna";
  process.env.DEEPSEEK_API_KEY = "report-job-test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEEPSEEK_API_ENDPOINT;
  delete process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPSEEK_API_KEY;
});

it("returns a report job id before the provider finishes", async () => {
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
  expect(body).toEqual({ jobId: expect.any(String), state: "queued" });
  expect(reportJobStore.get(body.jobId)).not.toBeNull();
});

it("preserves report validation and configuration errors", async () => {
  expect((await POST(request({ projectId: "project-1" }))).status).toBe(400);

  delete process.env.DEEPSEEK_API_KEY;
  expect((await POST(request(validRequest()))).status).toBe(503);
});
