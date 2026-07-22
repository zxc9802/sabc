export type WorkflowStage = "interview" | "research" | "advisor" | "report";

const stages: Array<{ key: WorkflowStage; label: string }> = [
  { key: "interview", label: "信息访谈" },
  { key: "research", label: "联网调研" },
  { key: "advisor", label: "评估讨论" },
  { key: "report", label: "最终报告" },
];

interface StageRailProps {
  active: WorkflowStage;
}

export function StageRail({ active }: StageRailProps) {
  const activeIndex = stages.findIndex(({ key }) => key === active);

  return (
    <nav aria-label="项目评估进度" className="mb-5 border border-line bg-sheet px-5 py-4">
      <ol className="grid gap-3 sm:grid-cols-4">
        {stages.map((stage, index) => {
          const current = index === activeIndex;
          const state = current ? "current" : index < activeIndex ? "complete" : "pending";
          return (
            <li key={stage.key} className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center border border-line font-mono text-[10px] text-muted"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                aria-current={current ? "step" : undefined}
                data-state={state}
                className="text-xs font-semibold data-[state=current]:text-decision data-[state=pending]:text-muted"
              >
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
