/**
 * Evaluation Output Schema
 * Defines the structured output from the CriticAgent
 */

import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { getMarketDir, ensureMarketDir } from "./market.js";

/**
 * Evaluation scores (0-10)
 */
export const ScoresSchema = z.object({
  overall: z.number().min(0).max(10),
  dataCompleteness: z.number().min(0).max(10),
  analysisDepth: z.number().min(0).max(10),
  sourceQuality: z.number().min(0).max(10),
  riskIdentification: z.number().min(0).max(10),
  logicalConsistency: z.number().min(0).max(10),
});

/**
 * Issue flag types
 */
export const FlagTypeSchema = z.enum([
  "missing_data",
  "stale_data",
  "weak_sources",
  "logical_gap",
  "missing_risk",
  "bias",
  "resolution_unclear",
]);

/**
 * Issue flag
 */
export const FlagSchema = z.object({
  type: FlagTypeSchema,
  severity: z.enum(["critical", "major", "minor"]),
  description: z.string(),
  location: z.string().optional(),
});

/**
 * Suggestion types
 */
export const SuggestionActionSchema = z.enum([
  "verify",
  "research_more",
  "update_data",
  "reconsider",
]);

/**
 * Improvement suggestion
 */
export const SuggestionSchema = z.object({
  action: SuggestionActionSchema,
  description: z.string(),
  priority: z.enum(["high", "medium", "low"]),
});

/**
 * Final verdict
 */
export const VerdictSchema = z.object({
  decision: z.enum(["accept", "revise", "reject"]),
  confidence: z.enum(["high", "medium", "low"]),
  summary: z.string(),
});

/**
 * Evaluation metadata
 */
export const EvaluationMetadataSchema = z.object({
  model: z.string(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
  }),
  cost: z.number(),
  duration: z.number(),
});

/**
 * Full evaluation output
 */
export const EvaluationOutputSchema = z.object({
  marketId: z.string(),
  evaluatedAt: z.string(),
  researchVersion: z.string(),

  // Scores
  scores: ScoresSchema,

  // Issues found
  flags: z.array(FlagSchema),

  // Recommendations
  suggestions: z.array(SuggestionSchema),

  // Final verdict
  verdict: VerdictSchema,

  // Metadata
  metadata: EvaluationMetadataSchema,
});

export type Scores = z.infer<typeof ScoresSchema>;
export type FlagType = z.infer<typeof FlagTypeSchema>;
export type Flag = z.infer<typeof FlagSchema>;
export type SuggestionAction = z.infer<typeof SuggestionActionSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type EvaluationMetadata = z.infer<typeof EvaluationMetadataSchema>;
export type EvaluationOutput = z.infer<typeof EvaluationOutputSchema>;

/**
 * Save evaluation output
 */
export async function saveEvaluation(evaluation: EvaluationOutput): Promise<void> {
  const dir = await ensureMarketDir(evaluation.marketId);
  const filePath = path.join(dir, "evaluation.json");
  await fs.writeFile(filePath, JSON.stringify(evaluation, null, 2));
}

/**
 * Load evaluation output
 */
export async function loadEvaluation(marketId: string): Promise<EvaluationOutput | null> {
  const filePath = path.join(getMarketDir(marketId), "evaluation.json");
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return EvaluationOutputSchema.parse(JSON.parse(content));
  } catch {
    return null;
  }
}

/**
 * Check if research passes evaluation
 */
export function isResearchApproved(evaluation: EvaluationOutput): boolean {
  return evaluation.verdict.decision === "accept";
}

/**
 * Get critical issues from evaluation
 */
export function getCriticalFlags(evaluation: EvaluationOutput): Flag[] {
  return evaluation.flags.filter((f) => f.severity === "critical");
}

/**
 * Get high priority suggestions
 */
export function getHighPrioritySuggestions(evaluation: EvaluationOutput): Suggestion[] {
  return evaluation.suggestions.filter((s) => s.priority === "high");
}

/**
 * Calculate average score
 */
export function getAverageScore(scores: Scores): number {
  const values = [
    scores.dataCompleteness,
    scores.analysisDepth,
    scores.sourceQuality,
    scores.riskIdentification,
    scores.logicalConsistency,
  ];
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Format evaluation as a brief summary
 */
export function formatEvaluationSummary(evaluation: EvaluationOutput): string {
  const lines: string[] = [];

  const avgScore = getAverageScore(evaluation.scores);
  const statusEmoji =
    evaluation.verdict.decision === "accept"
      ? "✓"
      : evaluation.verdict.decision === "revise"
        ? "⚠"
        : "✗";

  lines.push(`${statusEmoji} **${evaluation.verdict.decision.toUpperCase()}** (${evaluation.verdict.confidence} confidence)`);
  lines.push(`Overall Score: ${evaluation.scores.overall}/10 (avg: ${avgScore.toFixed(1)})`);
  lines.push("");

  if (evaluation.flags.length > 0) {
    const critical = getCriticalFlags(evaluation);
    if (critical.length > 0) {
      lines.push(`Critical Issues: ${critical.length}`);
      for (const flag of critical) {
        lines.push(`  - ${flag.type}: ${flag.description}`);
      }
    }
  }

  lines.push("");
  lines.push(`Summary: ${evaluation.verdict.summary}`);

  return lines.join("\n");
}

/**
 * Create an empty evaluation template
 */
export function createEvaluationTemplate(
  marketId: string,
  researchVersion: string
): Partial<EvaluationOutput> {
  return {
    marketId,
    evaluatedAt: new Date().toISOString(),
    researchVersion,
    scores: {
      overall: 0,
      dataCompleteness: 0,
      analysisDepth: 0,
      sourceQuality: 0,
      riskIdentification: 0,
      logicalConsistency: 0,
    },
    flags: [],
    suggestions: [],
    verdict: {
      decision: "revise",
      confidence: "low",
      summary: "",
    },
    metadata: {
      model: "",
      tokens: { input: 0, output: 0 },
      cost: 0,
      duration: 0,
    },
  };
}
