import { expect, it } from "vitest";

import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";

import {
  encodeFinalReportStreamEvent,
  readFinalReportStream,
  type FinalReportStreamEvent,
} from "./final-report-stream";

it("reads the final-report analysis stream in order", async () => {
  const result = { projectId: "project-1" } as AnalyzeProjectResponse;
  const frames = [
    encodeFinalReportStreamEvent({ type: "status", stage: "analyzing" }),
    encodeFinalReportStreamEvent({ type: "status", stage: "scoring" }),
    encodeFinalReportStreamEvent({ type: "assessment", result }),
    encodeFinalReportStreamEvent({ type: "complete" }),
  ].join("");
  const events: FinalReportStreamEvent[] = [];

  await readFinalReportStream(new Response(frames), (event) => events.push(event));

  expect(events).toHaveLength(4);
  expect(events.map(({ type }) => type)).toEqual([
    "status",
    "status",
    "assessment",
    "complete",
  ]);
});
