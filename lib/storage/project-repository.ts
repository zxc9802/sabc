import type {
  AssessmentRecord,
  EvidenceRecord,
  FinalAssessmentRecord,
  MessageRecord,
  ProjectRecord,
  ProjectWorkspaceRecord,
  SaveAssessmentInput,
  SaveFinalReportInput,
} from "./db";
import type { InterviewDepth } from "@/lib/domain/types";
import type { ResearchSnapshotRecord } from "@/lib/research/research-types";
import { db, type SabcDatabase, StorageError } from "./db";

export interface ProjectRepository {
  createProject(description: string): Promise<ProjectRecord>;
  updateInterviewDepth(
    projectId: string,
    depth: InterviewDepth,
  ): Promise<ProjectRecord>;
  appendMessage(message: MessageRecord): Promise<void>;
  saveResearchSnapshot(input: ResearchSnapshotRecord): Promise<void>;
  saveAssessment(input: SaveAssessmentInput): Promise<void>;
  saveFinalReport(input: SaveFinalReportInput): Promise<void>;
  saveFinalization(
    assessment: SaveAssessmentInput,
    report: SaveFinalReportInput,
  ): Promise<void>;
  getProjectWorkspace(projectId: string): Promise<ProjectWorkspaceRecord | null>;
  listProjects(): Promise<ProjectRecord[]>;
  listFinalAssessments(projectIds: string[]): Promise<FinalAssessmentRecord[]>;
  deleteProject(projectId: string): Promise<void>;
}

export function createProjectRepository(
  database: SabcDatabase = db,
): ProjectRepository {
  const repository: ProjectRepository = {
    async createProject(description) {
      try {
        const now = new Date().toISOString();
        const project: ProjectRecord = {
          id: crypto.randomUUID(),
          name: extractProjectName(description),
          description,
          primaryCategory: null,
          status: "draft",
          interviewDepth: "medium",
          createdAt: now,
          updatedAt: now,
        };
        await database.projects.add(project);
        return project;
      } catch (error) {
        throw mapStorageError(error);
      }
    },

    async updateInterviewDepth(projectId, depth) {
      try {
        await requireProject(database, projectId);
        const updatedAt = new Date().toISOString();
        await database.projects.update(projectId, {
          interviewDepth: depth,
          updatedAt,
        });
        return {
          ...(await requireProject(database, projectId)),
          interviewDepth: depth,
          updatedAt,
        };
      } catch (error) {
        throw mapStorageError(error);
      }
    },

    async appendMessage(message) {
      try {
        await database.transaction(
          "rw",
          database.projects,
          database.messages,
          async () => {
            await requireProject(database, message.projectId);
            await database.messages.add(message);
            await database.projects.update(message.projectId, {
              updatedAt: new Date().toISOString(),
            });
          },
        );
      } catch (error) {
        throw mapStorageError(error);
      }
    },

    async saveResearchSnapshot(input) {
      try {
        await database.transaction(
          "rw",
          database.projects,
          database.researchSnapshots,
          async () => {
            await requireProject(database, input.projectId);
            await database.researchSnapshots.put(structuredClone(input));
            await database.projects.update(input.projectId, {
              updatedAt: input.updatedAt,
            });
          },
        );
      } catch (error) {
        throw mapStorageError(error);
      }
    },

    async saveAssessment(input) {
      try {
        await database.transaction(
          "rw",
          database.projects,
          database.assessments,
          database.evidence,
          async () => {
            await requireProject(database, input.projectId);
            await database.assessments.add(input);
            const evidence = extractEvidenceRecords(input);
            if (evidence.length > 0) await database.evidence.bulkAdd(evidence);
            await database.projects.update(input.projectId, {
              status: "provisional",
              name: input.analysis.projectName,
              primaryCategory: input.analysis.primaryCategory,
              updatedAt: new Date().toISOString(),
            });
          },
        );
      } catch (error) {
        throw mapStorageError(error);
      }
    },

    async saveFinalReport(input) {
      try {
        await database.transaction(
          "rw",
          database.projects,
          database.reports,
          async () => {
            await requireProject(database, input.projectId);
            if (
              input.assessmentSnapshot.id !== input.assessmentId ||
              input.assessmentSnapshot.projectId !== input.projectId
            ) {
              throw new StorageError(
                "invalid_report_snapshot",
                "报告快照与当前项目不匹配。",
              );
            }
            await database.reports.add(structuredClone(input));
            await database.projects.update(input.projectId, {
              status: input.assessmentSnapshot.scored.status,
              updatedAt: new Date().toISOString(),
            });
          },
        );
      } catch (error) {
        throw mapStorageError(error);
      }
    },

    async saveFinalization(assessment, report) {
      try {
        await database.transaction(
          "rw",
          database.projects,
          database.assessments,
          database.evidence,
          database.reports,
          async () => {
            await requireProject(database, assessment.projectId);
            if (
              report.projectId !== assessment.projectId ||
              report.assessmentId !== assessment.id ||
              report.assessmentSnapshot.id !== assessment.id ||
              report.assessmentSnapshot.projectId !== assessment.projectId
            ) {
              throw new StorageError(
                "invalid_report_snapshot",
                "报告快照与最终评估不匹配。",
              );
            }
            await database.assessments.add(structuredClone(assessment));
            const evidence = extractEvidenceRecords(assessment);
            if (evidence.length > 0) await database.evidence.bulkAdd(evidence);
            await database.reports.where("projectId").equals(assessment.projectId).delete();
            await database.reports.add(structuredClone(report));
            await database.projects.update(assessment.projectId, {
              status: "final",
              name: assessment.analysis.projectName,
              primaryCategory: assessment.analysis.primaryCategory,
              updatedAt: report.createdAt,
            });
          },
        );
      } catch (error) {
        throw mapStorageError(error);
      }
    },

    async getProjectWorkspace(projectId) {
      try {
        const [project, messages, assessments, researchSnapshots, reports] =
          await Promise.all([
          database.projects.get(projectId),
          database.messages.where("projectId").equals(projectId).sortBy("createdAt"),
          database.assessments
            .where("projectId")
            .equals(projectId)
            .sortBy("createdAt"),
          database.researchSnapshots
            .where("projectId")
            .equals(projectId)
            .sortBy("updatedAt"),
          database.reports.where("projectId").equals(projectId).sortBy("createdAt"),
          ]);
        if (!project) return null;

        return {
          project,
          messages,
          assessments,
          researchSnapshot: researchSnapshots.at(-1) ?? null,
          report: reports.at(-1) ?? null,
        };
      } catch (error) {
        throw mapStorageError(error);
      }
    },

    async listProjects() {
      try {
        const projects = await database.projects
          .orderBy("updatedAt")
          .reverse()
          .toArray();
        return await Promise.all(
          projects.map(async (project) => {
            const [reportCount, assessmentCount] = await Promise.all([
              database.reports.where("projectId").equals(project.id).count(),
              database.assessments.where("projectId").equals(project.id).count(),
            ]);
            const status =
              reportCount > 0
                ? "final"
                : assessmentCount > 0
                  ? "provisional"
                  : "draft";
            return { ...project, status };
          }),
        );
      } catch (error) {
        throw mapStorageError(error);
      }
    },

    async listFinalAssessments(projectIds) {
      try {
        const records: FinalAssessmentRecord[] = [];
        for (const projectId of projectIds) {
          const workspace = await repository.getProjectWorkspace(projectId);
          const report = workspace?.report;
          if (!workspace || !report) continue;
          records.push({
            project: { ...workspace.project, status: "final" },
            assessment: report.assessmentSnapshot,
            report,
          });
        }
        return records;
      } catch (error) {
        throw mapStorageError(error);
      }
    },

    async deleteProject(projectId) {
      try {
        await database.transaction(
          "rw",
          [
            database.projects,
            database.messages,
            database.assessments,
            database.evidence,
            database.reports,
            database.researchSnapshots,
          ],
          async () => {
            await database.messages.where("projectId").equals(projectId).delete();
            await database.assessments.where("projectId").equals(projectId).delete();
            await database.evidence.where("projectId").equals(projectId).delete();
            await database.reports.where("projectId").equals(projectId).delete();
            await database.researchSnapshots
              .where("projectId")
              .equals(projectId)
              .delete();
            await database.projects.delete(projectId);
          },
        );
      } catch (error) {
        throw mapStorageError(error);
      }
    },
  };

  return repository;
}

async function requireProject(
  database: SabcDatabase,
  projectId: string,
): Promise<ProjectRecord> {
  const project = await database.projects.get(projectId);
  if (!project) {
    throw new StorageError("project_not_found", "项目不存在，无法保存结果。");
  }
  return project;
}

function extractProjectName(description: string): string {
  const firstLine = description.trim().split(/\r?\n/)[0] ?? "";
  return firstLine.slice(0, 40) || "未命名项目";
}

function extractEvidenceRecords(
  assessment: AssessmentRecord,
): EvidenceRecord[] {
  return assessment.analysis.dimensions.flatMap((dimension) =>
    dimension.evidence.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      projectId: assessment.projectId,
      assessmentId: assessment.id,
      dimension: dimension.dimension,
    })),
  );
}

function mapStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;

  const name = error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError") {
    return new StorageError(
      "quota_exceeded",
      "本地存储空间不足，请清理浏览器站点数据后重试。",
    );
  }
  if (name === "VersionError") {
    return new StorageError(
      "schema_version_mismatch",
      "本地数据版本不兼容，请刷新页面；不要在未备份时清除数据。",
    );
  }
  if (name === "DatabaseClosedError") {
    return new StorageError(
      "database_closed",
      "本地数据库暂时不可用，请刷新页面后重试。",
    );
  }
  return new StorageError("storage_failed", "本地保存失败，请重试。");
}
