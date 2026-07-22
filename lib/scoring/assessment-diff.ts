import type { DimensionKey, Grade } from "@/lib/domain/types";
import type { ScoredAssessment } from "./score-assessment";
import { DIMENSIONS } from "@/lib/rubric/catalog";

export interface DimensionChange {
  dimension: DimensionKey;
  scoreDelta: number;
  confidenceDelta: number;
  newFacts: string[];
}

export interface GradeChange {
  from: Grade;
  to: Grade;
}

export interface AssessmentDiff {
  gradeChange: GradeChange | null;
  scoreDelta: number;
  confidenceDelta: number;
  changedDimensions: DimensionChange[];
  newEvidenceStatements: string[];
  summary: string;
}

export function diffAssessments(
  previous: ScoredAssessment | null,
  current: ScoredAssessment
): AssessmentDiff {
  if (!previous) {
    return {
      gradeChange: null,
      scoreDelta: current.totalScore,
      confidenceDelta: current.confidence,
      changedDimensions: [],
      newEvidenceStatements: collectEvidenceStatements(current),
      summary: `首次评级：${current.provisionalGrade}，${current.totalScore} 分，置信度 ${current.confidence}%。`,
    };
  }

  const gradeChange: GradeChange | null =
    previous.provisionalGrade !== current.provisionalGrade
      ? { from: previous.provisionalGrade, to: current.provisionalGrade }
      : null;

  const scoreDelta = current.totalScore - previous.totalScore;
  const confidenceDelta = current.confidence - previous.confidence;

  const changedDimensions: DimensionChange[] = [];
  for (const dim of DIMENSIONS) {
    const prevDim = previous.dimensions[dim.key];
    const currDim = current.dimensions[dim.key];
    const scoreDeltaDim = currDim.appliedScore - prevDim.appliedScore;
    const confidenceDeltaDim = currDim.confidence - prevDim.confidence;
    const newFacts = currDim.facts.filter(
      (fact) => !prevDim.facts.includes(fact)
    );

    if (
      scoreDeltaDim !== 0 ||
      confidenceDeltaDim !== 0 ||
      newFacts.length > 0
    ) {
      changedDimensions.push({
        dimension: dim.key,
        scoreDelta: scoreDeltaDim,
        confidenceDelta: confidenceDeltaDim,
        newFacts,
      });
    }
  }

  const previousStatements = collectEvidenceStatements(previous);
  const newEvidenceStatements = collectEvidenceStatements(current).filter(
    (s) => !previousStatements.includes(s)
  );

  const summary = buildSummary(
    gradeChange,
    scoreDelta,
    confidenceDelta,
    changedDimensions,
    newEvidenceStatements
  );

  return {
    gradeChange,
    scoreDelta,
    confidenceDelta,
    changedDimensions,
    newEvidenceStatements,
    summary,
  };
}

function collectEvidenceStatements(assessment: ScoredAssessment): string[] {
  const statements: string[] = [];
  for (const dim of Object.values(assessment.dimensions)) {
    for (const ev of dim.evidence) {
      statements.push(ev.statement);
    }
  }
  return [...new Set(statements)];
}

function buildSummary(
  gradeChange: GradeChange | null,
  scoreDelta: number,
  confidenceDelta: number,
  changedDimensions: DimensionChange[],
  newEvidenceStatements: string[]
): string {
  const parts: string[] = [];

  if (gradeChange) {
    parts.push(
      `等级从 ${gradeChange.from} 变为 ${gradeChange.to}`
    );
  }

  if (scoreDelta !== 0) {
    parts.push(`总分变化 ${scoreDelta > 0 ? "+" : ""}${scoreDelta} 分`);
  }

  if (confidenceDelta !== 0) {
    parts.push(
      `置信度变化 ${confidenceDelta > 0 ? "+" : ""}${confidenceDelta}%`
    );
  }

  if (changedDimensions.length > 0) {
    const dimLabels = changedDimensions
      .map((d) => {
        const label = DIMENSIONS.find((dim) => dim.key === d.dimension)?.label ?? d.dimension;
        return label;
      })
      .join("、");
    parts.push(`变化维度：${dimLabels}`);
  }

  if (newEvidenceStatements.length > 0) {
    const fact = newEvidenceStatements[0];
    const display = fact.length > 30 ? `${fact.slice(0, 30)}…` : fact;
    parts.push(`新增依据：${display}`);
  }

  return parts.join("；") || "评级未发生变化";
}

