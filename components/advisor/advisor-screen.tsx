"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ProjectList } from "@/components/workspace/project-list";
import { StageRail } from "@/components/workflow/stage-rail";
import type { ProjectRecord } from "@/lib/storage/db";
import {
  createProjectRepository,
  type ProjectRepository,
} from "@/lib/storage/project-repository";
import { useAdvisorSession } from "@/lib/advisor/use-advisor-session";
import { useFinalReportGeneration } from "@/lib/report/use-final-report-generation";
import { projectDestination } from "@/lib/workflow/project-destination";

import { AdvisorConversation } from "./advisor-conversation";

const browserRepository = createProjectRepository();

interface AdvisorScreenProps {
  projectId: string;
  repository?: ProjectRepository;
  fetcher?: typeof fetch;
}

export function AdvisorScreen({
  projectId,
  repository = browserRepository,
  fetcher,
}: AdvisorScreenProps) {
  const router = useRouter();
  const session = useAdvisorSession({ projectId, repository, fetcher });
  const reportGeneration = useFinalReportGeneration({
    projectId,
    repository,
    fetcher,
  });
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [answer, setAnswer] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void repository.listProjects().then((values) => {
      if (active) setProjects(values);
    });
    return () => {
      active = false;
    };
  }, [repository]);

  useEffect(() => {
    if (session.error?.code === "assessment_missing") {
      router.replace(`/research/${encodeURIComponent(projectId)}`);
    }
  }, [projectId, router, session.error]);

  async function send(): Promise<void> {
    const content = answer.trim();
    if (!content) return;
    if (await session.send(content)) setAnswer("");
  }

  async function generateReport(): Promise<void> {
    if (await reportGeneration.generate()) {
      router.push(`/report/${encodeURIComponent(projectId)}`);
    }
  }

  async function retryReport(): Promise<void> {
    const completed =
      reportGeneration.error?.code === "storage_failed"
        ? await reportGeneration.retrySave()
        : await reportGeneration.generate();
    if (completed) router.push(`/report/${encodeURIComponent(projectId)}`);
  }

  if (session.phase === "loading") {
    return <LoadingState message="正在读取项目建议……" />;
  }
  if (session.error?.code === "not_found") {
    return (
      <main className="grid min-h-screen place-items-center bg-paper px-5 text-ink">
        <div className="max-w-lg border border-line bg-sheet p-8 shadow-dossier">
          <h1 className="font-display text-2xl font-semibold">
            项目不存在或已被删除。
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            当前浏览器中找不到这份本地案卷。
          </p>
          <Link
            className="mt-5 inline-flex min-h-11 items-center bg-ink px-4 font-semibold text-white"
            href="/"
          >
            返回项目列表
          </Link>
        </div>
      </main>
    );
  }
  if (!session.project || !session.assessment) {
    return <LoadingState message="正在恢复调研流程……" />;
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="advisor-navigation border-b border-ink bg-paper/95">
        <div className="mx-auto flex min-h-16 max-w-[1480px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center border border-ink bg-ink font-mono text-sm font-bold text-paper">
              S
            </span>
            <div>
              <p className="font-semibold">SABC 项目优先级评估</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
                Evidence to action
              </p>
            </div>
          </div>
          <p className="text-xs font-semibold text-decision">
            阶段 2 · 项目建议智能体
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-[1480px] px-3 py-3 sm:px-5 sm:py-5">
        <StageRail active="advisor" />
        <div className="workspace-grid border border-line shadow-dossier">
          <div className="workspace-history border-r border-line">
            <div className="history-drawer">
              <button
                type="button"
                aria-expanded={historyOpen}
                className="history-drawer-trigger min-h-12 w-full border-b border-line bg-sheet px-4 py-3 text-left font-semibold"
                onClick={() => setHistoryOpen((open) => !open)}
              >
                历史项目
              </button>
              <div className="history-drawer-content" data-open={historyOpen}>
                <ProjectList
                  projects={projects}
                  selectedId={projectId}
                  onSelect={(selectedId) => {
                    const selected = projects.find(({ id }) => id === selectedId);
                    if (selected) router.push(projectDestination(selected));
                  }}
                  onDelete={(selectedId) => {
                    void repository.deleteProject(selectedId).then(() => {
                      if (selectedId === projectId) router.push("/");
                    });
                  }}
                  onCompare={() => router.push("/")}
                  onNew={() => router.push("/")}
                />
              </div>
            </div>
          </div>
          <AdvisorConversation
            project={session.project}
            messages={session.messages}
            phase={session.phase}
            streamDraft={session.streamDraft}
            error={session.error}
            reportPhase={reportGeneration.phase}
            reportError={reportGeneration.error}
            answer={answer}
            onAnswerChange={setAnswer}
            onSend={() => void send()}
            onRetry={() => void session.retry()}
            onStop={() => session.stop()}
            onGenerateReport={() => void generateReport()}
            onRetryReport={() => void retryReport()}
          />
        </div>
      </main>
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-paper text-ink">
      <p className="border-l-2 border-decision px-4 text-sm text-muted">
        {message}
      </p>
    </main>
  );
}
