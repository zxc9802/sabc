import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import type { MessageRecord, ProjectRecord } from "@/lib/storage/db";
import type { ProjectRepository } from "@/lib/storage/project-repository";
import {
  encodeChatStreamEvent,
  type ChatStreamEvent,
} from "@/lib/streaming/chat-stream";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

import { ProjectWorkspace } from "./project-workspace";

const project: ProjectRecord = {
  id: "project-1",
  name: "团队排期工具",
  description: "为 20 人团队做一个可视化排期工具",
  primaryCategory: null,
  status: "draft",
  interviewDepth: "medium",
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
};

function repository(): ProjectRepository {
  return {
    createProject: vi.fn().mockResolvedValue(project),
    updateInterviewDepth: vi.fn(async (_projectId, depth) => ({
      ...project,
      interviewDepth: depth,
    })),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    saveResearchSnapshot: vi.fn().mockResolvedValue(undefined),
    saveAssessment: vi.fn().mockResolvedValue(undefined),
    saveFinalReport: vi.fn().mockResolvedValue(undefined),
    saveFinalization: vi.fn().mockResolvedValue(undefined),
    getProjectWorkspace: vi.fn().mockResolvedValue(null),
    listProjects: vi.fn().mockResolvedValue([]),
    listFinalAssessments: vi.fn().mockResolvedValue([]),
    deleteProject: vi.fn().mockResolvedValue(undefined),
  };
}

function chatResponse(content: string): Response {
  const events: ChatStreamEvent[] = [
    { type: "assistant_delta", messageId: "assistant-1", delta: content },
    { type: "complete", messageId: "assistant-1", content },
  ];
  return new Response(events.map(encodeChatStreamEvent).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function startInterview(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.type(screen.getByLabelText("项目描述"), project.description);
  await user.click(screen.getByRole("button", { name: "开始访谈" }));
}

it("uses a chat-first workspace without any live grade sidebar", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn().mockResolvedValue(chatResponse("先确认目标用户是谁？"));
  render(<ProjectWorkspace repository={repository()} fetcher={fetcher} />);

  expect(
    screen.queryByRole("button", { name: "结束信息收集并开始调研" }),
  ).not.toBeInTheDocument();
  await startInterview(user);

  expect(await screen.findByText("先确认目标用户是谁？")).toBeVisible();
  expect(screen.getByLabelText("访谈工作区")).toHaveClass(
    "workspace-conversation",
  );
  expect(screen.queryByText("临时评级")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("当前等级")).not.toBeInTheDocument();
  expect(screen.getByText("信息访谈")).toHaveAttribute("aria-current", "step");
  expect(
    screen.getByRole("button", { name: "结束信息收集并开始调研" }),
  ).toBeEnabled();
});

it("keeps the AI end suggestion as an ordinary chat message", async () => {
  const user = userEvent.setup();
  const suggestion =
    "核心信息已经比较完整，建议结束访谈并开始调研；你也可以继续补充。";
  const fetcher = vi.fn().mockResolvedValue(chatResponse(suggestion));
  render(<ProjectWorkspace repository={repository()} fetcher={fetcher} />);

  await startInterview(user);

  expect(await screen.findByText(suggestion)).toBeVisible();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe("/api/chat");
  expect(screen.getByLabelText("继续补充或回答")).toBeEnabled();
});

it("renders assistant emphasis without exposing markdown markers", async () => {
  const user = userEvent.setup();
  const fetcher = vi
    .fn()
    .mockResolvedValue(chatResponse("Confirm **compliance documents** first."));
  render(<ProjectWorkspace repository={repository()} fetcher={fetcher} />);

  await startInterview(user);

  const emphasized = await screen.findByText("compliance documents", {
    selector: "strong",
  });
  expect(emphasized).toBeVisible();
  expect(emphasized.closest("p")).toHaveTextContent(
    "Confirm compliance documents first.",
  );
  expect(emphasized.closest("p")).not.toHaveTextContent("**");
});

it("leaves the interview page before research and never finalizes inline", async () => {
  const user = userEvent.setup();
  navigation.push.mockReset();
  const fetcher = vi.fn().mockResolvedValue(chatResponse("目前有多少试用团队？"));
  render(<ProjectWorkspace repository={repository()} fetcher={fetcher} />);
  await startInterview(user);
  await screen.findByText("目前有多少试用团队？");

  await user.click(
    screen.getByRole("button", { name: "结束信息收集并开始调研" }),
  );
  expect(navigation.push).toHaveBeenCalledWith("/research/project-1");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText("报告生成进度")).not.toBeInTheDocument();
});

it("loads only interview messages on the first-agent page", async () => {
  const interview: MessageRecord = {
    id: "interview-1",
    projectId: project.id,
    role: "assistant",
    content: "第一智能体问题",
    round: 0,
    createdAt: project.createdAt,
    stage: "interview",
    kind: "chat",
  };
  const advisor: MessageRecord = {
    ...interview,
    id: "advisor-1",
    content: "根据目前的情况，我把这个项目评为 A 级。",
    stage: "advisory",
    kind: "advisor_summary",
  };
  const repo = repository();
  vi.mocked(repo.getProjectWorkspace).mockResolvedValue({
    project,
    messages: [interview, advisor],
    assessments: [],
    researchSnapshot: null,
    report: null,
  });
  render(
    <ProjectWorkspace
      repository={repo}
      fetcher={vi.fn()}
      initialProjectId={project.id}
    />,
  );

  await waitFor(() => expect(screen.getByText("第一智能体问题")).toBeVisible());
  expect(screen.queryByText(advisor.content)).not.toBeInTheDocument();
});

it("keeps the default interview depth at medium and persists changes", async () => {
  const user = userEvent.setup();
  const repo = repository();
  const fetcher = vi.fn().mockResolvedValue(chatResponse("请补充已有验证。"));
  render(<ProjectWorkspace repository={repo} fetcher={fetcher} />);
  await startInterview(user);
  await screen.findByText("请补充已有验证。");

  expect(screen.getByLabelText("问答深度")).toHaveValue("medium");
  await user.selectOptions(screen.getByLabelText("问答深度"), "high");
  expect(repo.updateInterviewDepth).toHaveBeenCalledWith(project.id, "high");
});
