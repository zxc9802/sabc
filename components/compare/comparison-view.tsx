import { DIMENSIONS } from "@/lib/rubric/catalog";
import type { FinalAssessmentRecord } from "@/lib/storage/db";

interface ComparisonViewProps {
  records: FinalAssessmentRecord[];
}

export function ComparisonView({ records }: ComparisonViewProps) {
  if (records.length === 0) {
    return (
      <div className="border border-line bg-sheet px-5 py-10 text-center text-sm text-muted">
        请选择至少两个项目开始对比。
      </div>
    );
  }

  const versions = new Set(
    records.map(({ assessment }) => assessment.scored.rubricVersion),
  );

  return (
    <section aria-labelledby="comparison-title" className="mt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Snapshot comparison</p>
          <h2 id="comparison-title" className="mt-1 font-display text-2xl font-semibold">项目评级对比</h2>
        </div>
        <p className="font-mono text-xs text-muted">{records.length} / 4 个案卷</p>
      </div>

      {versions.size > 1 ? (
        <p role="note" className="mt-4 border-l-4 border-warning bg-[#fff9ea] px-4 py-3 text-sm text-warning">
          规则版本不同，分数仅供参考。请优先比较证据、风险和行动条件。
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto border border-line bg-sheet">
        <table aria-label="项目评级对比" className="comparison-table w-full min-w-[760px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b-2 border-ink bg-paper">
              <th scope="col" className="sticky left-0 z-10 min-w-36 border-r border-line bg-paper px-4 py-3 font-semibold">对比项</th>
              {records.map(({ project, assessment }) => (
                <th key={project.id} scope="col" aria-label={project.name} className="min-w-48 border-r border-line px-4 py-3 last:border-0">
                  <span className="block font-display text-lg">{project.name}</span>
                  <span className="mt-1 block font-mono text-[10px] font-normal text-muted">
                    {assessment.scored.status === "final" ? "最终" : "临时"} · {assessment.scored.rubricVersion}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <ComparisonRow label="等级">
              {records.map(({ project, assessment }) => (
                <td key={project.id} className="border-r border-line px-4 py-3 last:border-0">
                  <strong className={`font-display text-2xl grade-text-${assessment.scored.eligibleFinalGrade.toLowerCase()}`}>
                    {assessment.scored.eligibleFinalGrade}
                  </strong>
                </td>
              ))}
            </ComparisonRow>
            <ComparisonRow label="总分">
              {records.map(({ project, assessment }) => (
                <td key={project.id} className="border-r border-line px-4 py-3 font-mono last:border-0">{assessment.scored.totalScore} 分</td>
              ))}
            </ComparisonRow>
            <ComparisonRow label="证据置信度">
              {records.map(({ project, assessment }) => (
                <td key={project.id} className="border-r border-line px-4 py-3 font-mono last:border-0">{assessment.scored.confidence}%</td>
              ))}
            </ComparisonRow>

            {DIMENSIONS.map((dimension) => (
              <ComparisonRow key={dimension.key} label={`${dimension.label}（${dimension.weight}%）`}>
                {records.map(({ project, assessment }) => {
                  const score = assessment.scored.dimensions[dimension.key];
                  return (
                    <td key={project.id} className="border-r border-line px-4 py-3 last:border-0">
                      <span className="font-mono font-semibold">{score?.appliedScore ?? 0} / 5</span>
                      <span className="ml-2 text-xs text-muted">证据 {score?.confidence ?? 0}%</span>
                    </td>
                  );
                })}
              </ComparisonRow>
            ))}

            <ComparisonRow label="关键风险">
              {records.map(({ project, assessment }) => {
                const risks = [
                  ...assessment.scored.confirmedVetoes,
                  ...assessment.scored.suspectedVetoes,
                ];
                return (
                  <td key={project.id} className="border-r border-line px-4 py-3 leading-6 last:border-0">
                    {risks.length > 0 ? risks.map((risk) => risk.reason).join("；") : "未发现否决风险"}
                  </td>
                );
              })}
            </ComparisonRow>
            <ComparisonRow label="下一步行动">
              {records.map(({ project, assessment, report }) => (
                <td key={project.id} className="border-r border-line px-4 py-3 leading-6 last:border-0">
                  {report?.content.nextActions[0] ?? assessment.nextQuestion?.prompt ?? "暂无"}
                </td>
              ))}
            </ComparisonRow>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComparisonRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <tr className="border-b border-line last:border-0">
      <th scope="row" className="sticky left-0 z-10 border-r border-line bg-[#fbfcfe] px-4 py-3 font-semibold">
        {label}
      </th>
      {children}
    </tr>
  );
}
