import { expect, it } from "vitest";

import type { MessageRecord } from "@/lib/storage/db";

import {
  isAdvisorSummary,
  isAdvisoryMessage,
  isInterviewMessage,
} from "./message-stage";

const legacy: MessageRecord = {
  id: "legacy-1",
  projectId: "project-1",
  role: "user",
  content: "旧版访谈消息",
  round: 0,
  createdAt: "2026-07-22T00:00:00.000Z",
};

const advisory: MessageRecord = {
  ...legacy,
  id: "advisor-1",
  role: "assistant",
  stage: "advisory",
  kind: "advisor_summary",
};

it("treats legacy messages as interview messages", () => {
  expect(isInterviewMessage(legacy)).toBe(true);
  expect(isAdvisoryMessage(legacy)).toBe(false);
});

it("classifies advisory summaries without leaking them into interviews", () => {
  expect(isInterviewMessage(advisory)).toBe(false);
  expect(isAdvisoryMessage(advisory)).toBe(true);
  expect(isAdvisorSummary(advisory)).toBe(true);
});
