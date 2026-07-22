import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import HomePage from "./page";

it("introduces the first-stage interview agent", async () => {
  render(
    await HomePage({
      searchParams: Promise.resolve({}),
    } as PageProps<"/">),
  );

  expect(
    screen.getByRole("heading", { name: "SABC 项目优先级评估" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/访谈期间不评分，结束后才联网调研并生成报告/),
  ).toBeInTheDocument();
  expect(screen.getByText("阶段 1 · 信息收集智能体")).toBeVisible();
});
