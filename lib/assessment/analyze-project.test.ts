import type { DimensionKey, EvidenceState } from "@/lib/domain/types";
import { getRubric } from "@/lib/rubric/catalog";
import { scoreAssessment } from "@/lib/scoring/score-assessment";
import { expect, it, vi } from "vitest";

import type { AnalyzeProjectInput, ModelClient } from "./analyze-project";
import { analyzeProject } from "./analyze-project";

const classification = {
  projectName: "测试软件",
  primaryCategory: "software",
  secondaryCategories: [],
  categoryReason: "有软件开发特征",
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

function analysisResponse(options?: {
  researchNeeded?: boolean;
  evidenceState?: EvidenceState;
  sourceUrl?: string;
  confirmedVeto?: boolean;
}) {
  const rubric = getRubric("software");
  const state = options?.evidenceState ?? "specific_unverified";

  return {
    ...classification,
    dimensions: dimensionKeys.map((dimension) => ({
      dimension,
      proposedScore: 4,
      facts: [`${dimension} 事实`],
      deductions: [],
      evidence: rubric.slots[dimension].map((slot) => ({
        slotId: slot.id,
        statement: `${slot.label}证据`,
        state,
        origin: "user_input",
        ...(options?.sourceUrl
          ? { sourceTitle: "模型生成来源", sourceUrl: options.sourceUrl }
          : {}),
      })),
    })),
    vetoRisks: options?.confirmedVeto
      ? [
          {
            ruleId: "illegal_or_unethical",
            state: "confirmed",
            reason: "模型声称已确认",
            evidence: [
              {
                slotId: "risk_compliance",
                statement: "没有用户消息引用",
                state: "verified",
                origin: "model_inference",
              },
            ],
          },
        ]
      : [],
    criticalUnknowns: [],
    questionCandidates: [
      {
        id: "q1",
        prompt: "是否已有付费客户？",
        reason: "验证需求",
        targetDimension: "demand_evidence",
        impact: 80,
        quickOptions: ["有", "没有"],
      },
    ],
    research: {
      needed: options?.researchNeeded ?? false,
      reason: options?.researchNeeded ? "需要当前市场数据" : "",
      queries: [],
    },
  };
}

function fakeClient(responses: unknown[]): ModelClient & {
  generate: ReturnType<typeof vi.fn>;
} {
  const generate = vi.fn(async () => {
    const next = responses.shift() ?? {};
    return { text: typeof next === "string" ? next : JSON.stringify(next), researchAvailable: false };
  });
  return { generate };
}

function input(): AnalyzeProjectInput {
  return {
    projectId: "p1",
    projectDescription: "做一个项目管理软件",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "做一个项目管理软件",
        round: 0,
      },
    ],
    questionHistory: [],
    interviewDepth: "medium",
    round: 0,
  };
}

it("classifies, scores, and selects one next question", async () => {
  const client = fakeClient([classification, analysisResponse()]);

  const output = await analyzeProject(client, input());

  expect(output.primaryCategory).toBe("software");
  expect(output.scored.totalScore).toBe(80);
  expect(output.nextQuestion?.id).toBe("q1");
  expect(client.generate).toHaveBeenCalledTimes(2);
});

it("marks required research unavailable without inventing a search call", async () => {
  const client = fakeClient([
    classification,
    analysisResponse({ researchNeeded: true }),
  ]);

  const output = await analyzeProject(client, input());

  expect(output.researchStatus).toBe("unavailable");
  expect(output.sources).toEqual([]);
  expect(client.generate).toHaveBeenCalledTimes(2);
});

it("removes model-supplied URLs and downgrades verified evidence", async () => {
  const client = fakeClient([
    classification,
    analysisResponse({
      evidenceState: "verified",
      sourceUrl: "https://model-invented.example/source",
    }),
  ]);

  const output = await analyzeProject(client, input());
  const evidence = output.analysis.dimensions[0].evidence[0];

  expect(evidence.sourceUrl).toBeUndefined();
  expect(evidence.sourceTitle).toBeUndefined();
  expect(evidence.state).toBe("specific_unverified");
});

it("downgrades a confirmed veto without an explicit user-message reference", async () => {
  const client = fakeClient([
    classification,
    analysisResponse({ confirmedVeto: true }),
  ]);

  const output = await analyzeProject(client, input());

  expect(output.analysis.vetoRisks[0].state).toBe("suspected");
  expect(output.scored.provisionalGrade).not.toBe("C");
});

it("retries one malformed analysis response", async () => {
  const client = fakeClient([
    classification,
    "not-json",
    analysisResponse(),
  ]);

  await expect(analyzeProject(client, input())).resolves.toBeDefined();
  expect(client.generate).toHaveBeenCalledTimes(3);
});

it("still selects a question after round twelve", async () => {
  const client = fakeClient([classification, analysisResponse()]);

  const output = await analyzeProject(client, { ...input(), round: 12 });

  expect(output.nextQuestion?.id).toBe("q1");
});

it("stops asking after an explicit finish command", async () => {
  const client = fakeClient([classification, analysisResponse()]);
  const base = input();

  const output = await analyzeProject(client, {
    ...base,
    messages: [
      ...base.messages,
      { id: "m2", role: "user", content: "结束评估", round: 8 },
    ],
    round: 8,
  });

  expect(output.nextQuestion).toBeNull();
});

it("moves away from a completed low-depth evidence chain", async () => {
  const analysis = analysisResponse();
  analysis.questionCandidates.push({
    id: "q-risk",
    prompt: "是否存在无法履约的风险？",
    reason: "验证风险",
    targetDimension: "risk_control",
    impact: 70,
    quickOptions: ["有", "没有"],
  });
  const client = fakeClient([classification, analysis]);

  const output = await analyzeProject(client, {
    ...input(),
    interviewDepth: "low",
    questionHistory: [
      { id: "old-demand", targetDimension: "demand_evidence" },
    ],
  });

  expect(output.nextQuestion?.targetDimension).toBe("risk_control");
});

it("uses real research in final analysis and scores exactly once", async () => {
  const analysis = analysisResponse();
  analysis.dimensions[0].evidence[0] = {
    ...analysis.dimensions[0].evidence[0],
    statement: "市场需求增长",
    state: "verified",
    origin: "external_source",
    sourceTitle: "Official market report",
    sourceUrl: "https://example.com/market",
  };
  const client = fakeClient([classification, analysis]);
  const score = vi.fn(scoreAssessment);

  const output = await analyzeProject(
    client,
    {
      ...input(),
      final: true,
      researchSnapshot: {
        id: "research-p1",
        projectId: "p1",
        queries: ["跨境电商 市场规模"],
        sources: [
          {
            title: "Official market report",
            url: "https://example.com/market",
            snippet: "Market demand increased.",
            query: "跨境电商 市场规模",
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
        categoryReason: "阶段评估",
        researchStatus: "completed",
        dimensions: [],
      },
    },
    score,
  );

  expect(score).toHaveBeenCalledOnce();
  expect(output.nextQuestion).toBeNull();
  expect(output.researchStatus).toBe("completed");
  expect(output.sources).toEqual([
    { title: "Official market report", url: "https://example.com/market" },
  ]);
  expect(output.analysis.dimensions[0].evidence[0]).toMatchObject({
    origin: "external_source",
    state: "verified",
    sourceTitle: "Official market report",
    sourceUrl: "https://example.com/market",
  });
  const finalPrompt = String(client.generate.mock.calls[1][0].userPrompt);
  expect(finalPrompt).toContain("Market demand increased.");
  expect(finalPrompt).toContain("https://example.com/market");
  expect(finalPrompt).toContain('"stageAssessment":{"grade":"A"');
});

it("removes an external URL that was not returned by research", async () => {
  const analysis = analysisResponse();
  analysis.dimensions[0].evidence[0] = {
    ...analysis.dimensions[0].evidence[0],
    state: "verified",
    origin: "external_source",
    sourceTitle: "Invented source",
    sourceUrl: "https://invented.example/source",
  };
  const client = fakeClient([classification, analysis]);

  const output = await analyzeProject(client, {
    ...input(),
    final: true,
    researchSnapshot: {
      id: "research-p1",
      projectId: "p1",
      queries: ["market"],
      sources: [
        {
          title: "Allowed source",
          url: "https://example.com/allowed",
          snippet: "Allowed text",
          query: "market",
        },
      ],
      status: "partial",
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    },
  });
  const evidence = output.analysis.dimensions[0].evidence[0];

  expect(evidence.origin).toBe("model_inference");
  expect(evidence.state).toBe("specific_unverified");
  expect(evidence.sourceUrl).toBeUndefined();
});
