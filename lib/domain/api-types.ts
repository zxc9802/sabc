import type { AnalysisResponse } from "@/lib/ai/analysis-schema";
import type { AssessmentDiff } from "@/lib/scoring/assessment-diff";
import type { ScoredAssessment } from "@/lib/scoring/score-assessment";
import type { ResearchStatus } from "@/lib/research/research-types";

import type {
  CategoryId,
  QuestionCandidate,
  SourceReference,
} from "./types";

export interface AnalyzeProjectResponse {
  projectId: string;
  projectName: string;
  primaryCategory: CategoryId;
  secondaryCategories: CategoryId[];
  categoryReason: string;
  promptVersion: string;
  analysis: AnalysisResponse;
  scored: ScoredAssessment;
  nextQuestion: QuestionCandidate | null;
  diff: AssessmentDiff;
  sources: SourceReference[];
  researchStatus: "not_needed" | ResearchStatus;
}
