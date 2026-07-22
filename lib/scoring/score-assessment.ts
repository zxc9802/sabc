import type {
  CategoryId,
  DimensionAnalysis,
  DimensionKey,
  EvidenceItem,
  EvidenceState,
  Grade,
  ProjectStatus,
  VetoRisk,
} from "@/lib/domain/types";
import { DIMENSIONS, getRubric, RUBRIC_VERSION } from "@/lib/rubric/catalog";

const EVIDENCE_VALUE: Record<EvidenceState, number> = {
  missing: 0,
  general_claim: 0.35,
  specific_unverified: 0.7,
  verified: 1,
};

const SCORE_CAP: Record<EvidenceState, number> = {
  missing: 1,
  general_claim: 2,
  specific_unverified: 4,
  verified: 5,
};

export interface ScoredDimension {
  proposedScore: number;
  appliedScore: number;
  weightedScore: number;
  confidence: number;
  facts: string[];
  deductions: string[];
  evidence: EvidenceItem[];
}

export interface ScoredAssessment {
  rubricVersion: string;
  dimensions: Record<DimensionKey, ScoredDimension>;
  totalScoreRaw: number;
  totalScore: number;
  confidence: number;
  provisionalGrade: Grade;
  eligibleFinalGrade: Grade;
  status: ProjectStatus;
  suspectedVetoes: VetoRisk[];
  confirmedVetoes: VetoRisk[];
  criticalUnknowns: string[];
}

export interface ScoreAssessmentInput {
  category: CategoryId;
  dimensions: DimensionAnalysis[];
  vetoRisks: VetoRisk[];
  criticalUnknowns?: string[];
}

export function scoreAssessment(input: ScoreAssessmentInput): ScoredAssessment {
  const rubric = getRubric(input.category);
  const analyses = new Map(
    input.dimensions.map((dimension) => [dimension.dimension, dimension]),
  );
  const scoredDimensions = {} as Record<DimensionKey, ScoredDimension>;
  let totalScoreRaw = 0;
  let proposedTotalRaw = 0;
  let weightedConfidence = 0;

  for (const definition of DIMENSIONS) {
    const analysis = analyses.get(definition.key);
    const requiredSlotIds = rubric.slots[definition.key].map((slot) => slot.id);
    const recognizedEvidence =
      analysis?.evidence.filter((item) => requiredSlotIds.includes(item.slotId)) ??
      [];
    const proposedScore = analysis?.proposedScore ?? 0;
    const appliedScore = analysis
      ? Math.min(proposedScore, scoreCapForEvidence(recognizedEvidence))
      : 0;
    const confidenceFraction = confidenceForSlots(
      requiredSlotIds,
      recognizedEvidence,
    );
    const weightedScore = (appliedScore / 5) * definition.weight;

    scoredDimensions[definition.key] = {
      proposedScore,
      appliedScore,
      weightedScore,
      confidence: Math.round(confidenceFraction * 100),
      facts: analysis?.facts ?? [],
      deductions: analysis?.deductions ?? [],
      evidence: analysis?.evidence ?? [],
    };

    totalScoreRaw += weightedScore;
    proposedTotalRaw += (proposedScore / 5) * definition.weight;
    weightedConfidence += confidenceFraction * definition.weight;
  }

  const suspectedVetoes = input.vetoRisks.filter(
    (risk) => risk.state === "suspected",
  );
  const confirmedVetoes = input.vetoRisks.filter(
    (risk) => risk.state === "confirmed",
  );
  const hasConfirmedVeto = confirmedVetoes.length > 0;
  const confidence = Math.round(weightedConfidence);
  const provisionalGrade = hasConfirmedVeto
    ? "C"
    : gradeFromScore(Math.round(proposedTotalRaw));
  const eligibleFinalGrade = eligibleGrade(
    provisionalGrade,
    confidence,
    hasConfirmedVeto,
  );
  const criticalUnknowns = input.criticalUnknowns ?? [];

  return {
    rubricVersion: RUBRIC_VERSION,
    dimensions: scoredDimensions,
    totalScoreRaw,
    totalScore: Math.round(totalScoreRaw),
    confidence,
    provisionalGrade,
    eligibleFinalGrade,
    status: assessmentStatus({
      provisionalGrade,
      confidence,
      hasConfirmedVeto,
      hasSuspectedVeto: suspectedVetoes.length > 0,
      hasCriticalUnknowns: criticalUnknowns.length > 0,
    }),
    suspectedVetoes,
    confirmedVetoes,
    criticalUnknowns,
  };
}

function scoreCapForEvidence(evidence: EvidenceItem[]): number {
  const strongest = evidence.reduce<EvidenceState>((current, item) => {
    return EVIDENCE_VALUE[item.state] > EVIDENCE_VALUE[current]
      ? item.state
      : current;
  }, "missing");

  return SCORE_CAP[strongest];
}

function confidenceForSlots(
  requiredSlotIds: string[],
  evidence: EvidenceItem[],
): number {
  if (requiredSlotIds.length === 0) return 0;

  const values = requiredSlotIds.map((slotId) => {
    const strongest = evidence
      .filter((item) => item.slotId === slotId)
      .reduce<EvidenceState>((current, item) => {
        return EVIDENCE_VALUE[item.state] > EVIDENCE_VALUE[current]
          ? item.state
          : current;
      }, "missing");

    return EVIDENCE_VALUE[strongest];
  });

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function gradeFromScore(score: number): Grade {
  if (score >= 85) return "S";
  if (score >= 70) return "A";
  if (score >= 50) return "B";
  return "C";
}

function eligibleGrade(
  provisionalGrade: Grade,
  confidence: number,
  hasConfirmedVeto: boolean,
): Grade {
  if (hasConfirmedVeto) return "C";
  if (provisionalGrade === "S" && confidence < 80) return "B";
  if (
    (provisionalGrade === "S" || provisionalGrade === "A") &&
    confidence < 65
  ) {
    return "B";
  }
  return provisionalGrade;
}

function assessmentStatus(input: {
  provisionalGrade: Grade;
  confidence: number;
  hasConfirmedVeto: boolean;
  hasSuspectedVeto: boolean;
  hasCriticalUnknowns: boolean;
}): ProjectStatus {
  if (input.hasConfirmedVeto) return "final";
  if (input.hasSuspectedVeto || input.hasCriticalUnknowns) return "provisional";
  if (input.provisionalGrade === "S" && input.confidence < 80) {
    return "provisional";
  }
  if (input.provisionalGrade === "A" && input.confidence < 65) {
    return "provisional";
  }
  return "final";
}
