import { expect, it, vi } from "vitest";

import { encodeChatStreamEvent } from "@/lib/streaming/chat-stream";

import type { AdvisorContext } from "./advisor-context";
import {
  AdvisorRequestError,
  requestAdvisorMessage,
} from "./advisor-client";

const context: AdvisorContext = {
  projectId: "project-1",
  projectName: "跨境项目",
  projectDescription: "在新加坡销售口红",
  categoryReason: "海外电商",
  grade: "A",
  totalScore: 78,
  confidence: 80,
  researchStatus: "completed",
  dimensions: [],
  report: {
    decisionSummary: "建议验证需求。",
    opportunities: [],
    risks: [],
    confirmedFacts: [],
    assumptionsAndGaps: [],
    nextActions: [],
    upgradeConditions: [],
    conversationSummary: [],
  },
  sources: [],
};

function response(events: string[]): Response {
  return new Response(events.join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

it("returns a complete streamed advisor message and updates its draft", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    response([
      encodeChatStreamEvent({
        type: "assistant_delta",
        messageId: "advisor-summary-1",
        delta: "根据目前的情况，我把这个项目评为 A 级。\n\n",
      }),
      encodeChatStreamEvent({
        type: "assistant_delta",
        messageId: "advisor-summary-1",
        delta: "建议先验证复购。",
      }),
      encodeChatStreamEvent({
        type: "complete",
        messageId: "advisor-summary-1",
        content:
          "根据目前的情况，我把这个项目评为 A 级。\n\n建议先验证复购。",
      }),
    ]),
  );
  const onDelta = vi.fn();

  await expect(
    requestAdvisorMessage({
      fetcher,
      mode: "opening",
      context,
      messages: [],
      signal: new AbortController().signal,
      onDelta,
    }),
  ).resolves.toEqual({
    id: "advisor-summary-1",
    content:
      "根据目前的情况，我把这个项目评为 A 级。\n\n建议先验证复购。",
  });
  expect(onDelta).toHaveBeenLastCalledWith(
    "根据目前的情况，我把这个项目评为 A 级。\n\n建议先验证复购。",
  );
});

it("calls browser fetch without binding it to the request options object", async () => {
  const fetcher = vi.fn(function (this: unknown) {
    if (this !== undefined) {
      throw new TypeError("Illegal invocation");
    }
    return Promise.resolve(
      response([
        encodeChatStreamEvent({
          type: "complete",
          messageId: "advisor-summary-1",
          content: "建议先验证复购。",
        }),
      ]),
    );
  }) as unknown as typeof fetch;

  await expect(
    requestAdvisorMessage({
      fetcher,
      mode: "opening",
      context,
      messages: [],
      signal: new AbortController().signal,
      onDelta: vi.fn(),
    }),
  ).resolves.toEqual({
    id: "advisor-summary-1",
    content: "建议先验证复购。",
  });
});

it("rejects safe HTTP, stream, and incomplete response errors", async () => {
  const input = {
    fetcher: vi.fn(),
    mode: "opening" as const,
    context,
    messages: [],
    signal: new AbortController().signal,
    onDelta: vi.fn(),
  };
  input.fetcher.mockResolvedValueOnce(
    Response.json(
      { code: "missing_configuration", message: "配置缺失", retryable: false },
      { status: 503 },
    ),
  );
  await expect(requestAdvisorMessage(input)).rejects.toMatchObject({
    code: "missing_configuration",
    retryable: false,
  });

  input.fetcher.mockResolvedValueOnce(
    response([
      encodeChatStreamEvent({
        type: "error",
        code: "provider_timeout",
        message: "生成超时",
        retryable: true,
      }),
    ]),
  );
  await expect(requestAdvisorMessage(input)).rejects.toMatchObject({
    code: "provider_timeout",
    retryable: true,
  });

  input.fetcher.mockResolvedValueOnce(
    response([
      encodeChatStreamEvent({
        type: "assistant_delta",
        messageId: "partial-1",
        delta: "半截回复",
      }),
    ]),
  );
  await expect(requestAdvisorMessage(input)).rejects.toBeInstanceOf(
    AdvisorRequestError,
  );
});
