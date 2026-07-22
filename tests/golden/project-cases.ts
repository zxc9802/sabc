import type {
  CategoryId,
  DimensionAnalysis,
  EvidenceState,
  Grade,
  VetoRisk,
} from "@/lib/domain/types";
import { DIMENSIONS, getRubric } from "@/lib/rubric/catalog";

export interface GoldenProjectCase {
  id: string;
  label: string;
  category: CategoryId;
  dimensions: DimensionAnalysis[];
  vetoRisks: VetoRisk[];
  expectedTotalRange: [number, number];
  expectedConfidenceRange: [number, number];
  expectedGrade: Grade;
}

export const goldenProjectCases: GoldenProjectCase[] = [
  caseWithEvidence({
    id: "software-paid-pilot",
    label: "软件：已付费试点且交付可行",
    category: "software",
    proposedScores: [4, 4, 4, 4, 4, 4, 4],
    evidenceState: "verified",
    expectedTotalRange: [80, 80],
    expectedConfidenceRange: [100, 100],
    expectedGrade: "A",
  }),
  caseWithEvidence({
    id: "ecommerce-margin-inventory",
    label: "电商：毛利偏弱且存在库存暴露",
    category: "ecommerce",
    proposedScores: [3, 3, 2, 3, 3, 3, 3],
    evidenceState: "verified",
    expectedTotalRange: [50, 60],
    expectedConfidenceRange: [100, 100],
    expectedGrade: "B",
    vetoRisks: [suspected("resource_gap", "库存资金占用仍需验证")],
  }),
  caseWithEvidence({
    id: "content-audience-claim",
    label: "内容：声称大受众但没有可核查证据",
    category: "content",
    proposedScores: [4, 4, 4, 4, 4, 4, 4],
    evidenceState: "general_claim",
    expectedTotalRange: [40, 40],
    expectedConfidenceRange: [35, 35],
    expectedGrade: "B",
  }),
  caseWithEvidence({
    id: "local-service-license",
    label: "本地服务：确认违反许可要求",
    category: "local_service",
    proposedScores: [4, 4, 4, 4, 4, 4, 4],
    evidenceState: "verified",
    expectedTotalRange: [80, 80],
    expectedConfidenceRange: [100, 100],
    expectedGrade: "C",
    vetoRisks: [confirmed("illegal_or_unethical", "业务缺少法定经营许可")],
  }),
  caseWithEvidence({
    id: "internal-efficiency-payback",
    label: "内部效率：节省工时已验证且回收期短",
    category: "internal_efficiency",
    proposedScores: [4, 4, 5, 4, 4, 3, 4],
    evidenceState: "verified",
    expectedTotalRange: [82, 82],
    expectedConfidenceRange: [100, 100],
    expectedGrade: "A",
  }),
  caseWithEvidence({
    id: "investment-team-survival",
    label: "投资：极端损失威胁团队且没有止损",
    category: "investment",
    proposedScores: [4, 4, 5, 3, 2, 4, 1],
    evidenceState: "verified",
    expectedTotalRange: [60, 75],
    expectedConfidenceRange: [100, 100],
    expectedGrade: "C",
    vetoRisks: [confirmed("team_survival", "最坏损失将耗尽团队现金且没有止损线")],
  }),
  caseWithEvidence({
    id: "general-verified-high-score",
    label: "通用：高分主张均有已验证证据",
    category: "general",
    proposedScores: [5, 5, 5, 5, 5, 5, 5],
    evidenceState: "verified",
    expectedTotalRange: [100, 100],
    expectedConfidenceRange: [100, 100],
    expectedGrade: "S",
  }),
];

function caseWithEvidence(input: {
  id: string;
  label: string;
  category: CategoryId;
  proposedScores: Array<0 | 1 | 2 | 3 | 4 | 5>;
  evidenceState: EvidenceState;
  expectedTotalRange: [number, number];
  expectedConfidenceRange: [number, number];
  expectedGrade: Grade;
  vetoRisks?: VetoRisk[];
}): GoldenProjectCase {
  const rubric = getRubric(input.category);
  const dimensions: DimensionAnalysis[] = DIMENSIONS.map((dimension, index) => ({
    dimension: dimension.key,
    proposedScore: input.proposedScores[index],
    facts: [`${input.label}：${dimension.label}事实`],
    deductions: [],
    evidence: rubric.slots[dimension.key].map((slot) => ({
      slotId: slot.id,
      statement: `${slot.label}的固定测试证据`,
      state: input.evidenceState,
      origin: "user_input",
      sourceMessageId: `message-${input.id}`,
    })),
  }));

  return {
    id: input.id,
    label: input.label,
    category: input.category,
    dimensions,
    vetoRisks: input.vetoRisks ?? [],
    expectedTotalRange: input.expectedTotalRange,
    expectedConfidenceRange: input.expectedConfidenceRange,
    expectedGrade: input.expectedGrade,
  };
}

function suspected(ruleId: VetoRisk["ruleId"], reason: string): VetoRisk {
  return { ruleId, state: "suspected", reason, evidence: [] };
}

function confirmed(ruleId: VetoRisk["ruleId"], reason: string): VetoRisk {
  return {
    ruleId,
    state: "confirmed",
    reason,
    evidence: [
      {
        slotId: `veto-${ruleId}`,
        statement: reason,
        state: "verified",
        origin: "user_input",
        sourceMessageId: `message-${ruleId}`,
      },
    ],
  };
}
