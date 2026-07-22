export type ResearchHandoffPhase =
  | "planning_research"
  | "researching"
  | "analyzing"
  | "scoring"
  | "saving";

interface ResearchProgressError {
  code: string;
  message: string;
  retryable: boolean;
}

interface ResearchProgressProps {
  phase: ResearchHandoffPhase;
  queries: string[];
  sourceCount: number;
  error: ResearchProgressError | null;
  onRetry: () => void;
  onInterviewOnly: () => void;
}

const stages: Array<{
  phase: ResearchHandoffPhase;
  label: string;
  detail: string;
}> = [
  {
    phase: "planning_research",
    label: "提炼公开调研关键词",
    detail: "从访谈中提取可公开检索的市场问题。",
  },
  {
    phase: "researching",
    label: "联网收集市场证据",
    detail: "核对市场、需求、竞争和执行风险。",
  },
  {
    phase: "analyzing",
    label: "AI 综合分析",
    detail: "把访谈事实与调研来源合并判断。",
  },
  {
    phase: "scoring",
    label: "计算 SABC 评级",
    detail: "固定规则形成进入讨论阶段的建议等级。",
  },
  {
    phase: "saving",
    label: "移交阶段评估",
    detail: "保存调研依据并交给项目建议智能体。",
  },
];

export function ResearchProgress({
  phase,
  queries,
  sourceCount,
  error,
  onRetry,
  onInterviewOnly,
}: ResearchProgressProps) {
  const activeIndex = stages.findIndex(({ phase: value }) => value === phase);

  return (
    <section
      aria-live="polite"
      aria-busy={!error}
      className="border border-line bg-sheet px-6 py-7 shadow-dossier sm:px-9 sm:py-9"
    >
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-decision">
            Evidence transfer · A → B
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
            正在调研你的项目
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            第一智能体的访谈已经锁定。系统正在核对公开证据并形成阶段评级，随后自动进入项目建议智能体继续讨论。
          </p>
        </div>
        <span className="border border-line bg-paper px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
          阶段 1 → 阶段 2
        </span>
      </div>

      <ol className="mt-7 grid gap-4 md:grid-cols-5">
        {stages.map((stage, index) => {
          const current = index === activeIndex;
          const complete = index < activeIndex;
          return (
            <li
              key={stage.phase}
              className="research-handoff-step relative border-t-2 border-line pt-4"
              data-state={current ? "current" : complete ? "complete" : "pending"}
            >
              <span className="mb-3 block font-mono text-[10px] text-muted">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                aria-current={current ? "step" : undefined}
                className="block text-sm font-semibold"
              >
                {stage.label}
              </span>
              <span className="mt-2 block text-xs leading-5 text-muted">
                {stage.detail}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-7 grid gap-4 border-t border-line pt-5 md:grid-cols-[1fr_auto]">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            AnySearch 联网搜索 · 实际检索问题
          </p>
          {queries.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {queries.map((query) => (
                <li key={query} className="border border-line bg-paper px-3 py-2 text-xs">
                  {query}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted">正在从访谈中提炼检索问题……</p>
          )}
        </div>
        <p className="self-end border-l-2 border-positive px-4 text-sm font-semibold">
          {sourceCount > 0 ? `已收集 ${sourceCount} 个公开来源` : "正在收集公开来源"}
        </p>
      </div>

      {error ? (
        <div className="mt-7 border-l-2 border-annotation bg-[#fff8f5] px-4 py-4">
          <p className="text-sm leading-6 text-ink">{error.message}</p>
          {error.retryable ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-11 border border-decision px-4 text-sm font-semibold text-decision hover:bg-decision hover:text-white"
                onClick={onRetry}
              >
                {error.code === "research_unavailable"
                  ? "重新调研"
                  : "重试当前阶段"}
              </button>
              {error.code === "research_unavailable" ? (
                <button
                  type="button"
                  className="min-h-11 bg-ink px-4 text-sm font-semibold text-white hover:bg-decision"
                  onClick={onInterviewOnly}
                >
                  仅依据访谈继续
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-7 border-l-2 border-positive px-4 text-sm leading-6 text-muted">
          当前步骤完成后会自动继续，无需停留或重复点击。
        </p>
      )}
    </section>
  );
}
