import { expect, it, vi } from "vitest";

import { createResearchPlan, ResearchPlanError } from "./research-plan";

it("creates at most three sanitized public research queries with the fast profile", async () => {
  const generate = vi.fn(async () => ({
    text: JSON.stringify({
      queries: [
        "跨境电商 市场规模",
        "boss@example.com 13800138000 竞争格局",
        "物流成本",
        "平台政策",
        "支付合规",
      ],
    }),
    researchAvailable: false as const,
  }));

  const plan = await createResearchPlan(
    { generate },
    {
      projectDescription: "海外电商项目",
      messages: [{ id: "m1", role: "user", content: "已有订单", round: 0 }],
    },
  );

  expect(plan.queries).toHaveLength(3);
  expect(plan.queries[1]).toBe("竞争格局");
  expect(JSON.stringify(plan)).not.toMatch(/boss@example\.com|13800138000/u);
  expect(generate).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      profile: "fast_json",
      operation: "research_plan",
    }),
  );
});

it("repairs one malformed plan and rejects a plan with no public query", async () => {
  const generate = vi
    .fn()
    .mockResolvedValueOnce({ text: "not-json", researchAvailable: false })
    .mockResolvedValueOnce({
      text: JSON.stringify({ queries: ["sk-secret123456789"] }),
      researchAvailable: false,
    });

  await expect(
    createResearchPlan(
      { generate },
      { projectDescription: "test", messages: [] },
    ),
  ).rejects.toBeInstanceOf(ResearchPlanError);
  expect(generate).toHaveBeenCalledTimes(2);
});
