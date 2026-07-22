import { expect, it, vi } from "vitest";

import {
  encodeFinalizeStreamEvent,
  readFinalizeStream,
  type FinalizeStreamEvent,
} from "./finalize-stream";

it("reads staged finalization events across split UTF-8 frames", async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(
    [
      encodeFinalizeStreamEvent({
        type: "status",
        stage: "planning_research",
      }),
      encodeFinalizeStreamEvent({
        type: "research_plan",
        queries: ["跨境电商 市场规模"],
      }),
      encodeFinalizeStreamEvent({ type: "complete" }),
    ].join(""),
  );
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 23));
        controller.enqueue(bytes.slice(23));
        controller.close();
      },
    }),
  );
  const events: FinalizeStreamEvent[] = [];

  await readFinalizeStream(response, (event) => {
    events.push(event);
  });

  expect(events.map(({ type }) => type)).toEqual([
    "status",
    "research_plan",
    "complete",
  ]);
});

it("rejects unknown finalization events", async () => {
  await expect(
    readFinalizeStream(new Response('data: {"type":"unknown"}\n\n'), vi.fn()),
  ).rejects.toMatchObject({ code: "invalid_stream_event" });
});
