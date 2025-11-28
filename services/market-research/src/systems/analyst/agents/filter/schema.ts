/**
 * Filter Output Schema
 * Zod schema for validating filter agent output
 * Same shape as ResearcherOutput + meta block
 */

import { z } from "zod";

// ============================================
// FILTER RULE ENUM
// ============================================

export const FilterRuleSchema = z.enum([
  "drop_low_cred_low_rel_sources",
  "drop_unreferenced_sources",
  "drop_empty_findings",
  "drop_findings_without_sources",
  "merge_duplicate_findings",
  "downgrade_status_supported_to_unclear",
  "downgrade_status_supported_to_contested",
  "downgrade_status_contested_to_unclear",
  "trim_findings_by_importance",
  "drop_timeline_without_sources",
  "merge_duplicate_timeline",
  "trim_timeline_by_recency",
  "trim_open_questions",
  "apply_max_sources_limit",
  "apply_max_findings_limit",
  "apply_max_timeline_limit",
  "apply_max_open_questions_limit",
  "shorten_summary",
]);

// ============================================
// SUB-SCHEMAS
// ============================================

const ClaimStatusSchema = z.enum(["supported", "contested", "unclear"]);

const SourceTypeSchema = z.enum([
  "official",
  "news",
  "analysis",
  "data",
  "social",
  "academic",
  "other",
]);

const RelevanceLevelSchema = z.enum(["high", "medium", "low"]);

const CredibilityLevelSchema = z.enum(["high", "medium", "low"]);

const FilteredFindingSchema = z.object({
  topic: z.string().optional(),
  claim: z.string(),
  status: ClaimStatusSchema,
  supportingSources: z.array(z.string()),
  opposingSources: z.array(z.string()),
  notes: z.string().optional(),
});

const FilteredTimelineEventSchema = z.object({
  date: z.string(),
  event: z.string(),
  sources: z.array(z.string()),
});

const FilteredOpenQuestionSchema = z.object({
  question: z.string(),
  reason: z.string(),
});

const FilteredSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  type: SourceTypeSchema,
  publishedAt: z.string().nullable().optional(),
  retrievedAt: z.string(),
  relevance: RelevanceLevelSchema,
  credibility: CredibilityLevelSchema,
});

const FilterMetaSchema = z.object({
  droppedFindingsCount: z.number().int().min(0),
  droppedSourcesCount: z.number().int().min(0),
  droppedTimelineEventsCount: z.number().int().min(0),
  droppedOpenQuestionsCount: z.number().int().min(0),
  rulesUsed: z.array(FilterRuleSchema),
});

// ============================================
// MAIN SCHEMA
// ============================================

export const FilterOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(FilteredFindingSchema),
  timeline: z.array(FilteredTimelineEventSchema),
  openQuestions: z.array(FilteredOpenQuestionSchema),
  sources: z.array(FilteredSourceSchema),
  meta: FilterMetaSchema,
});

export type FilterOutputSchemaType = z.infer<typeof FilterOutputSchema>;

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Validate that all source URLs in findings/timeline exist in sources array
 */
export function validateSourceReferences(output: FilterOutputSchemaType): string[] {
  const errors: string[] = [];
  const sourceUrls = new Set(output.sources.map((s) => s.url));

  // Check findings
  for (const finding of output.findings) {
    for (const url of finding.supportingSources) {
      if (!sourceUrls.has(url)) {
        errors.push(`Finding "${finding.claim.slice(0, 50)}..." references missing source: ${url}`);
      }
    }
    for (const url of finding.opposingSources) {
      if (!sourceUrls.has(url)) {
        errors.push(`Finding "${finding.claim.slice(0, 50)}..." references missing opposing source: ${url}`);
      }
    }
  }

  // Check timeline
  for (const event of output.timeline) {
    for (const url of event.sources) {
      if (!sourceUrls.has(url)) {
        errors.push(`Timeline event "${event.event.slice(0, 50)}..." references missing source: ${url}`);
      }
    }
  }

  return errors;
}

/**
 * Validate that output is a subset of raw research (no new URLs)
 */
export function validateSubsetConstraint(
  output: FilterOutputSchemaType,
  rawUrls: Set<string>
): string[] {
  const errors: string[] = [];

  for (const source of output.sources) {
    if (!rawUrls.has(source.url)) {
      errors.push(`Source URL not in raw research: ${source.url}`);
    }
  }

  return errors;
}

// Re-export sub-schemas for testing
export {
  FilteredFindingSchema,
  FilteredTimelineEventSchema,
  FilteredOpenQuestionSchema,
  FilteredSourceSchema,
  FilterMetaSchema,
};
