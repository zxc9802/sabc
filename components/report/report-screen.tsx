"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { StageRail } from "@/components/workflow/stage-rail";
import type { ProjectWorkspaceRecord } from "@/lib/storage/db";
import {
  createProjectRepository,
  type ProjectRepository,
} from "@/lib/storage/project-repository";

import { ReportView } from "./report-view";

const browserRepository = createProjectRepository();

export function ReportScreen({
  projectId,
  repository = browserRepository,
}: {
  projectId: string;
  repository?: ProjectRepository;
}) {
  const [workspace, setWorkspace] = useState<ProjectWorkspaceRecord | null>();

  useEffect(() => {
    let active = true;
    void repository.getProjectWorkspace(projectId).then((value) => {
      if (active) setWorkspace(value);
    });
    return () => {
      active = false;
    };
  }, [projectId, repository]);

  if (workspace === undefined) {
    return <ReportState message="正在读取最终报告……" />;
  }
  if (workspace === null) {
    return (
      <ReportState message="项目不存在或已被删除。">
        <Link className="mt-4 inline-flex min-h-11 items-center bg-ink px-4 text-white" href="/">
          返回项目列表
        </Link>
      </ReportState>
    );
  }
  if (!workspace.report) {
    return (
      <ReportState message="尚未生成最终报告">
        <Link
          className="mt-4 inline-flex min-h-11 items-center bg-decision px-4 font-semibold text-white"
          href={`/advisor/${encodeURIComponent(projectId)}`}
        >
          返回第二智能体
        </Link>
      </ReportState>
    );
  }

  return (
    <div className="min-h-screen bg-paper text-ink" data-testid="report-screen" data-project-id={projectId}>
      <header className="border-b border-ink bg-paper/95">
        <div className="mx-auto flex min-h-16 max-w-[1380px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center border border-ink bg-ink font-mono text-sm font-bold text-paper">
              S
            </span>
            <div>
              <p className="font-semibold">SABC 项目优先级评估</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
                Final dossier
              </p>
            </div>
          </div>
          <p className="text-xs font-semibold text-decision">最终报告</p>
        </div>
      </header>
      <main className="mx-auto max-w-[1380px] px-3 py-4 sm:px-6 sm:py-6">
        <StageRail active="report" />
        <ReportView project={workspace.project} report={workspace.report} />
      </main>
    </div>
  );
}

function ReportState({
  message,
  children,
}: {
  message: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-5 text-ink">
      <div className="max-w-lg border border-line bg-sheet p-8 text-center shadow-dossier">
        <h1 className="font-display text-2xl font-semibold">{message}</h1>
        {children}
      </div>
    </main>
  );
}
