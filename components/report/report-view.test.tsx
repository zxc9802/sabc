import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { ReportView } from "./report-view";
import { reportFixture } from "./report-test-fixture";

it("renders the saved final report and can return to the advisor chat", async () => {
  const user = userEvent.setup();
  const print = vi.fn();
  vi.stubGlobal("print", print);
  const { project, report } = reportFixture();

  render(<ReportView project={project} report={report} />);

  expect(screen.getByLabelText("报告等级")).toHaveTextContent("A");
  expect(screen.getByText("78 分")).toBeVisible();
  expect(screen.getByText("证据置信度 80%")).toBeVisible();
  expect(screen.getAllByTestId("report-dimension")).toHaveLength(7);
  expect(screen.getByRole("link", { name: "市场调研报告" })).toHaveAttribute(
    "href",
    "https://example.com/market-report",
  );
  expect(
    screen.getByRole("link", { name: "返回第二智能体继续讨论" }),
  ).toHaveAttribute("href", "/advisor/project-1");

  await user.click(screen.getByRole("button", { name: "导出 PDF" }));
  expect(print).toHaveBeenCalledOnce();
});
