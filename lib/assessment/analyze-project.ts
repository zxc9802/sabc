import "server-only";

import type { z } from "zod";

import type {
  AnalysisResponse,
  ClassificationResponse,
} from "@/lib/ai/analysis-schema";
import {
  analysisResponseSchema,
  classificationResponseSchema,
} from "@/lib/ai/analysis-schema";
import type { GenerateResult } from "@/lib/ai/deepseek-client";
import {
  buildClassificationPrompt,
  buildRetryPrompt,
  buildSystemPrompt,
} from "@/lib/ai/system-prompt";
import type {
  AskedQuestion,
  EvidenceItem,
  InterviewDepth,
  VetoRisk,
} from "@/lib/domain/types";
import type { AnalyzeProjectResponse } from "@/lib/domain/api-types";
import { detectInterviewCommand } from "@/lib/questions/interview-command";
import { selectNextQuestion } from "@/lib/questions/select-next-question";
import { diffAssessments } from "@/lib/scoring/assessment-diff";
import type { ScoredAssessment } from "@/lib/scoring/score-assessment";
import {
  scoreAssessment,
  type ScoreAssessmentInput,
} from "@/lib/scoring/score-assessment";
import type { ResearchSnapshotRecord } from "@/lib/research/research-types";
import type { StageAssessmentContext } from "@/lib/report/stage-assessment-context";
import { getRubric } from "@/lib/rubric/catalog";

export const PROMPT_VERSION = "2026-07-22.luna.chat.v2";

export interface ModelClient {
  generate(input: {
    systemPrompt: string;
    userPrompt: string;
    signal?: AbortSignal;
  }): Promise<GenerateResult>;
}

export interface AnalyzeProjectInput {
  projectId: string;
  projectDescription: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    round: number;
  }>;
  previousAssessment?: ScoredAssessment;
  questionHistory: AskedQuestion[];
  interviewDepth: InterviewDepth;
  round: number;
  final?: boolean;
  researchSnapshot?: ResearchSnapshotRecord;
  stageAssessment?: StageAssessmentContext;
  signal?: AbortSignal;
}

export type AnalyzeProjectOutput = AnalyzeProjectResponse;

export async function analyzeProject(
  client: ModelClient,
  input: AnalyzeProjectInput,
  score: (input: ScoreAssessmentInput) => ScoredAssessment = scoreAssessment,
): Promise<AnalyzeProjectOutput> {
  validateInputSize(input);

  const classification = await generateValidated(
    client,
    buildClassificationPrompt(),
    JSON.stringify({ projectDescription: input.projectDescription }),
    classificationResponseSchema,
    input.signal,
  );
  const rubric = getRubric(classification.primaryCategory);
  const analysis = await generateValidated(
    client,
    buildSystemPrompt(rubric, {
      externalResearch:
        input.final === true &&
        (input.researchSnapshot?.sources.length ?? 0) > 0,
    }),
    buildAnalysisData(input, classification),
    analysisResponseSchema,
    input.signal,
  );

  analysis.projectName = classification.projectName;
  analysis.primaryCategory = classification.primaryCategory;
  analysis.secondaryCategories = classification.secondaryCategories;
  analysis.categoryReason = classification.categoryReason;
  if (input.final) {
    sanitizeFinalSources(analysis, input.researchSnapshot?.sources ?? []);
  } else {
    sanitizeUnverifiedSources(analysis);
  }
  sanitizeVetoStates(analysis.vetoRisks, input.messages);

  const scored = score({
    category: classification.primaryCategory,
    dimensions: analysis.dimensions,
    vetoRisks: analysis.vetoRisks,
    criticalUnknowns: analysis.criticalUnknowns,
  });
  const latestUserMessage = input.messages.findLast(
    ({ role }) => role === "user",
  );
  const command = detectInterviewCommand(latestUserMessage?.content ?? "");
  const nextQuestion = input.final
    ? null
    : selectNextQuestion({
        candidates: analysis.questionCandidates,
        questionHistory: input.questionHistory,
        suspectedVetoRuleIds: scored.suspectedVetoes.map((risk) => risk.ruleId),
        interviewDepth: input.interviewDepth,
        command,
      });
  const sources = (input.researchSnapshot?.sources ?? []).map(
    ({ title, url }) => ({ title, url }),
  );

  return {
    projectId: input.projectId,
    projectName: classification.projectName,
    primaryCategory: classification.primaryCategory,
    secondaryCategories: classification.secondaryCategories,
    categoryReason: classification.categoryReason,
    promptVersion: PROMPT_VERSION,
    analysis,
    scored,
    nextQuestion,
    diff: diffAssessments(input.previousAssessment ?? null, scored),
    sources,
    researchStatus: input.final
      ? (input.researchSnapshot?.status ?? "unavailable")
      : analysis.research.needed
        ? "unavailable"
        : "not_needed",
  };
}

async function generateValidated<T>(
  client: ModelClient,
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const first = await client.generate({ systemPrompt, userPrompt, signal });

  try {
    return parseAndValidate(first.text, schema);
  } catch {
    const retry = await client.generate({
      systemPrompt: buildRetryPrompt(systemPrompt),
      userPrompt: JSON.stringify({
        originalData: userPrompt,
        previousInvalidOutput: first.text.slice(0, 2_000),
      }),
      signal,
    });

    try {
      return parseAndValidate(retry.text, schema);
    } catch {
      throw new ModelOutputError();
    }
  }
}

function parseAndValidate<T>(text: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(text) as unknown);
}

function buildAnalysisData(
  input: AnalyzeProjectInput,
  classification: ClassificationResponse,
): string {
  return JSON.stringify({
    projectName: classification.projectName,
    projectDescription: input.projectDescription,
    primaryCategory: classification.primaryCategory,
    secondaryCategories: classification.secondaryCategories,
    categoryReason: classification.categoryReason,
    interviewDepth: input.interviewDepth,
    questionHistory: input.questionHistory,
    conversation: input.messages,
    externalResearch: input.researchSnapshot?.sources ?? [],
    researchStatus: input.researchSnapshot?.status ?? "unavailable",
    stageAssessment: input.stageAssessment,
  });
}

function sanitizeFinalSources(
  analysis: AnalysisResponse,
  sources: ResearchSnapshotRecord["sources"],
): void {
  const allowed = new Map(sources.map((source) => [source.url, source]));
  const evidence = [
    ...analysis.dimensions.flatMap((dimension) => dimension.evidence),
    ...analysis.vetoRisks.flatMap((risk) => risk.evidence),
  ];

  for (const item of evidence) {
    const source = item.sourceUrl ? allowed.get(item.sourceUrl) : undefined;
    if (item.origin === "external_source" && source) {
      item.sourceTitle = source.title;
      item.sourceUrl = source.url;
      continue;
    }
    if (item.origin === "external_source" || item.sourceUrl || item.sourceTitle) {
      item.sourceUrl = undefined;
      item.sourceTitle = undefined;
      if (item.origin === "external_source") item.origin = "model_inference";
      if (item.state === "verified") item.state = "specific_unverified";
    }
  }
}

function sanitizeUnverifiedSources(analysis: AnalysisResponse): void {
  const evidence = [
    ...analysis.dimensions.flatMap((dimension) => dimension.evidence),
    ...analysis.vetoRisks.flatMap((risk) => risk.evidence),
  ];

  for (const item of evidence) {
    if (item.sourceUrl || item.sourceTitle || item.origin === "external_source") {
      item.sourceUrl = undefined;
      item.sourceTitle = undefined;
      if (item.origin === "external_source") item.origin = "model_inference";
      if (item.state === "verified") item.state = "specific_unverified";
    }
  }
}

function sanitizeVetoStates(
  vetoRisks: VetoRisk[],
  messages: AnalyzeProjectInput["messages"],
): void {
  const userMessageIds = new Set(
    messages.filter((message) => message.role === "user").map((message) => message.id),
  );

  for (const risk of vetoRisks) {
    if (risk.state !== "confirmed") continue;
    const hasExplicitUserReference = risk.evidence.some(
      (item) =>
        item.origin === "user_input" &&
        item.sourceMessageId !== undefined &&
        userMessageIds.has(item.sourceMessageId),
    );
    if (!hasExplicitUserReference) risk.state = "suspected";
  }
}

function validateInputSize(input: AnalyzeProjectInput): void {
  if (input.projectDescription.length > 20_000) {
    throw new AnalyzeError("项目描述超过 20000 字符限制", "input_too_large");
  }
}

export class AnalyzeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AnalyzeError";
  }
}

export class ModelOutputError extends Error {
  readonly code = "schema_error";

  constructor() {
    super("AI 返回结构校验失败，请重新分析。");
    this.name = "ModelOutputError";
  }
}

export function hasExplicitUserEvidence(
  item: EvidenceItem,
  messages: AnalyzeProjectInput["messages"],
): boolean {
  return (
    item.origin === "user_input" &&
    item.sourceMessageId !== undefined &&
    messages.some(
      (message) =>
        message.role === "user" && message.id === item.sourceMessageId,
    )
  );
}
