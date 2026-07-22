import { expect, test, type Page, type Request } from "@playwright/test";

import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";
import type { DimensionKey } from "@/lib/domain/types";
import {
  encodeChatStreamEvent,
  type ChatStreamEvent,
} from "@/lib/streaming/chat-stream";
import {
  encodeFinalizeStreamEvent,
  type FinalizeStreamEvent,
} from "@/lib/streaming/finalize-stream";
import {
  encodeFinalReportStreamEvent,
  type FinalReportStreamEvent,
} from "@/lib/report/final-report-stream";

const dimensions: DimensionKey[] = [
  "strategic_value",
  "demand_evidence",
  "return_potential",
  "execution_feasibility",
  "resource_fit",
  "timing_differentiation",
  "risk_control",
];

test("interview, visible research, advisor chat, explicit report, overwrite, and compare", async ({
  page,
}) => {
  const browserRequests: string[] = [];
  page.on("request", (request) => recordRequest(request, browserRequests));
  await stubChatApi(page);
  await stubFinalizeApi(page);
  await stubAdvisorApi(page);
  await stubReportApi(page);

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "SABC 项目优先级评估" }),
  ).toBeVisible();
  await page.locator("html[data-sabc-ready='true']").waitFor();

  await page
    .getByLabel("项目描述")
    .fill("付费试点项目：已有 3 家客户试用，计划 6 周内交付。");
  await page.getByRole("button", { name: "开始访谈" }).click();

  await expect(
    page.getByText("已有多少客户愿意为试点付费？"),
  ).toBeVisible();
  await expect(page.getByLabel("问答深度")).toHaveValue("medium");
  await expect(page.getByText("临时评级")).toHaveCount(0);
  await expect(page.getByText(/\/ 100/)).toHaveCount(0);

  await page
    .getByLabel("继续补充或回答")
    .fill("3 家客户已签署付费试点确认");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(
    page.getByText(/核心信息已经比较完整，建议结束访谈并开始调研/),
  ).toBeVisible();
  await expect(page.getByLabel("继续补充或回答")).toBeEnabled();

  await page
    .getByRole("button", { name: "结束信息收集并开始调研" })
    .click();
  await page.waitForURL(/\/research\//);
  await expect(
    page.getByText(/AnySearch 联网搜索/),
  ).toBeVisible();
  await expect(page.getByText("已收集 1 个公开来源")).toBeVisible();
  await page.waitForURL(/\/advisor\//);
  await expect(
    page.getByText(/^根据调研，目前建议将这个项目评为 A 级。/),
  ).toBeVisible();
  expect(browserRequests.filter((url) => url.includes("/api/report"))).toHaveLength(0);

  await page
    .getByLabel("继续和建议智能体讨论")
    .fill("为什么不是 S 级？");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(
    page.getByText("当前证据仍缺少稳定复购数据。"),
  ).toBeVisible();

  await page.getByRole("button", { name: "生成最终报告" }).click();
  await page.waitForURL(/\/report\//);
  await expect(page.getByLabel("报告等级")).toHaveText("A");
  await expect(page.getByText("78 分", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "市场调研报告", exact: true }),
  ).toHaveAttribute("href", "https://example.com/market-report");
  expect(browserRequests.filter((url) => url.includes("/api/report"))).toHaveLength(1);

  await page.getByRole("link", { name: "返回第二智能体继续讨论" }).click();
  await page.waitForURL(/\/advisor\//);
  await expect(
    page.getByText(/^根据调研，目前建议将这个项目评为 A 级。/),
  ).toBeVisible();
  await page.getByRole("button", { name: "生成最终报告" }).click();
  await page.waitForURL(/\/report\//);
  expect(browserRequests.filter((url) => url.includes("/api/report"))).toHaveLength(2);
  await page.getByRole("link", { name: "返回第二智能体继续讨论" }).click();

  await page.getByRole("button", { name: "新建案卷" }).click();

  await page
    .getByLabel("项目描述")
    .fill("库存周转项目：测试一个低毛利新品，首批库存风险较高。");
  await page.getByRole("button", { name: "开始访谈" }).click();
  await expect(page.getByText("请补充首批库存预算。"),).toBeVisible();
  await page
    .getByRole("button", { name: "结束信息收集并开始调研" })
    .click();
  await page.waitForURL(/\/advisor\//);
  await expect(
    page.getByText(/^根据调研，目前建议将这个项目评为 B 级。/),
  ).toBeVisible();
  await page.getByRole("button", { name: "生成最终报告" }).click();
  await page.waitForURL(/\/report\//);
  await expect(page.getByLabel("报告等级")).toHaveText("B");
  await page.getByRole("link", { name: "返回第二智能体继续讨论" }).click();
  await page.getByRole("button", { name: "新建案卷" }).click();

  const compareButton = page.getByRole("button", { name: "对比项目" });
  await expect(compareButton).toBeEnabled();
  await compareButton.click();
  await expect(page.getByRole("table", { name: "项目评级对比" })).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "付费试点项目" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "库存周转项目" }),
  ).toBeVisible();

  const requestLog = browserRequests.join("\n");
  expect(requestLog).toContain("POST http://localhost:3107/api/chat");
  expect(requestLog).toContain("POST http://localhost:3107/api/finalize");
  expect(requestLog).toContain("POST http://localhost:3107/api/advisor");
  expect(requestLog).toContain("POST http://localhost:3107/api/report");
  expect(browserRequests.filter((value) => value.includes("/api/finalize"))).toHaveLength(2);
  expect(browserRequests.filter((value) => value.includes("/api/advisor"))).toHaveLength(3);
  expect(browserRequests.filter((value) => value.includes("/api/report"))).toHaveLength(3);
  expect(requestLog).not.toContain("/api/analyze");
  expect(requestLog).not.toMatch(/(?:sk|as_sk)_[a-z0-9]{12,}|sk-[a-z0-9]{12,}/i);
});

async function stubChatApi(page: Page): Promise<void> {
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      projectId: string;
      projectDescription: string;
      round: number;
    };
    const inventory = body.projectDescription.includes("库存周转项目");
    const content = inventory
      ? "请补充首批库存预算。"
      : body.round === 0
        ? "我已记录试点信息。已有多少客户愿意为试点付费？"
        : "已记录三家付费确认。核心信息已经比较完整，建议结束访谈并开始调研；你也可以继续补充。";
    const midpoint = Math.ceil(content.length / 2);
    const messageId = `assistant-${body.projectId}-${body.round}`;
    const events: ChatStreamEvent[] = [
      {
        type: "assistant_delta",
        messageId,
        delta: content.slice(0, midpoint),
      },
      {
        type: "assistant_delta",
        messageId,
        delta: content.slice(midpoint),
      },
      { type: "complete", messageId, content },
    ];
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      body: events.map(encodeChatStreamEvent).join(""),
    });
  });
}

async function stubFinalizeApi(page: Page): Promise<void> {
  await page.route("**/api/finalize", async (route) => {
    const body = route.request().postDataJSON() as {
      projectId: string;
      projectDescription: string;
      messages: Array<{ content: string }>;
    };
    const inventory = body.projectDescription.includes("库存周转项目");
    const result = finalResponse({
      projectId: body.projectId,
      projectName: inventory ? "库存周转项目" : "付费试点项目",
      category: inventory ? "ecommerce" : "software",
      score: inventory ? 55 : 78,
      grade: inventory ? "B" : "A",
    });
    const snapshot = {
      id: `research-${body.projectId}`,
      projectId: body.projectId,
      queries: [inventory ? "库存周转 风险" : "付费试点 软件需求"],
      sources: [
        {
          title: "市场调研报告",
          url: "https://example.com/market-report",
          snippet: "公开报告显示试点软件需求持续增长。",
          query: inventory ? "库存周转 风险" : "付费试点 软件需求",
        },
      ],
      status: "completed" as const,
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T00:00:00.000Z",
    };
    const events: FinalizeStreamEvent[] = [
      { type: "status", stage: "planning_research" },
      { type: "research_plan", queries: snapshot.queries },
      { type: "status", stage: "researching" },
      { type: "research_complete", snapshot },
      { type: "status", stage: "analyzing" },
      { type: "status", stage: "scoring" },
      { type: "assessment", result },
      { type: "complete" },
    ];
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      body: events.map(encodeFinalizeStreamEvent).join(""),
    });
  });
}

async function stubAdvisorApi(page: Page): Promise<void> {
  await page.route("**/api/advisor", async (route) => {
    const body = route.request().postDataJSON() as {
      mode: "opening" | "reply";
      context: { grade: "S" | "A" | "B" | "C" };
    };
    const content =
      body.mode === "opening"
        ? `根据调研，目前建议将这个项目评为 ${body.context.grade} 级。\n\n建议先用一个小规模、可回退的验证确认关键假设。`
        : "当前证据仍缺少稳定复购数据。";
    const midpoint = Math.ceil(content.length / 2);
    const messageId = `advisor-${body.mode}-${Date.now()}`;
    const events: ChatStreamEvent[] = [
      {
        type: "assistant_delta",
        messageId,
        delta: content.slice(0, midpoint),
      },
      {
        type: "assistant_delta",
        messageId,
        delta: content.slice(midpoint),
      },
      { type: "complete", messageId, content },
    ];
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      body: events.map(encodeChatStreamEvent).join(""),
    });
  });
}

async function stubReportApi(page: Page): Promise<void> {
  await page.route("**/api/report", async (route) => {
    const body = route.request().postDataJSON() as {
      projectId: string;
      projectDescription: string;
    };
    const inventory = body.projectDescription.includes("库存周转项目");
    const result = finalResponse({
      projectId: body.projectId,
      projectName: inventory ? "库存周转项目" : "付费试点项目",
      category: inventory ? "ecommerce" : "software",
      score: inventory ? 55 : 78,
      grade: inventory ? "B" : "A",
    });
    const events: FinalReportStreamEvent[] = [
      { type: "status", stage: "analyzing" },
      { type: "status", stage: "scoring" },
      { type: "assessment", result },
      { type: "complete" },
    ];
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      body: events.map(encodeFinalReportStreamEvent).join(""),
    });
  });
}

function finalResponse(input: {
  projectId: string;
  projectName: string;
  category: "software" | "ecommerce";
  score: number;
  grade: "A" | "B";
}): AnalyzeProjectResponse {
  const sourceEvidence = {
    slotId: "market-demand",
    statement: "公开报告显示试点软件需求持续增长",
    state: "verified" as const,
    origin: "external_source" as const,
    sourceTitle: "市场调研报告",
    sourceUrl: "https://example.com/market-report",
  };
  const userEvidence = {
    slotId: "paid-pilot",
    statement: "项目方称已有三家付费试点",
    state: "specific_unverified" as const,
    origin: "user_input" as const,
  };
  const analysisDimensions = dimensions.map((dimension) => ({
    dimension,
    proposedScore: (input.grade === "A" ? 4 : 3) as 3 | 4,
    facts: [`${dimension} 已获得一项事实`],
    deductions: [],
    evidence:
      dimension === "demand_evidence"
        ? [sourceEvidence, userEvidence]
        : [userEvidence],
  }));
  const scoredDimensions = Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      {
        proposedScore: input.grade === "A" ? 4 : 3,
        appliedScore: input.grade === "A" ? 4 : 3,
        weightedScore: input.score / 7,
        confidence: 80,
        facts: [`${dimension} 已获得一项事实`],
        deductions: [],
        evidence:
          dimension === "demand_evidence"
            ? [sourceEvidence, userEvidence]
            : [userEvidence],
      },
    ]),
  ) as unknown as AnalyzeProjectResponse["scored"]["dimensions"];

  return {
    projectId: input.projectId,
    projectName: input.projectName,
    primaryCategory: input.category,
    secondaryCategories: [],
    categoryReason: "已结合访谈与公开市场资料完成最终判断。",
    promptVersion: "e2e.final.v1",
    analysis: {
      projectName: input.projectName,
      primaryCategory: input.category,
      secondaryCategories: [],
      categoryReason: "已结合访谈与公开市场资料完成最终判断。",
      dimensions: analysisDimensions,
      vetoRisks: [],
      criticalUnknowns: [],
      questionCandidates: [],
      research: { needed: false, reason: "", queries: [] },
    },
    scored: {
      rubricVersion: "2026-07-22.v1",
      dimensions: scoredDimensions,
      totalScoreRaw: input.score,
      totalScore: input.score,
      confidence: 80,
      provisionalGrade: input.grade,
      eligibleFinalGrade: input.grade,
      status: "final",
      suspectedVetoes: [],
      confirmedVetoes: [],
      criticalUnknowns: [],
    },
    nextQuestion: null,
    diff: {
      gradeChange: null,
      scoreDelta: input.score,
      confidenceDelta: 80,
      changedDimensions: [],
      newEvidenceStatements: [],
      summary: "最终评级已完成。",
    },
    sources: [
      {
        title: "市场调研报告",
        url: "https://example.com/market-report",
      },
    ],
    researchStatus: "completed",
  };
}

function recordRequest(request: Request, sink: string[]): void {
  sink.push(`${request.method()} ${request.url()} ${request.postData() ?? ""}`);
}
