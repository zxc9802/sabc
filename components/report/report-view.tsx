"use client";

import Link from "next/link";

import { DIMENSIONS } from "@/lib/rubric/catalog";
import type {
  FinalReportRecord,
  ProjectRecord,
  ReportContent,
} from "@/lib/storage/db";

interface ReportViewProps {
  project: ProjectRecord;
  report: FinalReportRecord;
}

export function ReportView({ project, report }: ReportViewProps) {
  const assessment = report.assessmentSnapshot;
  const grade = assessment.scored.eligibleFinalGrade;

  return (
    <article className="border border-line bg-white shadow-dossier">
      <header className="border-b-2 border-ink px-5 py-6 sm:px-8">
        <div className="report-actions flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-decision">
              Final assessment · 已保存
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold leading-tight">
              最终项目评估报告
            </h1>
            <p className="mt-3 text-sm leading-7 text-muted">
              本报告综合第一阶段访谈、联网调研和第二智能体讨论生成。
            </p>
          </div>
          <div className="flex flex-wrap items-start justify-end gap-3">
            <div
              aria-label="报告等级"
              className={`grade-${grade.toLowerCase()} grid size-20 place-items-center border-2 font-display text-5xl`}
            >
              {grade}
            </div>
            <div className="grid gap-2">
              <button
                type="button"
                className="min-h-11 border border-ink px-3 text-xs font-semibold hover:bg-ink hover:text-white"
                onClick={() => window.print()}
              >
                导出 PDF
              </button>
              <Link
                className="inline-flex min-h-11 items-center border border-decision px-3 text-xs font-semibold text-decision hover:bg-decision hover:text-white"
                href={`/advisor/${encodeURIComponent(project.id)}`}
              >
                返回第二智能体继续讨论
              </Link>
            </div>
          </div>
        </div>
        <div className="mt-6 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
          <Meta label="项目" value={project.name} />
          <Meta label="最终得分" value={`${assessment.scored.totalScore} 分`} />
          <Meta
            label="证据强度"
            value={`证据置信度 ${assessment.scored.confidence}%`}
          />
        </div>
      </header>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="px-5 py-2 sm:px-8">
          <SummarySection title="综合判断">
            <p className="leading-8">{report.content.decisionSummary}</p>
          </SummarySection>
          <SummarySection title="市场调研结论">
            <BulletList
              items={report.content.confirmedFacts}
              empty={researchFallback(assessment.researchStatus)}
            />
          </SummarySection>
          <div className="grid gap-x-8 md:grid-cols-2">
            <SummarySection title="项目机会">
              <BulletList items={report.content.opportunities} empty="暂无明确机会" />
            </SummarySection>
            <SummarySection title="核心风险">
              <BulletList items={report.content.risks} empty="暂无关键风险" />
            </SummarySection>
          </div>
          <SummarySection title="仍需补齐的信息">
            <BulletList
              items={report.content.assumptionsAndGaps}
              empty="暂无关键证据缺口"
            />
          </SummarySection>
          <SummarySection title="建议立即执行的行动">
            <NumberedList items={report.content.nextActions} />
          </SummarySection>
          <SummarySection title="升级条件">
            <BulletList
              items={report.content.upgradeConditions}
              empty="暂无额外升级条件"
            />
          </SummarySection>
          <SummarySection title="两阶段对话摘要">
            <BulletList
              items={report.content.conversationSummary}
              empty="暂无可用对话摘要"
            />
          </SummarySection>
        </div>

        <aside className="border-t border-line bg-[#f7f9fd] px-5 py-6 sm:px-7 lg:border-l lg:border-t-0">
          <h2 className="font-display text-xl font-semibold">七维评级依据</h2>
          <div className="mt-4 space-y-4">
            {DIMENSIONS.map(({ key, label }) => {
              const dimension = assessment.scored.dimensions[key];
              return (
                <div key={key} data-testid="report-dimension">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold">{label}</span>
                    <span className="font-mono text-xs">
                      {dimension.appliedScore} / 5
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 bg-[#dbe2eb]">
                    <span
                      className="block h-full bg-decision"
                      style={{ width: `${dimension.appliedScore * 20}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <h2 className="mt-7 border-t border-line pt-6 font-display text-xl font-semibold">
            调研来源
          </h2>
          {assessment.sources.length > 0 ? (
            <ul className="mt-3 space-y-3">
              {assessment.sources.map((source) => {
                const href = safeHttpUrl(source.url);
                return (
                  <li key={`${source.title}-${source.url}`} className="text-xs leading-5">
                    {href ? (
                      <a
                        className="report-source break-all text-decision underline"
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.title}
                      </a>
                    ) : (
                      <span>{source.title}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-xs leading-5 text-muted">
              本次没有可用的公开调研来源，结论仅依据对话材料。
            </p>
          )}
        </aside>
      </div>
    </article>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function SummarySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line py-6 last:border-0">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <div className="mt-3 text-sm leading-7">{children}</div>
    </section>
  );
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="border-l-2 border-evidence pl-3">
          {item}
        </li>
      ))}
    </ul>
  );
}

function NumberedList({ items }: { items: ReportContent["nextActions"] }) {
  if (items.length === 0) return <p className="text-muted">暂无下一步行动</p>;
  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={item} className="grid grid-cols-[2rem_1fr] gap-2">
          <span className="font-mono text-xs text-decision">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function researchFallback(
  status: FinalReportRecord["assessmentSnapshot"]["researchStatus"],
): string {
  if (status === "partial") return "公开调研仅部分完成，当前结论存在来源缺口。";
  if (status === "unavailable") return "公开调研不可用，当前结论仅依据对话材料。";
  return "暂无单独列出的已确认公开事实。";
}
