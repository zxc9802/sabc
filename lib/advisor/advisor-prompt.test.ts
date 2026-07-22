import { expect, it } from "vitest";

import type { AdvisorContext } from "./advisor-context";
import {
  buildAdvisorData,
  buildAdvisorSystemPrompt,
  createAdvisorOpeningPrefix,
} from "./advisor-prompt";

it("keeps the saved grade immutable in advisor prompts", () => {
  const context = {
    projectId: "project-1",
    projectName: "跨境口红项目",
    projectDescription: "在新加坡销售口红",
    categoryReason: "面向海外消费者的电商项目",
    grade: "A",
    totalScore: 78,
    confidence: 80,
    researchStatus: "completed",
    dimensions: [],
    sources: [],
  } satisfies AdvisorContext;

  expect(buildAdvisorSystemPrompt("opening")).toContain("只提出一个最关键的问题");
  expect(buildAdvisorSystemPrompt("reply")).toContain("可以调整建议等级");
  expect(buildAdvisorSystemPrompt("reply")).toContain(
    "信息充分时可以建议用户生成最终报告，但不得代替用户触发",
  );
  expect(buildAdvisorSystemPrompt("reply")).not.toContain("不得重新计算或修改等级");
  expect(buildAdvisorData({ mode: "opening", context, messages: [] })).toContain(
    '"grade":"A"',
  );
  expect(createAdvisorOpeningPrefix("S")).toBe(
    "根据调研，目前建议将这个项目评为 S 级。\n\n",
  );
});
