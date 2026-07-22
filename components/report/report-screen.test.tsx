import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { ProjectRepository } from "@/lib/storage/project-repository";

import { ReportScreen } from "./report-screen";
import { reportFixture } from "./report-test-fixture";

function repository(withReport = true): ProjectRepository {
  const { project, report } = reportFixture();
  return {
    createProject: vi.fn(),
    updateInterviewDepth: vi.fn(),
    appendMessage: vi.fn(),
    saveResearchSnapshot: vi.fn(),
    saveAssessment: vi.fn(),
    saveFinalReport: vi.fn(),
    saveFinalization: vi.fn(),
    getProjectWorkspace: vi.fn(async () => ({
      project,
      messages: [],
      assessments: [report.assessmentSnapshot],
      researchSnapshot: null,
      report: withReport ? report : null,
    })),
    listProjects: vi.fn(async () => [project]),
    listFinalAssessments: vi.fn(async () => []),
    deleteProject: vi.fn(),
  };
}

it("loads the report and marks the final workflow stage", async () => {
  render(<ReportScreen projectId="project-1" repository={repository()} />);

  expect(await screen.findByLabelText("报告等级")).toHaveTextContent("A");
  expect(
    screen.getAllByText("最终报告").find((node) =>
      node.hasAttribute("aria-current"),
    ),
  ).toHaveAttribute("aria-current", "step");
});

it("offers a return to discussion when no report has been generated", async () => {
  render(
    <ReportScreen projectId="project-1" repository={repository(false)} />,
  );

  expect(await screen.findByText("尚未生成最终报告")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "返回第二智能体" }),
  ).toHaveAttribute("href", "/advisor/project-1");
});
