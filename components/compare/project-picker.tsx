"use client";

import { useState } from "react";

import type { FinalAssessmentRecord } from "@/lib/storage/db";

interface ProjectPickerProps {
  records: FinalAssessmentRecord[];
  defaultSelectedIds?: string[];
  onSelectionChange: (projectIds: string[]) => void;
}

const MAX_PROJECTS = 4;

export function ProjectPicker({
  records,
  defaultSelectedIds = [],
  onSelectionChange,
}: ProjectPickerProps) {
  const [selectedIds, setSelectedIds] = useState(
    defaultSelectedIds.slice(0, MAX_PROJECTS),
  );
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

  function toggle(projectId: string): void {
    const selected = selectedIds.includes(projectId);
    if (!selected && selectedIds.length >= MAX_PROJECTS) {
      setLimitMessage("最多只能选择 4 个项目，请先取消一个项目。");
      return;
    }

    const next = selected
      ? selectedIds.filter((id) => id !== projectId)
      : [...selectedIds, projectId];
    setSelectedIds(next);
    setLimitMessage(null);
    onSelectionChange(next);
  }

  return (
    <fieldset className="border border-line bg-paper p-4">
      <legend className="px-2 font-display text-lg font-semibold">选择对比案卷</legend>
      <p className="text-xs leading-5 text-muted">可选择 2–4 个已产生评级的项目，旧快照不会重新计算。</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {records.map(({ project }) => {
          const selected = selectedIds.includes(project.id);
          return (
            <label
              key={project.id}
              className={`flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-sm ${selected ? "border-decision bg-[#e9efff] text-decision" : "border-line bg-white"}`}
            >
              <input
                type="checkbox"
                aria-label={project.name}
                checked={selected}
                onChange={() => toggle(project.id)}
              />
              <span>{project.name}</span>
              <span className="font-mono text-[10px] text-muted">{project.status === "final" ? "已定级" : "临时"}</span>
            </label>
          );
        })}
      </div>
      {limitMessage ? (
        <p role="alert" className="mt-3 border-l-2 border-annotation pl-3 text-sm text-annotation">
          {limitMessage}
        </p>
      ) : null}
    </fieldset>
  );
}
