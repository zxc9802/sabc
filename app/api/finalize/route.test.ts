import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { DimensionKey } from "@/lib/domain/types";
import { getRubric } from "@/lib/rubric/catalog";
import {
  readFinalizeStream,
  type FinalizeStreamEvent,
} from "@/lib/streaming/finalize-stream";

import { POST } from "./route";

const classification = {
  projectName: "海外电商项目",
  primaryCategory: "ecommerce",
  secondaryCategories: [],
  categoryReason: "项目面向海外电商市场。",
};

const dimensionKeys: DimensionKey[] = [
  "strategic_value",
  "demand_evidence",
  "return_potential",
  "execution_feasibility",
  "resource_fit",
  "timing_differentiation",
  "risk_control",
];

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
  return new Request("http://localhost/api/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "p1",
    projectDescription: "海外电商项目",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "内部订单秘密，只允许模型分析",
        round: 0,
      },
    ],
    interviewDepth: "medium",
    round: 1,
    researchMode: "auto",
    ...overrides,
  };
}

function anySearchResponse(): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [
        {
          type: "text",
          text: `## Search Results (1 result)

### 1. Official market report
- **URL**: https://example.com/market
- Market demand increased in 2026.`,
        },
      ],
    },
  });
}

beforeEach(() => {
  process.env.DEEPSEEK_API_ENDPOINT = "https://provider.example/chat/completions";
  process.env.DEEPSEEK_MODEL = "gpt-5.6-luna";
  process.env.DEEPSEEK_API_KEY = "route-test-key";
  process.env.ANYSEARCH_API_KEY = "anysearch-test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEEPSEEK_API_ENDPOINT;
  delete process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.ANYSEARCH_API_KEY;
});

it("returns JSON errors for invalid input or missing model configuration", async () => {
  expect((await POST(request({ projectId: "p1" }))).status).toBe(400);
  delete process.env.DEEPSEEK_API_KEY;
  expect((await POST(request(validRequest()))).status).toBe(503);
});

it("researches first and puts real sources into the final model request", async () => {
  const providerOutputs = [
    { queries: ["跨境电商 市场规模"] },
    classification,
    analysisResponse(),
  ];
  const providerBodies: Array<Record<string, unknown>> = [];
  const anySearchBodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (String(url).includes("api.anysearch.com")) {
        anySearchBodies.push(body);
        return anySearchResponse();
      }
      providerBodies.push(body);
      return Response.json({
        choices: [{ message: { content: JSON.stringify(providerOutputs.shift()) } }],
      });
    }),
  );

  const response = await POST(request(validRequest()));
  const events: FinalizeStreamEvent[] = [];
  await readFinalizeStream(response, (event) => {
    events.push(event);
  });

  expect(events.map((event) =>
    event.type === "status" ? `${event.type}:${event.stage}` : event.type,
  )).toEqual([
    "status:planning_research",
    "research_plan",
    "status:researching",
    "research_complete",
    "status:analyzing",
    "status:scoring",
    "assessment",
    "complete",
  ]);
  const finalBody = JSON.stringify(providerBodies.at(-1));
  expect(finalBody).toContain("Official market report");
  expect(finalBody).toContain("Market demand increased in 2026.");
  expect(finalBody).toContain("https://example.com/market");
  expect(JSON.stringify(anySearchBodies)).not.toContain("内部订单秘密");
});

it("budgets external research before sending it to the final model", async () => {
  const queries = ["query one", "query two", "query three", "query four", "query five"];
  const providerOutputs = [{ queries }, classification, analysisResponse()];
  const providerBodies: Array<Record<string, unknown>> = [];
  const anySearchBodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (String(url).includes("api.anysearch.com")) {
        anySearchBodies.push(body);
        const params = body.params as {
          arguments: { query: string };
        };
        const slug = params.arguments.query.replaceAll(" ", "-");
        const longSnippet = "evidence ".repeat(180);
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: {
            content: [
              {
                type: "text",
                text: [1, 2, 3]
                  .map(
                    (index) =>
                      `### ${index}. ${slug} source ${index}\n- **URL**: https://example.com/${slug}/${index}\n- ${longSnippet}`,
                  )
                  .join("\n\n"),
              },
            ],
          },
        });
      }
      providerBodies.push(body);
      return Response.json({
        choices: [{ message: { content: JSON.stringify(providerOutputs.shift()) } }],
      });
    }),
  );

  const response = await POST(request(validRequest()));
  const events: FinalizeStreamEvent[] = [];
  await readFinalizeStream(response, (event) => {
    events.push(event);
  });
  const researchEvent = events.find(
    (event): event is Extract<FinalizeStreamEvent, { type: "research_complete" }> =>
      event.type === "research_complete",
  );

  expect(researchEvent?.snapshot.sources).toHaveLength(6);
  expect(anySearchBodies).toHaveLength(3);
  expect(
    researchEvent?.snapshot.sources.every(({ snippet }) => snippet.length <= 800),
  ).toBe(true);
  const finalBody = JSON.stringify(providerBodies.at(-1));
  expect(finalBody).toContain("query-one source 1");
  expect(finalBody).not.toContain("query-three source 1");
});

it("reuses a completed research snapshot without calling AnySearch", async () => {
  const providerOutputs = [classification, analysisResponse()];
  const fetchImpl = vi.fn(async (url) => {
    expect(String(url)).toBe("https://provider.example/chat/completions");
    return Response.json({
      choices: [{ message: { content: JSON.stringify(providerOutputs.shift()) } }],
    });
  });
  vi.stubGlobal("fetch", fetchImpl);

  const response = await POST(
    request(
      validRequest({
        researchSnapshot: {
          id: "research-p1",
          projectId: "p1",
          queries: ["market"],
          sources: [
            {
              title: "Saved source",
              url: "https://example.com/saved",
              snippet: "Saved research text",
              query: "market",
            },
          ],
          status: "completed",
          createdAt: "2026-07-22T00:00:00.000Z",
          updatedAt: "2026-07-22T00:00:00.000Z",
        },
      }),
    ),
  );
  const events: FinalizeStreamEvent[] = [];
  await readFinalizeStream(response, (event) => {
    events.push(event);
  });

  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(events[0]).toMatchObject({ type: "research_complete" });
  expect(events.some((event) => event.type === "assessment")).toBe(true);
});

it("stops after an unavailable research snapshot so the user can choose", async () => {
  const providerOutputs = [{ queries: ["跨境电商 市场规模"] }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).includes("api.anysearch.com")) {
        return new Response("busy", { status: 503 });
      }
      return Response.json({
        choices: [{ message: { content: JSON.stringify(providerOutputs.shift()) } }],
      });
    }),
  );

  const response = await POST(request(validRequest()));
  const events: FinalizeStreamEvent[] = [];
  await readFinalizeStream(response, (event) => {
    events.push(event);
  });

  expect(events.some((event) =>
    event.type === "research_complete" && event.snapshot.status === "unavailable",
  )).toBe(true);
  expect(events.at(-1)).toMatchObject({
    type: "error",
    stage: "researching",
    code: "research_unavailable",
  });
  expect(events.some((event) => event.type === "assessment")).toBe(false);
});

it("supports an explicit interview-only final report without AnySearch", async () => {
  const providerOutputs = [classification, analysisResponse()];
  const fetchImpl = vi.fn(async (url) => {
    expect(String(url)).toBe("https://provider.example/chat/completions");
    return Response.json({
      choices: [{ message: { content: JSON.stringify(providerOutputs.shift()) } }],
    });
  });
  vi.stubGlobal("fetch", fetchImpl);

  const response = await POST(
    request(validRequest({ researchMode: "interview_only" })),
  );
  const events: FinalizeStreamEvent[] = [];
  await readFinalizeStream(response, (event) => {
    events.push(event);
  });

  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "research_complete",
      snapshot: expect.objectContaining({ status: "unavailable", sources: [] }),
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "assessment",
      result: expect.objectContaining({ researchStatus: "unavailable" }),
    }),
  );
});
