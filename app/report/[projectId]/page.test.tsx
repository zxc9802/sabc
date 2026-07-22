import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/components/report/report-screen", () => ({
  ReportScreen: ({ projectId }: { projectId: string }) => (
    <div data-testid="report-screen" data-project-id={projectId} />
  ),
}));

import ReportPage from "./page";

it("renders the dedicated report screen for the dynamic project id", async () => {
  const output = await ReportPage({
    params: Promise.resolve({ projectId: "project-1" }),
  } as PageProps<"/report/[projectId]">);
  render(output);

  expect(screen.getByTestId("report-screen")).toHaveAttribute(
    "data-project-id",
    "project-1",
  );
});
