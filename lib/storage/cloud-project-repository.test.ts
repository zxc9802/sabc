import { expect, it } from "vitest";

import { createCloudProjectRepository } from "./cloud-project-repository";
import type { AssessmentRecord, FinalReportRecord } from "./db";

function recordingPool() {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  return { ...client, calls, connect: async () => client };
}

it("scopes workspace queries to the verified owner", async () => {
  const pool = recordingPool();

  await createCloudProjectRepository(pool).getProjectWorkspace("user-a", "project-1");

  expect(pool.calls[0]).toMatchObject({
    text: expect.stringContaining("WHERE owner_id = $1 AND id = $2"),
    values: ["user-a", "project-1"],
  });
});

it("uses the owner when deleting a project", async () => {
  const pool = recordingPool();

  const deleted = await createCloudProjectRepository(pool).deleteProject("user-b", "project-a");

  expect(deleted).toBe(false);
  expect(pool.calls[0]).toMatchObject({
    text: expect.stringContaining("WHERE owner_id = $1 AND id = $2"),
    values: ["user-b", "project-a"],
  });
});

it("rolls back a failed finalization without leaving a partial assessment", async () => {
  const commands: string[] = [];
  const client = {
    query: async (text: string) => {
      commands.push(text.trim().split(" ")[0]);
      if (text.includes("SELECT id FROM sabc_projects")) {
        return { rows: [{ id: "project-1" }], rowCount: 1 };
      }
      if (text.includes("INSERT INTO sabc_assessments")) throw new Error("database write failed");
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  const pool = { ...client, connect: async () => client };
  const assessment = {
    id: "assessment-1",
    projectId: "project-1",
    analysis: { projectName: "项目", primaryCategory: "software", dimensions: [] },
  } as unknown as AssessmentRecord;
  const report = {
    id: "report-1",
    projectId: "project-1",
    assessmentId: "assessment-1",
    assessmentSnapshot: assessment,
  } as FinalReportRecord;

  await expect(createCloudProjectRepository(pool).saveFinalization("user-a", assessment, report))
    .rejects.toMatchObject({ code: "storage_failed" });

  expect(commands[0]).toBe("BEGIN");
  expect(commands.at(-1)).toBe("ROLLBACK");
});
