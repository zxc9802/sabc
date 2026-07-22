import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DIMENSIONS } from "@/lib/rubric/catalog";
import type {
  AssessmentRecord,
  FinalAssessmentRecord,
  FinalReportRecord,
  ProjectRecord,
} from "@/lib/storage/db";

import { ComparisonView } from "./comparison-view";
import { ProjectPicker } from "./project-picker";

function record(
  index: number,
  rubricVersion = "2026-07-22.v1",
): FinalAssessmentRecord {
  const project: ProjectRecord = {
    id: `project-${index}`,
    name: `项目 ${index}`,
    description: `项目 ${index} 描述`,
    primaryCategory: "software",
    status: "provisional",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: `2026-07-22T00:00:0${index}.000Z`,
  };
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((dimension) => [
      dimension.key,
      {
        proposedScore: 4,
        appliedScore: index % 2 === 0 ? 3 : 4,
        weightedScore: 10,
        confidence: 60 + index,
        facts: [`${dimension.label}事实`],
        deductions: [],
        evidence: [],
      },
    ]),
  ) as AssessmentRecord["scored"]["dimensions"];
  const risk = {
    ruleId: "resource_gap" as const,
    state: "suspected" as const,
    reason: `项目 ${index} 的开发资源未确认`,
    evidence: [],
  };
  const assessment: AssessmentRecord = {
    id: `assessment-${index}`,
    projectId: project.id,
    promptVersion: "test.v1",
    sources: [],
    researchStatus: "not_needed",
    analysis: {
      projectName: project.name,
      primaryCategory: "software",
      secondaryCategories: [],
      categoryReason: "软件项目",
      dimensions: [],
      vetoRisks: [risk],
      criticalUnknowns: [],
      questionCandidates: [],
      research: { needed: false, reason: "", queries: [] },
    },
    scored: {
      rubricVersion,
      dimensions,
      totalScoreRaw: 60 + index,
      totalScore: 60 + index,
      confidence: 60 + index,
      provisionalGrade: "B",
      eligibleFinalGrade: "B",
      status: "provisional",
      suspectedVetoes: [risk],
      confirmedVetoes: [],
      criticalUnknowns: [],
    },
    nextQuestion: null,
    diff: null,
    createdAt: `2026-07-22T00:00:0${index}.000Z`,
  };
  const report: FinalReportRecord = {
    id: `report-${index}`,
    projectId: project.id,
    assessmentId: assessment.id,
    assessmentSnapshot: structuredClone(assessment),
    content: {
      decisionSummary: "先验证再投入",
      opportunities: [],
      risks: [risk.reason],
      confirmedFacts: [],
      assumptionsAndGaps: [],
      nextActions: [`项目 ${index} 下一步：访谈客户`],
      upgradeConditions: [],
      conversationSummary: [],
    },
    createdAt: `2026-07-22T00:00:0${index}.000Z`,
  };
  return { project, assessment, report };
}

describe("ProjectPicker", () => {
  it("rejects a fifth project with a clear limit message", async () => {
    const user = userEvent.setup();
    const records = [1, 2, 3, 4, 5].map((index) => record(index));
    const onSelectionChange = vi.fn();
    render(
      <ProjectPicker
        records={records}
        defaultSelectedIds={records.slice(0, 4).map((item) => item.project.id)}
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "项目 5" }));

    expect(screen.getByRole("alert")).toHaveTextContent("最多只能选择 4 个项目");
    expect(screen.getByRole("checkbox", { name: "项目 5" })).not.toBeChecked();
    expect(onSelectionChange).not.toHaveBeenCalledWith(
      expect.arrayContaining(["project-5"]),
    );
  });
});

describe("ComparisonView", () => {
  it("compares saved snapshots without recalculating their scores", () => {
    const records = [record(1), record(2)];
    render(<ComparisonView records={records} />);

    expect(screen.getByRole("table", { name: "项目评级对比" })).toBeVisible();
    for (const dimension of DIMENSIONS) {
      expect(
        screen.getByRole("row", { name: new RegExp(dimension.label) }),
      ).toBeVisible();
    }
    expect(screen.getByRole("row", { name: /关键风险/ })).toHaveTextContent(
      "开发资源未确认",
    );
    expect(screen.getByRole("row", { name: /下一步行动/ })).toHaveTextContent(
      "访谈客户",
    );
    expect(screen.getByRole("columnheader", { name: "项目 1" })).toBeVisible();
    expect(screen.getByText("61 分")).toBeVisible();
  });

  it("warns when compared snapshots use different rubric versions", () => {
    render(
      <ComparisonView
        records={[record(1, "2026-07-22.v1"), record(2, "2026-08-01.v2")]}
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(
      "规则版本不同，分数仅供参考",
    );
  });
});
