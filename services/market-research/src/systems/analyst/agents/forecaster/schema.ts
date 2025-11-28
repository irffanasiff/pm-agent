/**
 * Forecaster Output Schema
 * Zod schema for validating forecaster output
 *
 * Supports both legacy mode and new orchestrator mode with phases:
 * - DECOMPOSE: craft research questions
 * - ANALYZE: assess evidence, find gaps
 * - FORECAST: produce probability estimate
 */

import { z } from "zod";

// ============================================
// SHARED SUB-SCHEMAS
// ============================================

const ConvictionLevelSchema = z.enum(["high", "medium", "low"]);

const ImpactLevelSchema = z.enum(["high", "medium", "low"]);

const PriorityLevelSchema = z.enum(["critical", "important", "supplementary"]);

const ImportanceLevelSchema = z.enum(["critical", "important", "minor"]);

const TradeActionSchema = z.enum(["buy_yes", "buy_no", "hold", "avoid"]);

// ============================================
// RESEARCH QUESTION SCHEMA
// ============================================

export const ResearchQuestionSchema = z.object({
  id: z.string(),
  topic: z.string(),
  question: z.string(),
  priority: PriorityLevelSchema,
  expectedSources: z.array(z.string()).optional(),
  rationale: z.string(),
});

// ============================================
// EVIDENCE PACKAGE SCHEMA
// ============================================

export const EvidencePackageMetaSchema = z.object({
  researchCostUsd: z.number(),
  filterCostUsd: z.number(),
  durationMs: z.number(),
  totalSources: z.number(),
  totalFindings: z.number(),
});

// Note: Full EvidencePackageSchema would need imports from researcher/filter
// This is a lightweight validation for the meta portion

// ============================================
// DECOMPOSE OUTPUT SCHEMA
// ============================================

const InitialAssessmentSchema = z.object({
  uncertainties: z.array(z.string()),
  preliminaryRange: z.object({
    low: z.number().min(0).max(1),
    high: z.number().min(0).max(1),
  }),
  keyFactors: z.array(z.string()),
});

export const DecomposeOutputSchema = z.object({
  mode: z.literal("decompose"),
  questions: z.array(ResearchQuestionSchema),
  initialAssessment: InitialAssessmentSchema,
});

// ============================================
// ANALYZE OUTPUT SCHEMA
// ============================================

const InformationGapSchema = z.object({
  topic: z.string(),
  description: z.string(),
  importance: ImportanceLevelSchema,
});

const EvidenceAssessmentSchema = z.object({
  sufficient: z.boolean(),
  quality: ConvictionLevelSchema,
  gaps: z.array(InformationGapSchema),
  aggregatedSummary: z.string(),
});

export const AnalyzeOutputSchema = z.object({
  mode: z.literal("analyze"),
  evidenceAssessment: EvidenceAssessmentSchema,
  additionalQuestions: z.array(ResearchQuestionSchema).optional(),
  readyToForecast: z.boolean(),
});

// ============================================
// FORECAST SUB-SCHEMAS
// ============================================

const ReasonStrengthSchema = z.enum(["strong", "moderate", "weak"]);

const ReasonArgumentSchema = z.object({
  strength: ReasonStrengthSchema,
  reason: z.string(),
  evidence: z.string().nullable(),
});

const CalibrationAdjustmentSchema = z.object({
  adjustedFrom: z.number().min(0).max(1),
  adjustedTo: z.number().min(0).max(1),
  reason: z.string(),
});

/**
 * Structured reasoning from 7-step forecasting process
 */
export const ForecastReasoningSchema = z.object({
  questionRestatement: z.string(),
  reasonsForNo: z.array(ReasonArgumentSchema),
  reasonsForYes: z.array(ReasonArgumentSchema),
  initialProbability: z.number().min(0).max(1),
  initialReasoning: z.string(),
  calibrationAdjustment: CalibrationAdjustmentSchema,
});

const BaselineUsedSchema = z.object({
  source: z.string(),
  value: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  reasoning: z.string(),
});

const ScenarioSchema = z.object({
  scenario: z.string(),
  probability: z.number().min(0).max(1),
  reasoning: z.string(),
});

const TradeRecommendationSchema = z.object({
  action: TradeActionSchema,
  conviction: ConvictionLevelSchema,
  edge: z.number(),
  rationale: z.string(),
  risks: z.array(z.string()),
  suggestedSize: z.number().min(0).max(1).optional(),
});

const ForecastSchema = z.object({
  outcome: z.string(),
  probability: z.number().min(0).max(1),
  lowerBound: z.number().min(0).max(1),
  upperBound: z.number().min(0).max(1),
  confidence: ConvictionLevelSchema,
  reasoning: ForecastReasoningSchema,
  baselinesUsed: z.array(BaselineUsedSchema),
  evidenceSummary: z.string(),
  probabilityReasoning: z.string(),
  assumptions: z.array(z.string()),
  scenarioBreakdown: z.array(ScenarioSchema).optional(),
  recommendation: TradeRecommendationSchema.optional(),
});

// ============================================
// FORECAST OUTPUT SCHEMA
// ============================================

export const ForecastOutputSchema = z.object({
  mode: z.literal("forecast"),
  forecast: ForecastSchema,
});

// ============================================
// LEGACY RESEARCH REQUEST SCHEMA
// ============================================

const ResearchRequestSchema = z.object({
  question: z.string(),
  reason: z.string(),
  expectedImpact: ImpactLevelSchema,
  suggestedFocus: z.array(z.string()).optional(),
  preliminaryProbability: z.number().min(0).max(1).optional(),
});

// ============================================
// MAIN SCHEMAS (discriminated union)
// ============================================

// Legacy output schema (forecast or requestResearch)
const ForecastResultSchema = z.object({
  mode: z.literal("forecast"),
  forecast: ForecastSchema,
});

const ResearchRequestResultSchema = z.object({
  mode: z.literal("requestResearch"),
  request: ResearchRequestSchema,
});

export const ForecasterOutputSchema = z.discriminatedUnion("mode", [
  ForecastResultSchema,
  ResearchRequestResultSchema,
]);

export type ForecasterOutputSchemaType = z.infer<typeof ForecasterOutputSchema>;

// ============================================
// ORCHESTRATOR OUTPUT SCHEMA
// ============================================

/**
 * Orchestrator output: can be decompose, analyze, or forecast
 */
export const ForecasterOrchestratorOutputSchema = z.discriminatedUnion("mode", [
  DecomposeOutputSchema,
  AnalyzeOutputSchema,
  ForecastOutputSchema,
]);

export type ForecasterOrchestratorOutputSchemaType = z.infer<
  typeof ForecasterOrchestratorOutputSchema
>;

// ============================================
// TYPE EXPORTS
// ============================================

export type ResearchQuestionSchemaType = z.infer<typeof ResearchQuestionSchema>;
export type DecomposeOutputSchemaType = z.infer<typeof DecomposeOutputSchema>;
export type AnalyzeOutputSchemaType = z.infer<typeof AnalyzeOutputSchema>;
export type ForecastOutputSchemaType = z.infer<typeof ForecastOutputSchema>;

// Re-export individual schemas for testing
export {
  ForecastSchema,
  ResearchRequestSchema,
  TradeRecommendationSchema,
  BaselineUsedSchema,
};
