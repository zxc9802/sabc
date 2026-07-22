import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { ResearchProgress } from "./research-progress";

it("marks the real research stage without showing fake percentages", () => {
  render(
    <ResearchProgress
      phase="researching"
      queries={["新加坡口红 市场规模"]}
      sourceCount={4}
      error={null}
      onRetry={vi.fn()}
      onInterviewOnly={vi.fn()}
    />,
  );

  expect(screen.getByRole("heading", { name: "正在调研你的项目" })).toBeVisible();
  expect(screen.getByText("联网收集市场证据")).toHaveAttribute(
    "aria-current",
    "step",
  );
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  expect(screen.getByText("新加坡口红 市场规模")).toBeVisible();
  expect(screen.getByText("已收集 4 个公开来源")).toBeVisible();
});

it("offers scoped choices when public research is unavailable", async () => {
  const user = userEvent.setup();
  const onRetry = vi.fn();
  const onInterviewOnly = vi.fn();
  render(
    <ResearchProgress
      phase="researching"
      queries={[]}
      sourceCount={0}
      error={{
        code: "research_unavailable",
        message: "外部调研暂时不可用。",
        retryable: true,
      }}
      onRetry={onRetry}
      onInterviewOnly={onInterviewOnly}
    />,
  );

  await user.click(screen.getByRole("button", { name: "重新调研" }));
  await user.click(screen.getByRole("button", { name: "仅依据访谈继续" }));
  expect(onRetry).toHaveBeenCalledOnce();
  expect(onInterviewOnly).toHaveBeenCalledOnce();
});
