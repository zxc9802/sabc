import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ChatStreamEvent } from "@/lib/streaming/chat-stream";
import { readChatStream } from "@/lib/streaming/chat-stream";

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/advisor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context() {
  return {
    projectId: "project-1",
    projectName: "跨境口红项目",
    projectDescription: "在新加坡销售口红",
    categoryReason: "海外电商项目",
    grade: "A",
    totalScore: 78,
    confidence: 80,
    researchStatus: "completed",
    dimensions: [
      {
        key: "strategic_value",
        appliedScore: 4,
        facts: ["目标市场清楚"],
        deductions: [],
      },
    ],
    sources: [
      { title: "市场调研报告", url: "https://example.com/market" },
    ],
  };
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return { mode: "opening", context: context(), messages: [], ...overrides };
}

function providerStream(lines: string[]): Response {
  return new Response(lines.join(""));
}

beforeEach(() => {
  process.env.DEEPSEEK_API_ENDPOINT = "https://provider.example/chat/completions";
  process.env.DEEPSEEK_MODEL = "gpt-5.6-luna";
  process.env.DEEPSEEK_API_KEY = "advisor-route-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEEPSEEK_API_ENDPOINT;
  delete process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPSEEK_API_KEY;
});

it("streams a fixed saved-grade prefix before opening advice", async () => {
  const fetchImpl = vi.fn(async () =>
    providerStream([
      'data: {"choices":[{"delta":{"content":"建议先验证复购。"}}]}\n\n',
      "data: [DONE]\n\n",
    ]),
  );
  vi.stubGlobal("fetch", fetchImpl);

  const response = await POST(request(validRequest()));
  const events: ChatStreamEvent[] = [];
  await readChatStream(response, (event) => events.push(event));

  expect(events).toEqual([
    expect.objectContaining({
      type: "assistant_delta",
      delta: "根据调研，目前建议将这个项目评为 A 级。\n\n",
    }),
    expect.objectContaining({
      type: "assistant_delta",
      delta: "建议先验证复购。",
    }),
    expect.objectContaining({
      type: "complete",
      content:
        "根据调研，目前建议将这个项目评为 A 级。\n\n建议先验证复购。",
    }),
  ]);
  const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  expect(body.messages[0].content).toContain("只提出一个最关键的问题");
});

it("streams follow-up advice without repeating the opening prefix", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      providerStream([
        'data: {"choices":[{"delta":{"content":"因为当前还没有复购证据。"}}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    ),
  );
  const response = await POST(
    request(
      validRequest({
        mode: "reply",
        messages: [
          { id: "user-1", role: "user", content: "为什么不是 S 级？" },
        ],
      }),
    ),
  );
  const events: ChatStreamEvent[] = [];
  await readChatStream(response, (event) => events.push(event));

  expect(events[0]).toMatchObject({
    type: "assistant_delta",
    delta: "因为当前还没有复购证据。",
  });
  expect(JSON.stringify(events)).not.toContain("根据调研，目前建议");
});

it("rejects strict invalid input and missing configuration", async () => {
  expect(
    (await POST(request(validRequest({ unknown: true })))).status,
  ).toBe(400);
  expect(
    (
      await POST(
        request(validRequest({ mode: "reply", messages: [] })),
      )
    ).status,
  ).toBe(400);
  delete process.env.DEEPSEEK_API_KEY;
  expect((await POST(request(validRequest()))).status).toBe(503);
});

it("returns a safe stream error without exposing provider data", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("sensitive upstream body", { status: 401 })),
  );
  const response = await POST(
    request(
      validRequest({
        mode: "reply",
        messages: [{ id: "user-1", role: "user", content: "敏感问题" }],
      }),
    ),
  );
  const events: ChatStreamEvent[] = [];
  await readChatStream(response, (event) => events.push(event));
  const serialized = JSON.stringify(events);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "error",
    code: "provider_rejected",
    retryable: false,
  });
  expect(serialized).not.toContain("sensitive upstream body");
  expect(serialized).not.toContain("advisor-route-key");
  expect(serialized).not.toContain("敏感问题");
});
