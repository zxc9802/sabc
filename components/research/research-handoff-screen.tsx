"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createProjectRepository,
  type ProjectRepository,
} from "@/lib/storage/project-repository";
import { useAssessmentSession } from "@/lib/workspace/use-assessment-session";
import { StageRail } from "@/components/workflow/stage-rail";

import {
  ResearchProgress,
  type ResearchHandoffPhase,
} from "./research-progress";

const browserRepository = createProjectRepository();

interface ResearchHandoffScreenProps {
  projectId: string;
  repository?: ProjectRepository;
  fetcher?: typeof fetch;
}

interface HandoffError {
  code: string;
  message: string;
  retryable: boolean;
}

export function ResearchHandoffScreen({
  projectId,
  repository = browserRepository,
  fetcher,
}: ResearchHandoffScreenProps) {
  const router = useRouter();
  const {
    state: assessmentState,
    finalizeCurrent,
    loadProject,
  } = useAssessmentSession({ repository, fetcher });
  const [localError, setLocalError] = useState<HandoffError | null>(null);
  const [needsFinalization, setNeedsFinalization] = useState(false);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);
  const finalizingRef = useRef(false);

  const finalize = useCallback(
    async (researchMode: "auto" | "interview_only"): Promise<void> => {
      if (finalizingRef.current) return;
      finalizingRef.current = true;
      setLocalError(null);
      const completed = await finalizeCurrent(researchMode);
      finalizingRef.current = false;
      if (!completed || !mountedRef.current) return;
      const workspace = await repository.getProjectWorkspace(projectId);
      if (!workspace?.assessments.at(-1)) {
        setLocalError({
          code: "assessment_missing",
          message: "评级已结束，但未找到已保存的阶段评估，请重试。",
          retryable: true,
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (!mountedRef.current) return;
      router.replace(`/advisor/${encodeURIComponent(projectId)}`);
    },
    [finalizeCurrent, projectId, repository, router],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (!startedRef.current) {
      startedRef.current = true;
      void repository.getProjectWorkspace(projectId).then(async (workspace) => {
        if (!mountedRef.current) return;
        if (!workspace) {
          setLocalError({
            code: "not_found",
            message: "项目不存在或已被删除。",
            retryable: false,
          });
          return;
        }
        if (workspace.assessments.at(-1)) {
          router.replace(`/advisor/${encodeURIComponent(projectId)}`);
          return;
        }
        await loadProject(projectId);
        if (mountedRef.current) setNeedsFinalization(true);
      });
    }
    return () => {
      mountedRef.current = false;
    };
  }, [loadProject, projectId, repository, router]);

  useEffect(() => {
    if (
      needsFinalization &&
      assessmentState.phase === "ready" &&
      assessmentState.project?.id === projectId &&
      !finalizingRef.current
    ) {
      setNeedsFinalization(false);
      void finalize("auto");
    }
  }, [
    finalize,
    needsFinalization,
    projectId,
    assessmentState.phase,
    assessmentState.project,
  ]);

  const sessionPhase = assessmentState.phase;
  const phase: ResearchHandoffPhase =
    sessionPhase === "planning_research" ||
    sessionPhase === "researching" ||
    sessionPhase === "analyzing" ||
    sessionPhase === "scoring" ||
    sessionPhase === "saving"
      ? sessionPhase
      : "planning_research";

  const error = localError ?? assessmentState.error;

  return (
    <main className="min-h-screen bg-paper px-4 py-8 text-ink sm:px-6 sm:py-14">
      <div className="mx-auto max-w-[1180px]">
        <header className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center border border-ink bg-ink font-mono text-sm font-bold text-paper">
              S
            </span>
            <div>
              <p className="font-semibold">SABC 项目优先级评估</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
                Research handoff
              </p>
            </div>
          </div>
          <span className="text-xs text-muted">项目：{projectId}</span>
        </header>
        <StageRail active="research" />
        <ResearchProgress
          phase={phase}
          queries={assessmentState.researchQueries}
          sourceCount={assessmentState.researchSnapshot?.sources.length ?? 0}
          error={error}
          onRetry={() => void finalize("auto")}
          onInterviewOnly={() => void finalize("interview_only")}
        />
      </div>
    </main>
  );
}
