import { expect, it } from "vitest";

import type { ProjectRecord } from "@/lib/storage/db";

import { projectDestination } from "./project-destination";

const project: ProjectRecord = {
  id: "project-1",
  name: "测试项目",
  description: "测试项目",
  primaryCategory: null,
  status: "draft",
  interviewDepth: "medium",
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
};

it("routes each persisted workflow status to its real screen", () => {
  expect(projectDestination({ ...project, status: "draft" })).toBe(
    "/?projectId=project-1",
  );
  expect(projectDestination({ ...project, status: "provisional" })).toBe(
    "/advisor/project-1",
  );
  expect(projectDestination({ ...project, status: "final" })).toBe(
    "/report/project-1",
  );
});
