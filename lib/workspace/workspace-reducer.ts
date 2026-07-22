import type { ResearchSnapshotRecord } from "@/lib/research/research-types";
import type {
  AssessmentRecord,
  FinalReportRecord,
  MessageRecord,
  ProjectRecord,
  ProjectWorkspaceRecord,
} from "@/lib/storage/db";
import type { FinalizeStage } from "@/lib/streaming/finalize-stream";

export type WorkspacePhase =
  | "idle"
  | "loading"
  | "ready"
  | "chatting"
  | "planning_research"
  | "researching"
  | "analyzing"
  | "scoring"
  | "saving"
  | "error";

export interface StreamDraft {
  id: string;
  content: string;
  round: number;
}

export interface WorkspaceError {
  code: string;
  message: string;
  retryable: boolean;
  action?: "retry_chat" | "retry_finalize" | "retry_save";
}

export interface WorkspaceState {
  phase: WorkspacePhase;
  project: ProjectRecord | null;
  messages: MessageRecord[];
  assessmentHistory: AssessmentRecord[];
  currentAssessment: AssessmentRecord | null;
  researchSnapshot: ResearchSnapshotRecord | null;
  researchQueries: string[];
  report: FinalReportRecord | null;
  saved: boolean;
  error: WorkspaceError | null;
  activeRequestId: string | null;
  streamDraft: StreamDraft | null;
}

export type WorkspaceAction =
  | { type: "LOAD_STARTED" }
  | { type: "LOAD_SUCCEEDED"; workspace: ProjectWorkspaceRecord }
  | { type: "LOAD_FAILED"; error: WorkspaceError }
  | { type: "CHAT_STARTED"; requestId: string; messages: MessageRecord[] }
  | { type: "FINALIZE_STARTED"; requestId: string }
  | { type: "RESEARCH_PLANNED"; requestId: string; queries: string[] }
  | {
      type: "FINALIZE_STATUS";
      requestId: string;
      stage: FinalizeStage;
    }
  | {
      type: "RESEARCH_RECEIVED";
      requestId: string;
      snapshot: ResearchSnapshotRecord;
    }
  | {
      type: "ASSESSMENT_RECEIVED";
      requestId: string;
      assessment: AssessmentRecord;
    }
  | { type: "FINALIZATION_SAVE_STARTED"; requestId: string }
  | {
      type: "STREAM_DELTA";
      requestId: string;
      messageId: string;
      delta: string;
      round: number;
    }
  | { type: "STREAM_COMPLETED"; requestId: string; message: MessageRecord }
  | { type: "STREAM_STOPPED"; requestId: string; message: MessageRecord }
  | { type: "REQUEST_FAILED"; requestId: string; error: WorkspaceError }
  | { type: "SAVE_FAILED"; error: WorkspaceError }
  | { type: "SAVE_SUCCEEDED" }
  | { type: "PROJECT_DEPTH_CHANGED"; project: ProjectRecord }
  | { type: "REPORT_SAVED"; report: FinalReportRecord }
  | { type: "RESET" };

export function createInitialWorkspaceState(): WorkspaceState {
  return {
    phase: "idle",
    project: null,
    messages: [],
    assessmentHistory: [],
    currentAssessment: null,
    researchSnapshot: null,
    researchQueries: [],
    report: null,
    saved: true,
    error: null,
    activeRequestId: null,
    streamDraft: null,
  };
}

export const initialWorkspaceState = createInitialWorkspaceState();

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "LOAD_STARTED":
      return {
        ...state,
        phase: "loading",
        error: null,
        activeRequestId: null,
        streamDraft: null,
      };
    case "LOAD_SUCCEEDED":
      return {
        phase: "ready",
        project: action.workspace.project,
        messages: action.workspace.messages,
        assessmentHistory: action.workspace.assessments,
        currentAssessment: action.workspace.assessments.at(-1) ?? null,
        researchSnapshot: action.workspace.researchSnapshot ?? null,
        researchQueries: action.workspace.researchSnapshot?.queries ?? [],
        report: action.workspace.report,
        saved: true,
        error: null,
        activeRequestId: null,
        streamDraft: null,
      };
    case "LOAD_FAILED":
      return {
        ...state,
        phase: "error",
        error: action.error,
        activeRequestId: null,
        streamDraft: null,
      };
    case "CHAT_STARTED":
      return {
        ...state,
        phase: "chatting",
        messages: action.messages,
        error: null,
        activeRequestId: action.requestId,
        streamDraft: null,
      };
    case "FINALIZE_STARTED":
      return {
        ...state,
        phase: "planning_research",
        researchQueries: [],
        error: null,
        activeRequestId: action.requestId,
        streamDraft: null,
      };
    case "RESEARCH_PLANNED":
      if (state.activeRequestId !== action.requestId) return state;
      return { ...state, researchQueries: action.queries };
    case "FINALIZE_STATUS":
      if (state.activeRequestId !== action.requestId) return state;
      return { ...state, phase: action.stage };
    case "RESEARCH_RECEIVED":
      if (state.activeRequestId !== action.requestId) return state;
      return {
        ...state,
        researchSnapshot: action.snapshot,
        researchQueries: action.snapshot.queries,
      };
    case "ASSESSMENT_RECEIVED": {
      if (state.activeRequestId !== action.requestId) return state;
      return {
        ...state,
        phase: "scoring",
        project: state.project
          ? {
              ...state.project,
              name: action.assessment.analysis.projectName,
              primaryCategory: action.assessment.analysis.primaryCategory,
              status: "provisional",
              updatedAt: action.assessment.createdAt,
            }
          : null,
        assessmentHistory: [...state.assessmentHistory, action.assessment],
        currentAssessment: action.assessment,
        error: null,
      };
    }
    case "FINALIZATION_SAVE_STARTED":
      if (state.activeRequestId !== action.requestId) return state;
      return { ...state, phase: "saving" };
    case "STREAM_DELTA": {
      if (state.activeRequestId !== action.requestId) return state;
      const content =
        state.streamDraft?.id === action.messageId
          ? state.streamDraft.content + action.delta
          : action.delta;
      return {
        ...state,
        phase: "chatting",
        streamDraft: {
          id: action.messageId,
          content,
          round: action.round,
        },
      };
    }
    case "STREAM_COMPLETED":
    case "STREAM_STOPPED":
      if (state.activeRequestId !== action.requestId) return state;
      return {
        ...state,
        phase: "ready",
        messages: [...state.messages, action.message],
        error: null,
        activeRequestId: null,
        streamDraft: null,
      };
    case "REQUEST_FAILED":
      if (state.activeRequestId !== action.requestId) return state;
      return {
        ...state,
        phase: state.project ? "ready" : "error",
        error: action.error,
        activeRequestId: null,
        streamDraft: null,
      };
    case "SAVE_FAILED":
      return {
        ...state,
        phase: state.project ? "ready" : "error",
        saved: false,
        error: action.error,
        activeRequestId: null,
        streamDraft: null,
      };
    case "SAVE_SUCCEEDED":
      return {
        ...state,
        phase: "ready",
        saved: true,
        error: null,
        activeRequestId: null,
        streamDraft: null,
      };
    case "PROJECT_DEPTH_CHANGED":
      return { ...state, project: action.project };
    case "REPORT_SAVED":
      return {
        ...state,
        phase: "ready",
        project: state.project
          ? {
              ...state.project,
              status: action.report.assessmentSnapshot.scored.status,
              updatedAt: action.report.createdAt,
            }
          : null,
        report: action.report,
        saved: true,
        error: null,
        activeRequestId: null,
        streamDraft: null,
      };
    case "RESET":
      return createInitialWorkspaceState();
  }
}
