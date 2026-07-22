"use client";

import { useCallback, useRef, useState } from "react";

import { createReportContent } from "@/lib/report/create-report-content";
import {
  FinalReportStreamProtocolError,
  readFinalReportStream,
} from "@/lib/report/final-report-stream";
import { createStageAssessmentContext } from "@/lib/report/stage-assessment-context";
import type {
  AssessmentRecord,
  FinalReportRecord,
} from "@/lib/storage/db";
import type { ProjectRepository } from "@/lib/storage/project-repository";

export type FinalReportGenerationPhase =
  | "idle"
  | "analyzing"
  | "scoring"
  | "saving";

export interface FinalReportGenerationError {
  code: string;
  message: string;
  retryable: boolean;
}

interface PendingFinalization {
  assessment: AssessmentRecord;
  report: FinalReportRecord;
}

export function useFinalReportGeneration(options: {
  projectId: string;
  repository: ProjectRepository;
  fetcher?: typeof fetch;
}) {
  const { projectId, repository, fetcher = fetch } = options;
  const [phase, setPhase] = useState<FinalReportGenerationPhase>("idle");
  const [error, setError] = useState<FinalReportGenerationError | null>(null);
  const pendingRef = useRef<PendingFinalization | null>(null);

  const generate = useCallback(async (): Promise<boolean> => {
    if (phase !== "idle") return false;
    setError(null);
    pendingRef.current = null;

    const workspace = await repository.getProjectWorkspace(projectId).catch(() => null);
    const stageAssessment = workspace?.assessments.at(-1);
    if (!workspace || !stageAssessment || !workspace.researchSnapshot) {
      setError({
        code: "incomplete_workspace",
        message: "访谈、调研或阶段评估不完整，暂时无法生成最终报告。",
        retryable: false,
      });
      return false;
    }

    setPhase("analyzing");
    let assessment: AssessmentRecord | null = null;
    let completed = false;
    try {
      const response = await fetcher("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectDescription: workspace.project.description,
          messages: workspace.messages.map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            round: message.round,
            stage: message.stage === "advisory" ? "advisory" : "interview",
          })),
          interviewDepth: workspace.project.interviewDepth ?? "medium",
          researchSnapshot: workspace.researchSnapshot,
          stageAssessment: createStageAssessmentContext(stageAssessment),
        }),
      });
      if (!response.ok) throw await responseError(response);

      await readFinalReportStream(response, (event) => {
        if (event.type === "status") {
          setPhase(event.stage);
          return;
        }
        if (event.type === "assessment") {
          assessment = {
            id: crypto.randomUUID(),
            projectId,
            promptVersion: event.result.promptVersion,
            sources: event.result.sources,
            researchStatus: event.result.researchStatus,
            analysis: event.result.analysis,
            scored: event.result.scored,
            nextQuestion: null,
            diff: event.result.diff,
            createdAt: new Date().toISOString(),
          };
          return;
        }
        if (event.type === "complete") {
          completed = true;
          return;
        }
        throw new ReportGenerationRequestError(
          event.code,
          event.message,
          event.retryable,
        );
      });
    } catch (caught) {
      const reportError = normalizeError(caught);
      setPhase("idle");
      setError(reportError);
      return false;
    }

    if (!completed || !assessment) {
      setPhase("idle");
      setError({
        code: "invalid_response",
        message: "最终报告服务没有返回完整评估，请重试。",
        retryable: true,
      });
      return false;
    }

    const finalAssessment: AssessmentRecord = assessment;
    const report: FinalReportRecord = {
      id: crypto.randomUUID(),
      projectId,
      assessmentId: finalAssessment.id,
      assessmentSnapshot: structuredClone(finalAssessment),
      content: createReportContent(finalAssessment, workspace.messages),
      createdAt: new Date().toISOString(),
    };
    setPhase("saving");
    try {
      await repository.saveFinalization(finalAssessment, report);
    } catch {
      pendingRef.current = { assessment: finalAssessment, report };
      setPhase("idle");
      setError({
        code: "storage_failed",
        message: "报告已生成，但保存到本地失败。请重试保存。",
        retryable: true,
      });
      return false;
    }

    setPhase("idle");
    setError(null);
    return true;
  }, [fetcher, phase, projectId, repository]);

  const retrySave = useCallback(async (): Promise<boolean> => {
    const pending = pendingRef.current;
    if (!pending || phase !== "idle") return false;
    setPhase("saving");
    try {
      await repository.saveFinalization(pending.assessment, pending.report);
      pendingRef.current = null;
      setPhase("idle");
      setError(null);
      return true;
    } catch {
      setPhase("idle");
      setError({
        code: "storage_failed",
        message: "本地保存仍未成功，请检查浏览器存储空间后重试。",
        retryable: true,
      });
      return false;
    }
  }, [phase, repository]);

  return { phase, error, generate, retrySave };
}

class ReportGenerationRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function responseError(response: Response): Promise<ReportGenerationRequestError> {
  const fallback = new ReportGenerationRequestError(
    "request_failed",
    "最终报告请求失败，请稍后重试。",
    response.status >= 500,
  );
  try {
    const body = (await response.json()) as Partial<FinalReportGenerationError>;
    return new ReportGenerationRequestError(
      typeof body.code === "string" ? body.code : fallback.code,
      typeof body.message === "string" ? body.message : fallback.message,
      typeof body.retryable === "boolean" ? body.retryable : fallback.retryable,
    );
  } catch {
    return fallback;
  }
}

function normalizeError(caught: unknown): FinalReportGenerationError {
  if (caught instanceof ReportGenerationRequestError) {
    return {
      code: caught.code,
      message: caught.message,
      retryable: caught.retryable,
    };
  }
  if (caught instanceof FinalReportStreamProtocolError) {
    return { code: caught.code, message: caught.message, retryable: true };
  }
  return {
    code: "request_failed",
    message: "最终报告请求失败，请稍后重试。",
    retryable: true,
  };
}
