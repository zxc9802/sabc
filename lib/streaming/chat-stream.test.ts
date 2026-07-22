import { expect, it, vi } from "vitest";

import {
  encodeChatStreamEvent,
  readChatStream,
  type ChatStreamEvent,
} from "./chat-stream";

it("reads split UTF-8 SSE frames in order", async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(
    [
      encodeChatStreamEvent({
        type: "assistant_delta",
        messageId: "m1",
        delta: "已有订单",
      }),
      encodeChatStreamEvent({
        type: "complete",
        messageId: "m1",
        content: "已有订单来自哪里？",
      }),
    ].join(""),
  );
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 19));
        controller.enqueue(bytes.slice(19, bytes.length - 1));
        controller.enqueue(bytes.slice(bytes.length - 1));
        controller.close();
      },
    }),
  );
  const events: ChatStreamEvent[] = [];

  await readChatStream(response, (event) => {
    events.push(event);
  });

  expect(events.map(({ type }) => type)).toEqual([
    "assistant_delta",
    "complete",
  ]);
  expect(events[0]).toMatchObject({ delta: "已有订单" });
});

it("rejects unknown or incomplete stream frames", async () => {
  await expect(
    readChatStream(new Response('data: {"type":"assessment"}\n\n'), vi.fn()),
  ).rejects.toMatchObject({ code: "invalid_stream_event" });
  await expect(
    readChatStream(new Response('data: {"type":"complete"}'), vi.fn()),
  ).rejects.toMatchObject({ code: "incomplete_stream_frame" });
});
