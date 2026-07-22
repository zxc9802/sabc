import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { StageRail } from "./stage-rail";

it("shows the four workflow stages around the active research stage", () => {
  render(<StageRail active="research" />);

  expect(screen.getByText("信息访谈")).toHaveAttribute("data-state", "complete");
  expect(screen.getByText("联网调研")).toHaveAttribute("aria-current", "step");
  expect(screen.getByText("评估讨论")).toHaveAttribute("data-state", "pending");
  expect(screen.getByText("最终报告")).toHaveAttribute("data-state", "pending");
});
