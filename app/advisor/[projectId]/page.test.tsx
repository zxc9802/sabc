import { expect, it } from "vitest";

import AdvisorPage from "./page";

it("passes the awaited project id to the advisor screen", async () => {
  const element = await AdvisorPage({
    params: Promise.resolve({ projectId: "project-1" }),
  } as PageProps<"/advisor/[projectId]">);

  expect(element.props.projectId).toBe("project-1");
});
