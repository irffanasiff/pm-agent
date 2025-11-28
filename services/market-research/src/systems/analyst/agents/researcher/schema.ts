/**
 * Researcher Output Schema
 * Pure evidence structure - NO probabilities, NO recommendations
 * Zod schema for validating researcher output
 */

import { z } from "zod";

// ============================================
// SUB-SCHEMAS
// ============================================

const ClaimStatusSchema = z.enum(["supported", "contested", "unclear"]);

const RelevanceLevelSchema = z.enum(["high", "medium", "low"]);

const CredibilityLevelSchema = z.enum(["high", "medium", "low"]);

const SourceTypeSchema = z.enum([
  "official",
  "news",
  "analysis",
  "data",
  "social",
  "academic",
  "other",
]);

const FindingSchema = z.object({
  topic: z.string().optional(),
  claim: z.string(),
  status: ClaimStatusSchema,
  supportingSources: z.array(z.string()),
  opposingSources: z.array(z.string()),
  notes: z.string().optional(),
});

const TimelineEventSchema = z.object({
  date: z.string(),
  event: z.string(),
  sources: z.array(z.string()),
});

const OpenQuestionSchema = z.object({
  question: z.string(),
  reason: z.string(),
});

const SourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  type: SourceTypeSchema,
  publishedAt: z.string().nullable().optional(),
  retrievedAt: z.string(),
  relevance: RelevanceLevelSchema,
  credibility: CredibilityLevelSchema,
});

// ============================================
// MAIN SCHEMA
// ============================================

export const ResearcherOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
  timeline: z.array(TimelineEventSchema),
  openQuestions: z.array(OpenQuestionSchema),
  sources: z.array(SourceSchema),
});

export type ResearcherOutput = z.infer<typeof ResearcherOutputSchema>;

// Re-export for backwards compatibility
export type ResearcherOutputSchemaType = ResearcherOutput;
