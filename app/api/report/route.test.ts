import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { DimensionKey } from "@/lib/domain/types";
import { getRubric } from "@/lib/rubric/catalog";
import {
  readFinalReportStream,
  type FinalReportStreamEvent,
} from "@/lib/report/final-report-stream";

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

const classification = {
  projectName: "跨境口红项目",
  primaryCategory: "ecommerce",
  secondaryCategories: [],
  categoryReason: "海外电商项目",
};

function analysisResponse() {
  const rubric = getRubric("ecommerce");
  return {
    ...classification,
    dimensions: dimensionKeys.map((dimension) => ({
      dimension,
      proposedScore: 4,
      facts: [`${dimension} fact`],
      deductions: [],
      evidence: rubric.slots[dimension].map((slot) => ({
        slotId: slot.id,
        statement: slot.label,
        state: "specific_unverified",
        origin: "user_input",
      })),
    })),
    vetoRisks: [],
    criticalUnknowns: [],
    questionCandidates: [],
    research: { needed: false, reason: "", queries: [] },
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/report", {
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
        role: "assistant",
        content: "AI 访谈员的问题",
        round: 0,
        stage: "interview",
      },
      {
        id: "advisor-1",
        role: "assistant",
        content: "项目建议智能体的判断",
        round: 0,
        stage: "advisory",
      },
    ],
    interviewDepth: "medium",
    researchSnapshot: {
      id: "research-project-1",
      projectId: "project-1",
      queries: ["新加坡口红 市场"],
      sources: [
        {
          title: "Saved market source",
          url: "https://example.com/market",
          snippet: "Saved market evidence",
          query: "新加坡口红 市场",
        },
      ],
      status: "completed",
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
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
  process.env.DEEPSEEK_API_KEY = "report-route-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEEPSEEK_API_ENDPOINT;
  delete process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPSEEK_API_KEY;
});

it("uses saved research and both conversations without starting another search", async () => {
  const outputs = [classification, analysisResponse()];
  const fetchImpl = vi.fn(async (url) => {
    expect(String(url)).toBe("https://provider.example/chat/completions");
    return Response.json({
      choices: [{ message: { content: JSON.stringify(outputs.shift()) } }],
    });
  });
  vi.stubGlobal("fetch", fetchImpl);

  const response = await POST(request(validRequest()));
  const events: FinalReportStreamEvent[] = [];
  await readFinalReportStream(response, (event) => events.push(event));

  expect(
    events.map((event) =>
      event.type === "status" ? `${event.type}:${event.stage}` : event.type,
    ),
  ).toEqual(["status:analyzing", "status:scoring", "assessment", "complete"]);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  const providerInput = JSON.stringify(fetchImpl.mock.calls);
  expect(providerInput).toContain("AI 访谈员的问题");
  expect(providerInput).toContain("项目建议智能体的判断");
  expect(providerInput).toContain("Saved market evidence");
  const finalBody = JSON.parse(
    String(fetchImpl.mock.calls[1][1]?.body),
  ) as { messages: Array<{ content: string }> };
  expect(JSON.parse(finalBody.messages[1].content).stageAssessment.grade).toBe("A");
});

it("rejects invalid input before calling the model", async () => {
  const fetchImpl = vi.fn();
  vi.stubGlobal("fetch", fetchImpl);

  expect((await POST(request({ projectId: "project-1" }))).status).toBe(400);
  expect(fetchImpl).not.toHaveBeenCalled();
});
