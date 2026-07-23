import { afterEach, expect, it, vi } from "vitest";

import { createProjectRepository } from "./project-repository";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("creates a project through the same-origin cloud API without an owner field", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, {
    project: {
      id: "p1",
      name: "新项目",
      description: "新项目",
      primaryCategory: null,
      status: "draft",
      interviewDepth: "medium",
      createdAt: "2026-07-23T00:00:00.000Z",
      updatedAt: "2026-07-23T00:00:00.000Z",
    },
  }));
  vi.stubGlobal("fetch", fetchMock);

  const project = await createProjectRepository().createProject("新项目");

  expect(project.id).toBe("p1");
  expect(fetchMock).toHaveBeenCalledWith("/api/projects", expect.objectContaining({
    method: "POST",
    credentials: "same-origin",
  }));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("ownerId");
});

it("maps an owner-hidden project to a missing workspace", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { error: "项目不存在。" })));

  await expect(createProjectRepository().getProjectWorkspace("other-owner-project")).resolves.toBeNull();
});

it("surfaces the server error for a failed cloud mutation", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Main-site session is invalid." })));

  await expect(createProjectRepository().deleteProject("p1"))
    .rejects.toThrow("Main-site session is invalid.");
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
