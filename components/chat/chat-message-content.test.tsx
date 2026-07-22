import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { ChatMessageContent } from "./chat-message-content";

it("renders markdown headings without exposing hash markers", () => {
  render(
    <ChatMessageContent content={"### Why it remains C\nContinue testing."} />,
  );

  const heading = screen.getByRole("heading", {
    name: "Why it remains C",
    level: 3,
  });
  expect(heading).toBeVisible();
  expect(heading).not.toHaveTextContent("###");
  expect(screen.getByText("Continue testing.")).toBeVisible();
});

it("renders simple markdown lists without exposing dash markers", () => {
  render(
    <ChatMessageContent content={"Missing evidence:\n- signed quote\n- delivery proof"} />,
  );

  expect(screen.getByText("Missing evidence:")).toBeVisible();
  expect(screen.getByRole("list")).toBeVisible();
  expect(screen.getByText("signed quote").closest("li")).toBeVisible();
  expect(screen.getByText("delivery proof").closest("li")).toBeVisible();
});
