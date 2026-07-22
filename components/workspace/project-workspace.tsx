"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ComparisonView } from "@/components/compare/comparison-view";
import { ProjectPicker } from "@/components/compare/project-picker";
import { ErrorBanner } from "@/components/shared/error-banner";
import { StageRail } from "@/components/workflow/stage-rail";
import { isInterviewMessage } from "@/lib/conversation/message-stage";
import type { FinalAssessmentRecord } from "@/lib/storage/db";
import { createProjectRepository, type ProjectRepository } from "@/lib/storage/project-repository";
import { useAssessmentSession } from "@/lib/workspace/use-assessment-session";
import { projectDestination } from "@/lib/workflow/project-destination";

import { ConversationPanel } from "./conversation-panel";
import { ProjectList } from "./project-list";

const browserRepository = createProjectRepository();

interface ProjectWorkspaceProps {
  repository?: ProjectRepository;
  fetcher?: typeof fetch;
  initialProjectId?: string;
}

export function ProjectWorkspace({
  repository = browserRepository,
  fetcher,
  initialProjectId,
}: ProjectWorkspaceProps) {
  const session = useAssessmentSession({ repository, fetcher });
  const router = useRouter();
  const { state } = session;
  const [description, setDescription] = useState("");
  const [answer, setAnswer] = useState("");
  const [comparisonRecords, setComparisonRecords] = useState<FinalAssessmentRecord[] | null>(null);
  const [selectedComparisonIds, setSelectedComparisonIds] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const initialProjectLoadedRef = useRef(false);
  const loadProject = session.loadProject;

  useEffect(() => {
    document.documentElement.dataset.sabcReady = "true";
    return () => {
      delete document.documentElement.dataset.sabcReady;
    };
  }, []);

  useEffect(() => {
    if (!initialProjectId || initialProjectLoadedRef.current) return;
    initialProjectLoadedRef.current = true;
    void loadProject(initialProjectId);
  }, [initialProjectId, loadProject]);

  async function createProject(): Promise<void> {
    const input = description.trim();
    if (!input) return;
    await session.createAndAnalyze(input);
  }

  async function answerQuestion(): Promise<void> {
    const input = answer.trim();
    if (!input) return;
    if (await session.answerQuestion(input)) setAnswer("");
  }

  async function retryAnalysis(): Promise<void> {
    if (await session.retry()) {
      setAnswer("");
    }
  }

  async function retrySave(): Promise<void> {
    const saved = await session.retrySave();
    if (saved === "report" && state.project) {
      router.push(`/research/${encodeURIComponent(state.project.id)}`);
    }
  }

  async function openComparison(): Promise<void> {
    const records = await repository.listFinalAssessments(
      session.projects.map((project) => project.id),
    );
    const defaults = records.slice(0, Math.min(2, records.length)).map(({ project }) => project.id);
    setSelectedComparisonIds(defaults);
    setComparisonRecords(records);
    setHistoryOpen(false);
  }

  function beginResearch(): void {
    if (!state.project) return;
    router.push(`/research/${encodeURIComponent(state.project.id)}`);
  }

  function startNewDossier(): void {
    session.resetSession();
    setDescription("");
    setAnswer("");
    setComparisonRecords(null);
    setHistoryOpen(false);
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-ink bg-paper/95">
        <div className="mx-auto flex min-h-16 max-w-[1480px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid size-9 place-items-center border border-ink bg-ink font-mono text-sm font-bold text-paper">S</span>
            <div>
              <h1 className="font-display text-lg font-semibold tracking-tight">SABC 项目优先级评估</h1>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted">Evidence before investment</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-decision">
              阶段 1 · 信息收集智能体
            </p>
            <p className="hidden text-xs text-muted sm:block">事实提取交给模型，等级计算交给规则</p>
            <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">Local dossier · private browser</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1480px] px-3 py-3 sm:px-5 sm:py-5">
        <StageRail active="interview" />
        <ErrorBanner
          error={
            state.error?.action === "retry_finalize" ? null : state.error
          }
          saved={state.saved}
          retrying={!["idle", "ready", "error"].includes(state.phase)}
          onRetryAnalysis={() => void retryAnalysis()}
          onRetrySave={() => void retrySave()}
        />

        <div className="workspace-grid mt-3 border border-line shadow-dossier">
          <div className="workspace-history border-r border-line">
            <div className="history-drawer">
              <button
                type="button"
                aria-expanded={historyOpen}
                className="history-drawer-trigger min-h-12 w-full border-b border-line bg-sheet px-4 py-3 text-left font-semibold"
                onClick={() => setHistoryOpen((open) => !open)}
              >
                历史项目与对比
              </button>
              <div className="history-drawer-content" data-open={historyOpen}>
                <ProjectList
                  projects={session.projects}
                  selectedId={state.project?.id ?? null}
                  onSelect={(projectId) => {
                    setHistoryOpen(false);
                    const selected = session.projects.find(
                      (project) => project.id === projectId,
                    );
                    if (selected) router.push(projectDestination(selected));
                  }}
                  onDelete={(projectId) => void session.deleteProject(projectId)}
                  onCompare={() => void openComparison()}
                  onNew={startNewDossier}
                />
              </div>
            </div>
          </div>
          {comparisonRecords ? (
            <section className="workspace-comparison bg-sheet p-5 sm:p-7" aria-label="项目对比工作区">
              <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-decision">Decision matrix</p>
                  <h2 className="mt-1 font-display text-3xl font-semibold">横向比较投入优先级</h2>
                </div>
                <button
                  type="button"
                  className="min-h-11 border border-ink px-4 text-sm font-semibold hover:bg-ink hover:text-white"
                  onClick={() => setComparisonRecords(null)}
                >
                  返回当前项目
                </button>
              </div>
              <ProjectPicker
                records={comparisonRecords}
                defaultSelectedIds={selectedComparisonIds}
                onSelectionChange={setSelectedComparisonIds}
              />
              <ComparisonView
                records={comparisonRecords.filter(({ project }) =>
                  selectedComparisonIds.includes(project.id),
                )}
              />
            </section>
          ) : (
          <>
          <div
            className="workspace-conversation"
            aria-label="访谈工作区"
          >
            <ConversationPanel
              project={state.project}
              messages={state.messages.filter(isInterviewMessage)}
              streamDraft={state.streamDraft}
              phase={state.phase}
              description={description}
              answer={answer}
              onDescriptionChange={setDescription}
              onAnswerChange={setAnswer}
              onCreate={() => void createProject()}
              onAnswer={() => void answerQuestion()}
              onStop={() => session.stopGeneration()}
              onFinalize={beginResearch}
              onDepthChange={(depth) => void session.setInterviewDepth(depth)}
            />
          </div>
          </>
          )}
        </div>
      </main>
    </div>
  );
}
