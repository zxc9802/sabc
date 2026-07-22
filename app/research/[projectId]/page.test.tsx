import { expect, it } from "vitest";

import ResearchPage from "./page";

it("passes the awaited dynamic project id to the research handoff", async () => {
  const element = await ResearchPage({
    params: Promise.resolve({ projectId: "project-1" }),
  } as PageProps<"/research/[projectId]">);

  expect(element.props.projectId).toBe("project-1");
});
