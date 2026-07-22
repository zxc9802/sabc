import type {
  DimensionKey,
  Grade,
  SourceReference,
} from "@/lib/domain/types";
import { DIMENSIONS } from "@/lib/rubric/catalog";
import type {
  AssessmentRecord,
  ProjectRecord,
} from "@/lib/storage/db";
import type {
  ResearchSnapshotRecord,
  ResearchStatus,
} from "@/lib/research/research-types";

export interface AdvisorContext {
  projectId: string;
  projectName: string;
  projectDescription: string;
  categoryReason: string;
  grade: Grade;
  totalScore: number;
  confidence: number;
  researchStatus: "not_needed" | ResearchStatus;
  dimensions: Array<{
    key: DimensionKey;
    appliedScore: number;
    facts: string[];
    deductions: string[];
  }>;
  sources: SourceReference[];
}

export function createAdvisorContext(
  project: ProjectRecord,
  assessment: AssessmentRecord,
  researchSnapshot: ResearchSnapshotRecord | null,
): AdvisorContext {
  const sources = researchSnapshot?.sources ?? assessment.sources;
  return {
    projectId: project.id,
    projectName: project.name,
    projectDescription: project.description,
    categoryReason: assessment.analysis.categoryReason,
    grade: assessment.scored.eligibleFinalGrade,
    totalScore: assessment.scored.totalScore,
    confidence: assessment.scored.confidence,
    researchStatus: assessment.researchStatus,
    dimensions: DIMENSIONS.map(({ key }) => {
      const dimension = assessment.scored.dimensions[key];
      return {
        key,
        appliedScore: dimension.appliedScore,
        facts: dimension.facts.slice(0, 8),
        deductions: dimension.deductions.slice(0, 8),
      };
    }),
    sources: sources.map(({ title, url }) => ({ title, url })),
  };
}
