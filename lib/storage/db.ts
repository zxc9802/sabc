import Dexie, { type Table } from "dexie";

import type { AnalysisResponse } from "@/lib/ai/analysis-schema";
import type {
  CategoryId,
  DimensionKey,
  EvidenceItem,
  InterviewDepth,
  ProjectStatus,
  QuestionCandidate,
  SourceReference,
} from "@/lib/domain/types";
import type { AssessmentDiff } from "@/lib/scoring/assessment-diff";
import type { ScoredAssessment } from "@/lib/scoring/score-assessment";
import type {
  ResearchSnapshotRecord,
  ResearchStatus,
} from "@/lib/research/research-types";

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  primaryCategory: CategoryId | null;
  status: ProjectStatus;
  interviewDepth?: InterviewDepth;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  projectId: string;
  role: "user" | "assistant";
  content: string;
  round: number;
  createdAt: string;
  stage?: "interview" | "advisory";
  kind?: "chat" | "advisor_summary";
}

export interface AssessmentRecord {
  id: string;
  projectId: string;
  promptVersion: string;
  sources: SourceReference[];
  researchStatus: "not_needed" | ResearchStatus;
  analysis: AnalysisResponse;
  scored: ScoredAssessment;
  nextQuestion: QuestionCandidate | null;
  diff: AssessmentDiff | null;
  createdAt: string;
}

export interface EvidenceRecord extends EvidenceItem {
  id: string;
  projectId: string;
  assessmentId: string;
  dimension: DimensionKey;
}

export interface ReportContent {
  decisionSummary: string;
  opportunities: string[];
  risks: string[];
  confirmedFacts: string[];
  userStatements?: string[];
  assumptionsAndGaps: string[];
  nextActions: string[];
  upgradeConditions: string[];
  conversationSummary: string[];
}

export interface FinalReportRecord {
  id: string;
  projectId: string;
  assessmentId: string;
  assessmentSnapshot: AssessmentRecord;
  content: ReportContent;
  createdAt: string;
}

export interface ProjectWorkspaceRecord {
  project: ProjectRecord;
  messages: MessageRecord[];
  assessments: AssessmentRecord[];
  researchSnapshot?: ResearchSnapshotRecord | null;
  report: FinalReportRecord | null;
}

export interface FinalAssessmentRecord {
  project: ProjectRecord;
  assessment: AssessmentRecord;
  report: FinalReportRecord | null;
}

export type SaveAssessmentInput = AssessmentRecord;
export type SaveFinalReportInput = FinalReportRecord;

export class SabcDatabase extends Dexie {
  projects!: Table<ProjectRecord, string>;
  messages!: Table<MessageRecord, string>;
  assessments!: Table<AssessmentRecord, string>;
  evidence!: Table<EvidenceRecord, string>;
  reports!: Table<FinalReportRecord, string>;
  researchSnapshots!: Table<ResearchSnapshotRecord, string>;

  constructor(name = "sabc-project-priority-agent") {
    super(name);
    this.version(1).stores({
      projects: "id, status, updatedAt",
      messages: "id, projectId, round, createdAt",
      assessments: "id, projectId, createdAt",
      evidence: "id, projectId, assessmentId, dimension",
      reports: "id, projectId, assessmentId, createdAt",
    });
    this.version(2).stores({
      projects: "id, status, updatedAt",
      messages: "id, projectId, round, createdAt",
      assessments: "id, projectId, createdAt",
      evidence: "id, projectId, assessmentId, dimension",
      reports: "id, projectId, assessmentId, createdAt",
      researchSnapshots: "id, projectId, updatedAt",
    });
  }
}

export const db = new SabcDatabase();

export class StorageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
