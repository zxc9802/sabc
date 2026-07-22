import { expect, it } from "vitest";

import {
  buildInterviewData,
  buildInterviewSystemPrompt,
} from "./interview-prompt";

it("builds a medium-depth interview prompt without live rating instructions", () => {
  const prompt = buildInterviewSystemPrompt("medium");

  expect(prompt).toContain("中等深度");
  expect(prompt).toContain("每次只提出一个问题");
  expect(prompt).toContain(
    "核心信息已经比较完整，建议结束访谈并开始调研；你也可以继续补充。",
  );
  expect(prompt).not.toMatch(/评分差异|总分|S\/A\/B\/C|右侧评级/u);
});

it("changes evidence depth without changing the one-question rule", () => {
  const low = buildInterviewSystemPrompt("low");
  const high = buildInterviewSystemPrompt("high");

  expect(low).toContain("低深度");
  expect(low).toContain("每次只提出一个问题");
  expect(high).toContain("高深度");
  expect(high).toContain("数据来源、时间、金额、样本和矛盾点");
  expect(high).toContain("每次只提出一个问题");
});

it("serializes project context and the complete conversation as untrusted data", () => {
  const data = JSON.parse(
    buildInterviewData({
      projectDescription: "海外电商项目",
      messages: [
        { id: "m1", role: "user", content: "已有订单", round: 0 },
        { id: "m2", role: "assistant", content: "订单来自哪里？", round: 0 },
      ],
    }),
  );

  expect(data).toEqual({
    projectDescription: "海外电商项目",
    conversation: [
      { id: "m1", role: "user", content: "已有订单", round: 0 },
      { id: "m2", role: "assistant", content: "订单来自哪里？", round: 0 },
    ],
  });
});
