import type { InterviewDepth } from "@/lib/domain/types";
import type { ResearchSnapshotRecord } from "@/lib/research/research-types";

import type {
  AssessmentRecord,
  FinalAssessmentRecord,
  FinalReportRecord,
  MessageRecord,
  ProjectRecord,
  ProjectWorkspaceRecord,
} from "./db";

export interface ProjectRepository {
  createProject(description: string): Promise<ProjectRecord>;
  updateInterviewDepth(projectId: string, depth: InterviewDepth): Promise<ProjectRecord>;
  appendMessage(message: MessageRecord): Promise<void>;
  saveResearchSnapshot(input: ResearchSnapshotRecord): Promise<void>;
  saveAssessment(input: AssessmentRecord): Promise<void>;
  saveFinalReport(input: FinalReportRecord): Promise<void>;
  saveFinalization(assessment: AssessmentRecord, report: FinalReportRecord): Promise<void>;
  getProjectWorkspace(projectId: string): Promise<ProjectWorkspaceRecord | null>;
  listProjects(): Promise<ProjectRecord[]>;
  listFinalAssessments(projectIds: string[]): Promise<FinalAssessmentRecord[]>;
  deleteProject(projectId: string): Promise<void>;
}

export function createProjectRepository(): ProjectRepository {
  return {
    async createProject(description) {
      const { project } = await requestJson<{ project: ProjectRecord }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ description }),
      });
      return project;
    },

    async updateInterviewDepth(projectId, depth) {
      const { project } = await requestJson<{ project: ProjectRecord }>(
        `/api/projects/${encodeURIComponent(projectId)}`,
        { method: "PATCH", body: JSON.stringify({ depth }) },
      );
      return project;
    },

    async appendMessage(message) {
      await requestJson(`/api/projects/${encodeURIComponent(message.projectId)}/messages`, {
        method: "POST",
        body: JSON.stringify(message),
      });
    },

    async saveResearchSnapshot(input) {
      await requestJson(`/api/projects/${encodeURIComponent(input.projectId)}/research-snapshot`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async saveAssessment(input) {
      await requestJson(`/api/projects/${encodeURIComponent(input.projectId)}/assessments`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async saveFinalReport(input) {
      await requestJson(`/api/projects/${encodeURIComponent(input.projectId)}/reports`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async saveFinalization(assessment, report) {
      await requestJson(`/api/projects/${encodeURIComponent(assessment.projectId)}/finalization`, {
        method: "POST",
        body: JSON.stringify({ assessment, report }),
      });
    },

    async getProjectWorkspace(projectId) {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({})) as {
        workspace?: ProjectWorkspaceRecord;
        error?: string;
      };
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(payload.error || "云端记录读取失败，请重试。");
      return payload.workspace ?? null;
    },

    async listProjects() {
      const { projects } = await requestJson<{ projects: ProjectRecord[] }>("/api/projects");
      return projects;
    },

    async listFinalAssessments(projectIds) {
      const { records } = await requestJson<{ records: FinalAssessmentRecord[] }>(
        "/api/projects/final-assessments",
        { method: "POST", body: JSON.stringify({ projectIds }) },
      );
      return records;
    },

    async deleteProject(projectId) {
      await requestJson(`/api/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
    },
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || "云端记录保存失败，请重试。");
  return payload;
}
