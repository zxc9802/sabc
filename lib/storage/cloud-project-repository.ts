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

export type SqlResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
  rowCount: number | null;
};

export type SqlClient = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<SqlResult<Row>>;
  release?(): void;
};

export type SqlPool = SqlClient & {
  connect(): Promise<SqlClient>;
};

export class CloudStorageError extends Error {
  constructor(
    public readonly code: "project_not_found" | "invalid_report_snapshot" | "storage_failed",
    message: string,
  ) {
    super(message);
    this.name = "CloudStorageError";
  }
}

type Row = Record<string, unknown>;

export function createCloudProjectRepository(pool: SqlPool) {
  return {
    async createProject(ownerId: string, description: string): Promise<ProjectRecord> {
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
      const result = await queryOrStorageFailure(pool,
        `INSERT INTO sabc_projects (
           owner_id, id, name, description, primary_category, status,
           interview_depth, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          ownerId,
          project.id,
          project.name,
          project.description,
          project.primaryCategory,
          project.status,
          project.interviewDepth,
          project.createdAt,
          project.updatedAt,
        ],
      );
      return toProject(requireRow(result.rows[0]));
    },

    async updateInterviewDepth(
      ownerId: string,
      projectId: string,
      depth: InterviewDepth,
    ): Promise<ProjectRecord | null> {
      const result = await queryOrStorageFailure(pool,
        `UPDATE sabc_projects
         SET interview_depth = $3, updated_at = $4
         WHERE owner_id = $1 AND id = $2
         RETURNING *`,
        [ownerId, projectId, depth, new Date().toISOString()],
      );
      return result.rows[0] ? toProject(result.rows[0]) : null;
    },

    async appendMessage(ownerId: string, message: MessageRecord): Promise<boolean> {
      return withTransaction(pool, async (client) => {
        if (!await projectExists(client, ownerId, message.projectId)) return false;
        await client.query(
          `INSERT INTO sabc_messages (
             owner_id, id, project_id, role, content, round, stage, kind, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            ownerId,
            message.id,
            message.projectId,
            message.role,
            message.content,
            message.round,
            message.stage ?? null,
            message.kind ?? null,
            message.createdAt,
          ],
        );
        await client.query(
          `UPDATE sabc_projects SET updated_at = $3
           WHERE owner_id = $1 AND id = $2`,
          [ownerId, message.projectId, new Date().toISOString()],
        );
        return true;
      });
    },

    async saveResearchSnapshot(
      ownerId: string,
      input: ResearchSnapshotRecord,
    ): Promise<boolean> {
      return withTransaction(pool, async (client) => {
        if (!await projectExists(client, ownerId, input.projectId)) return false;
        await client.query(
          `INSERT INTO sabc_research_snapshots (
             owner_id, id, project_id, payload, created_at, updated_at
           ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
           ON CONFLICT (owner_id, id) DO UPDATE SET
             payload = EXCLUDED.payload, created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at
           WHERE sabc_research_snapshots.project_id = EXCLUDED.project_id`,
          [
            ownerId,
            input.id,
            input.projectId,
            toJson(input),
            input.createdAt,
            input.updatedAt,
          ],
        );
        await client.query(
          `UPDATE sabc_projects SET updated_at = $3
           WHERE owner_id = $1 AND id = $2`,
          [ownerId, input.projectId, input.updatedAt],
        );
        return true;
      });
    },

    async saveAssessment(ownerId: string, input: AssessmentRecord): Promise<boolean> {
      return withTransaction(pool, async (client) => {
        if (!await projectExists(client, ownerId, input.projectId)) return false;
        await insertAssessment(client, ownerId, input);
        await client.query(
          `UPDATE sabc_projects
           SET status = 'provisional', name = $3, primary_category = $4, updated_at = $5
           WHERE owner_id = $1 AND id = $2`,
          [
            ownerId,
            input.projectId,
            input.analysis.projectName,
            input.analysis.primaryCategory,
            new Date().toISOString(),
          ],
        );
        return true;
      });
    },

    async saveFinalReport(ownerId: string, input: FinalReportRecord): Promise<boolean> {
      validateReportSnapshot(input);
      return withTransaction(pool, async (client) => {
        if (!await projectExists(client, ownerId, input.projectId)) return false;
        await insertReport(client, ownerId, input);
        await client.query(
          `UPDATE sabc_projects SET status = $3, updated_at = $4
           WHERE owner_id = $1 AND id = $2`,
          [ownerId, input.projectId, input.assessmentSnapshot.scored.status, new Date().toISOString()],
        );
        return true;
      });
    },

    async saveFinalization(
      ownerId: string,
      assessment: AssessmentRecord,
      report: FinalReportRecord,
    ): Promise<boolean> {
      validateFinalization(assessment, report);
      return withTransaction(pool, async (client) => {
        if (!await projectExists(client, ownerId, assessment.projectId)) return false;
        await insertAssessment(client, ownerId, assessment);
        await client.query(
          `DELETE FROM sabc_reports WHERE owner_id = $1 AND project_id = $2`,
          [ownerId, assessment.projectId],
        );
        await insertReport(client, ownerId, report);
        await client.query(
          `UPDATE sabc_projects
           SET status = 'final', name = $3, primary_category = $4, updated_at = $5
           WHERE owner_id = $1 AND id = $2`,
          [
            ownerId,
            assessment.projectId,
            assessment.analysis.projectName,
            assessment.analysis.primaryCategory,
            report.createdAt,
          ],
        );
        return true;
      });
    },

    async getProjectWorkspace(
      ownerId: string,
      projectId: string,
    ): Promise<ProjectWorkspaceRecord | null> {
      const projectResult = await queryOrStorageFailure<Row>(pool,
        `SELECT * FROM sabc_projects WHERE owner_id = $1 AND id = $2`,
        [ownerId, projectId],
      );
      const project = projectResult.rows[0];
      if (!project) return null;

      const [messages, assessments, researchSnapshots, reports] = await Promise.all([
        queryOrStorageFailure<Row>(pool,
          `SELECT * FROM sabc_messages
           WHERE owner_id = $1 AND project_id = $2 ORDER BY created_at ASC`,
          [ownerId, projectId],
        ),
        queryOrStorageFailure<Row>(pool,
          `SELECT * FROM sabc_assessments
           WHERE owner_id = $1 AND project_id = $2 ORDER BY created_at ASC`,
          [ownerId, projectId],
        ),
        queryOrStorageFailure<Row>(pool,
          `SELECT * FROM sabc_research_snapshots
           WHERE owner_id = $1 AND project_id = $2 ORDER BY updated_at DESC LIMIT 1`,
          [ownerId, projectId],
        ),
        queryOrStorageFailure<Row>(pool,
          `SELECT * FROM sabc_reports
           WHERE owner_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 1`,
          [ownerId, projectId],
        ),
      ]);

      return {
        project: toProject(project),
        messages: messages.rows.map(toMessage),
        assessments: assessments.rows.map(toAssessment),
        researchSnapshot: researchSnapshots.rows[0]
          ? toResearchSnapshot(researchSnapshots.rows[0])
          : null,
        report: reports.rows[0] ? toReport(reports.rows[0]) : null,
      };
    },

    async listProjects(ownerId: string): Promise<ProjectRecord[]> {
      const result = await queryOrStorageFailure<Row>(pool,
        `SELECT * FROM sabc_projects WHERE owner_id = $1 ORDER BY updated_at DESC`,
        [ownerId],
      );
      return result.rows.map(toProject);
    },

    async listFinalAssessments(
      ownerId: string,
      projectIds: string[],
    ): Promise<FinalAssessmentRecord[]> {
      const records: FinalAssessmentRecord[] = [];
      for (const projectId of projectIds) {
        const workspace = await this.getProjectWorkspace(ownerId, projectId);
        if (!workspace?.report) continue;
        records.push({
          project: { ...workspace.project, status: "final" },
          assessment: workspace.report.assessmentSnapshot,
          report: workspace.report,
        });
      }
      return records;
    },

    async deleteProject(ownerId: string, projectId: string): Promise<boolean> {
      const result = await queryOrStorageFailure(pool,
        `DELETE FROM sabc_projects WHERE owner_id = $1 AND id = $2`,
        [ownerId, projectId],
      );
      return result.rowCount === 1;
    },
  };
}

async function queryOrStorageFailure<Row extends Record<string, unknown>>(
  client: SqlClient,
  text: string,
  values?: unknown[],
): Promise<SqlResult<Row>> {
  try {
    return await client.query<Row>(text, values);
  } catch (error) {
    throw storageFailure(error);
  }
}

async function withTransaction<T>(
  pool: SqlPool,
  operation: (client: SqlClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The original failure is the actionable error.
    }
    throw storageFailure(error);
  } finally {
    client.release?.();
  }
}

async function projectExists(
  client: SqlClient,
  ownerId: string,
  projectId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT id FROM sabc_projects WHERE owner_id = $1 AND id = $2`,
    [ownerId, projectId],
  );
  return result.rowCount === 1;
}

async function insertAssessment(
  client: SqlClient,
  ownerId: string,
  assessment: AssessmentRecord,
): Promise<void> {
  await client.query(
    `INSERT INTO sabc_assessments (
       owner_id, id, project_id, prompt_version, sources, research_status,
       analysis, scored, next_question, diff, created_at
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11
     )`,
    [
      ownerId,
      assessment.id,
      assessment.projectId,
      assessment.promptVersion,
      toJson(assessment.sources),
      assessment.researchStatus,
      toJson(assessment.analysis),
      toJson(assessment.scored),
      toJson(assessment.nextQuestion),
      toJson(assessment.diff),
      assessment.createdAt,
    ],
  );
  for (const dimension of assessment.analysis.dimensions) {
    for (const evidence of dimension.evidence) {
      await client.query(
        `INSERT INTO sabc_evidence (
           owner_id, id, project_id, assessment_id, dimension, payload
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          ownerId,
          crypto.randomUUID(),
          assessment.projectId,
          assessment.id,
          dimension.dimension,
          toJson(evidence),
        ],
      );
    }
  }
}

async function insertReport(
  client: SqlClient,
  ownerId: string,
  report: FinalReportRecord,
): Promise<void> {
  await client.query(
    `INSERT INTO sabc_reports (
       owner_id, id, project_id, assessment_id, assessment_snapshot, content, created_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      ownerId,
      report.id,
      report.projectId,
      report.assessmentId,
      toJson(report.assessmentSnapshot),
      toJson(report.content),
      report.createdAt,
    ],
  );
}

function validateReportSnapshot(report: FinalReportRecord): void {
  if (
    report.assessmentSnapshot.id !== report.assessmentId
    || report.assessmentSnapshot.projectId !== report.projectId
  ) {
    throw new CloudStorageError(
      "invalid_report_snapshot",
      "报告快照与当前项目不匹配。",
    );
  }
}

function validateFinalization(
  assessment: AssessmentRecord,
  report: FinalReportRecord,
): void {
  if (
    report.projectId !== assessment.projectId
    || report.assessmentId !== assessment.id
    || report.assessmentSnapshot.id !== assessment.id
    || report.assessmentSnapshot.projectId !== assessment.projectId
  ) {
    throw new CloudStorageError(
      "invalid_report_snapshot",
      "报告快照与最终评估不匹配。",
    );
  }
}

function toProject(row: Row): ProjectRecord {
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    description: stringValue(row.description),
    primaryCategory: (row.primary_category as ProjectRecord["primaryCategory"]) ?? null,
    status: row.status as ProjectRecord["status"],
    interviewDepth: row.interview_depth as ProjectRecord["interviewDepth"],
    createdAt: isoValue(row.created_at),
    updatedAt: isoValue(row.updated_at),
  };
}

function toMessage(row: Row): MessageRecord {
  return {
    id: stringValue(row.id),
    projectId: stringValue(row.project_id),
    role: row.role as MessageRecord["role"],
    content: stringValue(row.content),
    round: numberValue(row.round),
    createdAt: isoValue(row.created_at),
    stage: row.stage as MessageRecord["stage"],
    kind: row.kind as MessageRecord["kind"],
  };
}

function toAssessment(row: Row): AssessmentRecord {
  return {
    id: stringValue(row.id),
    projectId: stringValue(row.project_id),
    promptVersion: stringValue(row.prompt_version),
    sources: row.sources as AssessmentRecord["sources"],
    researchStatus: row.research_status as AssessmentRecord["researchStatus"],
    analysis: row.analysis as AssessmentRecord["analysis"],
    scored: row.scored as AssessmentRecord["scored"],
    nextQuestion: row.next_question as AssessmentRecord["nextQuestion"],
    diff: row.diff as AssessmentRecord["diff"],
    createdAt: isoValue(row.created_at),
  };
}

function toResearchSnapshot(row: Row): ResearchSnapshotRecord {
  const payload = row.payload as ResearchSnapshotRecord;
  return {
    ...payload,
    createdAt: isoValue(row.created_at),
    updatedAt: isoValue(row.updated_at),
  };
}

function toReport(row: Row): FinalReportRecord {
  return {
    id: stringValue(row.id),
    projectId: stringValue(row.project_id),
    assessmentId: stringValue(row.assessment_id),
    assessmentSnapshot: row.assessment_snapshot as AssessmentRecord,
    content: row.content as FinalReportRecord["content"],
    createdAt: isoValue(row.created_at),
  };
}

function extractProjectName(description: string): string {
  const firstLine = description.trim().split(/\r?\n/)[0] ?? "";
  return firstLine.slice(0, 40) || "未命名项目";
}

function requireRow<Row extends Record<string, unknown>>(row: Row | undefined): Row {
  if (!row) throw new CloudStorageError("storage_failed", "云端记录保存失败，请重试。");
  return row;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function isoValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return stringValue(value);
}

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function storageFailure(error: unknown): CloudStorageError {
  if (error instanceof CloudStorageError) return error;
  return new CloudStorageError("storage_failed", "云端记录保存失败，请重试。");
}
