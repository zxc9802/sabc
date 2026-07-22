import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { readChatStream, type ChatStreamEvent } from "@/lib/streaming/chat-stream";

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
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
      { id: "m1", role: "user", content: "已有实际订单", round: 0 },
    ],
    interviewDepth: "medium",
    round: 0,
    ...overrides,
  };
}

function providerStream(lines: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    }),
  );
}

beforeEach(() => {
  process.env.DEEPSEEK_API_ENDPOINT = "https://provider.example/chat/completions";
  process.env.DEEPSEEK_MODEL = "gpt-5.6-luna";
  process.env.DEEPSEEK_API_KEY = "route-test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEEPSEEK_API_ENDPOINT;
  delete process.env.DEEPSEEK_MODEL;
  delete process.env.DEEPSEEK_API_KEY;
});

it("returns JSON errors before streaming for invalid input or missing config", async () => {
  expect((await POST(request({ projectId: "p1" }))).status).toBe(400);
  delete process.env.DEEPSEEK_API_KEY;
  expect((await POST(request(validRequest()))).status).toBe(503);
});

it("streams one provider chat call without an assessment event", async () => {
  const fetchImpl = vi.fn(async () =>
    providerStream([
      'data: {"choices":[{"delta":{"content":"这条订单信息有价值。"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"订单来自哪些国家？"}}]}\n\n',
      "data: [DONE]\n\n",
    ]),
  );
  vi.stubGlobal("fetch", fetchImpl);

  const response = await POST(request(validRequest({ round: 4 })));
  const events: ChatStreamEvent[] = [];
  await readChatStream(response, (event) => {
    events.push(event);
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  expect(fetchImpl).toHaveBeenCalledOnce();
  expect(events.map(({ type }) => type)).toEqual([
    "assistant_delta",
    "assistant_delta",
    "complete",
  ]);
  expect(JSON.stringify(events)).not.toContain("assessment");
  const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  expect(body.stream).toBe(true);
  expect(body.messages[0].content).toContain("每次只提出一个问题");
  expect(body.messages[1].content).toContain("已有实际订单");
});

it("returns a safe in-stream error when the provider rejects the chat", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("sensitive upstream body", { status: 401 })),
  );

  const response = await POST(request(validRequest()));
  const events: ChatStreamEvent[] = [];
  await readChatStream(response, (event) => {
    events.push(event);
  });
  const serialized = JSON.stringify(events);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "error",
    code: "provider_rejected",
    retryable: false,
  });
  expect(serialized).not.toContain("route-test-key");
  expect(serialized).not.toContain("已有实际订单");
  expect(serialized).not.toContain("sensitive upstream body");
});
