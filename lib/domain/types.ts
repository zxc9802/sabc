export type CategoryId =
  | "software"
  | "ecommerce"
  | "content"
  | "local_service"
  | "internal_efficiency"
  | "investment"
  | "general";

export type DimensionKey =
  | "strategic_value"
  | "demand_evidence"
  | "return_potential"
  | "execution_feasibility"
  | "resource_fit"
  | "timing_differentiation"
  | "risk_control";

export type EvidenceState =
  | "missing"
  | "general_claim"
  | "specific_unverified"
  | "verified";

export type Grade = "S" | "A" | "B" | "C";
export type ProjectStatus = "draft" | "provisional" | "final";
export type VetoState = "suspected" | "confirmed" | "cleared";
export type InterviewDepth = "low" | "medium" | "high";

export type EvidenceOrigin = "user_input" | "external_source" | "model_inference";

export interface EvidenceItem {
  slotId: string;
  statement: string;
  state: EvidenceState;
  origin: EvidenceOrigin;
  sourceMessageId?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  observedAt?: string;
}

export interface SourceReference {
  title: string;
  url: string;
}

export interface DimensionAnalysis {
  dimension: DimensionKey;
  proposedScore: 0 | 1 | 2 | 3 | 4 | 5;
  facts: string[];
  deductions: string[];
  evidence: EvidenceItem[];
}

export interface VetoRisk {
  ruleId:
    | "illegal_or_unethical"
    | "impossible_in_window"
    | "resource_gap"
    | "untestable_core_assumption"
    | "team_survival";
  state: VetoState;
  reason: string;
  evidence: EvidenceItem[];
}

export interface QuestionCandidate {
  id: string;
  prompt: string;
  reason: string;
  targetDimension: DimensionKey;
  impact: number;
  quickOptions: string[];
  addressesVetoRuleId?: VetoRisk["ruleId"];
}

export interface AskedQuestion {
  id: string;
  targetDimension: DimensionKey;
}

export interface RubricDimension {
  key: DimensionKey;
  label: string;
  weight: number;
  question: string;
}

export interface EvidenceSlot {
  id: string;
  label: string;
  description: string;
}

export interface CategoryRubric {
  version: string;
  category: CategoryId;
  label: string;
  slots: Record<DimensionKey, EvidenceSlot[]>;
}
