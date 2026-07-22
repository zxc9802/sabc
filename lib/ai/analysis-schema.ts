import type { CategoryId, DimensionKey } from "@/lib/domain/types";
import { RUBRIC_VERSION } from "@/lib/rubric/catalog";
import { z } from "zod";

const categoryIdSchema: z.ZodType<CategoryId> = z.enum([
  "software",
  "ecommerce",
  "content",
  "local_service",
  "internal_efficiency",
  "investment",
  "general",
]);

const dimensionKeySchema: z.ZodType<DimensionKey> = z.enum([
  "strategic_value",
  "demand_evidence",
  "return_potential",
  "execution_feasibility",
  "resource_fit",
  "timing_differentiation",
  "risk_control",
]);

const evidenceItemSchema = z.strictObject({
  slotId: z.string().min(1),
  statement: z.string(),
  state: z.enum([
    "missing",
    "general_claim",
    "specific_unverified",
    "verified",
  ]),
  origin: z.enum(["user_input", "external_source", "model_inference"]),
  sourceMessageId: z.string().optional(),
  sourceTitle: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  observedAt: z.string().optional(),
});

const dimensionAnalysisSchema = z.strictObject({
  dimension: dimensionKeySchema,
  proposedScore: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  facts: z.array(z.string()),
  deductions: z.array(z.string()),
  evidence: z.array(evidenceItemSchema),
});

const vetoRuleIdSchema = z.enum([
  "illegal_or_unethical",
  "impossible_in_window",
  "resource_gap",
  "untestable_core_assumption",
  "team_survival",
]);

const vetoRiskSchema = z.strictObject({
  ruleId: vetoRuleIdSchema,
  state: z.enum(["suspected", "confirmed", "cleared"]),
  reason: z.string(),
  evidence: z.array(evidenceItemSchema),
});

const questionCandidateSchema = z.strictObject({
  id: z.string().min(1),
  prompt: z.string().min(1),
  reason: z.string(),
  targetDimension: dimensionKeySchema,
  impact: z.number().int().min(0).max(100),
  quickOptions: z.array(z.string()).max(4),
  addressesVetoRuleId: vetoRuleIdSchema.optional(),
});

export const analysisResponseSchema = z.strictObject({
  projectName: z.string().min(1),
  primaryCategory: categoryIdSchema,
  secondaryCategories: z.array(categoryIdSchema),
  categoryReason: z.string(),
  dimensions: z
    .array(dimensionAnalysisSchema)
    .length(7)
    .refine(
      (dimensions) =>
        new Set(dimensions.map((dimension) => dimension.dimension)).size === 7,
      { message: "dimensions must contain exactly 7 unique keys" },
    ),
  vetoRisks: z.array(vetoRiskSchema),
  criticalUnknowns: z.array(z.string()),
  questionCandidates: z.array(questionCandidateSchema).max(6),
  research: z.strictObject({
    needed: z.boolean(),
    reason: z.string(),
    queries: z.array(z.string()).max(3),
  }),
});

export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;

export const classificationResponseSchema = z.strictObject({
  projectName: z.string().min(1),
  primaryCategory: categoryIdSchema,
  secondaryCategories: z.array(categoryIdSchema),
  categoryReason: z.string(),
});

export type ClassificationResponse = z.infer<
  typeof classificationResponseSchema
>;

export function validateAnalysisResponse(data: unknown): AnalysisResponse {
  return analysisResponseSchema.parse(data);
}

export function validateClassificationResponse(
  data: unknown,
): ClassificationResponse {
  return classificationResponseSchema.parse(data);
}

export { RUBRIC_VERSION };
