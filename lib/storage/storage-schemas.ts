import { z } from "zod";

import { analysisResponseSchema } from "@/lib/ai/analysis-schema";

const dimensionSchema = z.enum([
  "strategic_value",
  "demand_evidence",
  "return_potential",
  "execution_feasibility",
  "resource_fit",
  "timing_differentiation",
  "risk_control",
]);
const gradeSchema = z.enum(["S", "A", "B", "C"]);
const statusSchema = z.enum(["draft", "provisional", "final"]);
const isoDateSchema = z.string().datetime();

const evidenceSchema = z.strictObject({
  slotId: z.string().min(1),
  statement: z.string(),
  state: z.enum(["missing", "general_claim", "specific_unverified", "verified"]),
  origin: z.enum(["user_input", "external_source", "model_inference"]),
  sourceMessageId: z.string().optional(),
  sourceTitle: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  observedAt: z.string().optional(),
});

const vetoSchema = z.strictObject({
  ruleId: z.enum([
    "illegal_or_unethical",
    "impossible_in_window",
    "resource_gap",
    "untestable_core_assumption",
    "team_survival",
  ]),
  state: z.enum(["suspected", "confirmed", "cleared"]),
  reason: z.string(),
  evidence: z.array(evidenceSchema),
});

const scoredDimensionSchema = z.strictObject({
  proposedScore: z.number(),
  appliedScore: z.number(),
  weightedScore: z.number(),
  confidence: z.number(),
  facts: z.array(z.string()),
  deductions: z.array(z.string()),
  evidence: z.array(evidenceSchema),
});

const scoredSchema = z.strictObject({
  rubricVersion: z.string().min(1),
  dimensions: z.record(dimensionSchema, scoredDimensionSchema),
  totalScoreRaw: z.number(),
  totalScore: z.number(),
  confidence: z.number(),
  provisionalGrade: gradeSchema,
  eligibleFinalGrade: gradeSchema,
  status: statusSchema,
  suspectedVetoes: z.array(vetoSchema),
  confirmedVetoes: z.array(vetoSchema),
  criticalUnknowns: z.array(z.string()),
});

const questionSchema = z.strictObject({
  id: z.string().min(1),
  prompt: z.string().min(1),
  reason: z.string(),
  targetDimension: dimensionSchema,
  impact: z.number().int().min(0).max(100),
  quickOptions: z.array(z.string()).max(4),
  addressesVetoRuleId: vetoSchema.shape.ruleId.optional(),
});

const assessmentDiffSchema = z.strictObject({
  gradeChange: z.strictObject({ from: gradeSchema, to: gradeSchema }).nullable(),
  scoreDelta: z.number(),
  confidenceDelta: z.number(),
  changedDimensions: z.array(z.strictObject({
    dimension: dimensionSchema,
    scoreDelta: z.number(),
    confidenceDelta: z.number(),
    newFacts: z.array(z.string()),
  })),
  newEvidenceStatements: z.array(z.string()),
  summary: z.string(),
});

export const createProjectSchema = z.strictObject({
  description: z.string().min(1).max(20_000),
});

export const interviewDepthSchema = z.strictObject({
  depth: z.enum(["low", "medium", "high"]),
});

export const messageSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(20_000),
  round: z.number().int().min(0),
  createdAt: isoDateSchema,
  stage: z.enum(["interview", "advisory"]).optional(),
  kind: z.enum(["chat", "advisor_summary"]).optional(),
});

export const researchSnapshotSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1),
  queries: z.array(z.string()),
  sources: z.array(z.strictObject({
    title: z.string().min(1),
    url: z.string().url(),
    snippet: z.string(),
    query: z.string(),
  })),
  status: z.enum(["completed", "partial", "unavailable"]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const assessmentSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1),
  promptVersion: z.string().min(1),
  sources: z.array(z.strictObject({ title: z.string(), url: z.string().url() })),
  researchStatus: z.enum(["not_needed", "completed", "partial", "unavailable"]),
  analysis: analysisResponseSchema,
  scored: scoredSchema,
  nextQuestion: questionSchema.nullable(),
  diff: assessmentDiffSchema.nullable(),
  createdAt: isoDateSchema,
});

const reportContentSchema = z.strictObject({
  decisionSummary: z.string(),
  opportunities: z.array(z.string()),
  risks: z.array(z.string()),
  confirmedFacts: z.array(z.string()),
  userStatements: z.array(z.string()).optional(),
  assumptionsAndGaps: z.array(z.string()),
  nextActions: z.array(z.string()),
  upgradeConditions: z.array(z.string()),
  conversationSummary: z.array(z.string()),
});

export const reportSchema = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1),
  assessmentId: z.string().min(1),
  assessmentSnapshot: assessmentSchema,
  content: reportContentSchema,
  createdAt: isoDateSchema,
});

export const finalizationSchema = z.strictObject({
  assessment: assessmentSchema,
  report: reportSchema,
});

export const projectIdsSchema = z.strictObject({
  projectIds: z.array(z.string().min(1)).max(50),
});
