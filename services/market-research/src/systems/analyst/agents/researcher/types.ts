/**
 * Researcher Agent Types
 * Pure evidence structure - NO probabilities, NO recommendations
 */

import type { AnalysisDepth, AnalysisFocus } from "../../types.js";

// ============================================
// INPUT
// ============================================

export interface ResearcherInput {
  /**
   * Subject to research
   */
  subject: string;

  /**
   * Target ID for data storage
   */
  targetId?: string;

  /**
   * Additional context
   */
  context?: Record<string, unknown>;

  /**
   * Research depth
   */
  depth: AnalysisDepth;

  /**
   * Focus areas
   */
  focus?: AnalysisFocus[];
}

// ============================================
// OUTPUT - Pure evidence, no probabilities
// ============================================

export type ClaimStatus = "supported" | "contested" | "unclear";
export type RelevanceLevel = "high" | "medium" | "low";
export type CredibilityLevel = "high" | "medium" | "low";
export type SourceType =
  | "official"
  | "news"
  | "analysis"
  | "data"
  | "social"
  | "academic"
  | "other";

export interface Finding {
  topic?: string;
  claim: string;
  status: ClaimStatus;
  supportingSources: string[];
  opposingSources: string[];
  notes?: string;
}

export interface TimelineEvent {
  date: string;
  event: string;
  sources: string[];
}

export interface OpenQuestion {
  question: string;
  reason: string;
}

export interface Source {
  url: string;
  title: string;
  type: SourceType;
  publishedAt?: string | null;
  retrievedAt: string;
  relevance: RelevanceLevel;
  credibility: CredibilityLevel;
}

export interface ResearcherOutput {
  /**
   * 2-4 sentence neutral overview - NO recommendations or probabilities
   */
  summary: string;

  /**
   * Key claims with supporting/opposing evidence
   */
  findings: Finding[];

  /**
   * Chronological events
   */
  timeline: TimelineEvent[];

  /**
   * Unresolved questions for downstream agents
   */
  openQuestions: OpenQuestion[];

  /**
   * All sources used
   */
  sources: Source[];
}
