/**
 * Filter Agent Types
 * Schema-preserving, deterministic, non-generative noise-clearing agent
 * Acts as "airlock" between Researcher and Forecaster
 *
 * CONSTRAINTS:
 * - Subset-only: can only drop, merge, reorder, downgrade
 * - No tools: operates purely on given input
 * - No status upgrades: can only make things less certain
 * - Frozen source labels: can't change any source metadata
 * - No new facts in text: can only shorten/rephrase
 */

import type { ResearcherOutput } from "../researcher/types.js";

// ============================================
// INPUT
// ============================================

export interface FilterInput {
  /**
   * Question/market ID for tracking
   */
  questionId: string;

  /**
   * The subject/question being analyzed
   */
  subject: string;

  /**
   * Raw research output from Researcher agent
   */
  rawResearch: ResearcherOutput;

  /**
   * Filtering configuration
   */
  config?: FilterConfig;

  /**
   * Target ID for data storage
   */
  targetId?: string;
}

export interface FilterConfig {
  /**
   * Filtering profile preset
   */
  profile?: FilterProfile;

  /**
   * Maximum findings to keep
   */
  maxFindings?: number;

  /**
   * Maximum timeline events to keep
   */
  maxTimelineEvents?: number;

  /**
   * Maximum sources to keep
   */
  maxSources?: number;

  /**
   * Maximum open questions to keep
   */
  maxOpenQuestions?: number;
}

/**
 * Predefined filtering profiles
 * - strict: aggressive filtering for autonomous trading (small, high-signal)
 * - default: balanced filtering
 * - loose: minimal filtering for human review (more context preserved)
 */
export type FilterProfile = "strict" | "default" | "loose";

// ============================================
// OUTPUT
// ============================================

/**
 * Cleaned evidence output - same shape as ResearcherOutput + meta
 */
export interface FilterOutput {
  /**
   * Cleaned summary (shortened, references only kept content)
   */
  summary: string;

  /**
   * Filtered findings (subset of raw)
   */
  findings: FilteredFinding[];

  /**
   * Filtered timeline (subset of raw)
   */
  timeline: FilteredTimelineEvent[];

  /**
   * Filtered open questions (subset of raw)
   */
  openQuestions: FilteredOpenQuestion[];

  /**
   * Filtered sources (subset of raw, labels frozen)
   */
  sources: FilteredSource[];

  /**
   * Metadata about what was filtered
   */
  meta: FilterMeta;
}

/**
 * Finding after filtering (same shape, possibly downgraded status)
 */
export interface FilteredFinding {
  topic?: string;
  claim: string;
  status: FilteredClaimStatus;
  supportingSources: string[];
  opposingSources: string[];
  notes?: string;
}

/**
 * Claim status - can only be same or downgraded from original
 */
export type FilteredClaimStatus = "supported" | "contested" | "unclear";

/**
 * Timeline event after filtering (same shape)
 */
export interface FilteredTimelineEvent {
  date: string;
  event: string;
  sources: string[];
}

/**
 * Open question after filtering (same shape)
 */
export interface FilteredOpenQuestion {
  question: string;
  reason: string;
}

/**
 * Source after filtering (FROZEN - cannot change any fields)
 */
export interface FilteredSource {
  url: string;
  title: string;
  type: "official" | "news" | "analysis" | "data" | "social" | "academic" | "other";
  publishedAt?: string | null;
  retrievedAt: string;
  relevance: "high" | "medium" | "low";
  credibility: "high" | "medium" | "low";
}

/**
 * Metadata about the filtering operation
 */
export interface FilterMeta {
  /**
   * Number of findings dropped
   */
  droppedFindingsCount: number;

  /**
   * Number of sources dropped
   */
  droppedSourcesCount: number;

  /**
   * Number of timeline events dropped
   */
  droppedTimelineEventsCount: number;

  /**
   * Number of open questions dropped
   */
  droppedOpenQuestionsCount: number;

  /**
   * Rules that were applied (enum values only)
   */
  rulesUsed: FilterRule[];
}

/**
 * Allowed rule identifiers for meta.rulesUsed
 * ONLY these values are permitted
 */
export type FilterRule =
  | "drop_low_cred_low_rel_sources"
  | "drop_unreferenced_sources"
  | "drop_empty_findings"
  | "drop_findings_without_sources"
  | "merge_duplicate_findings"
  | "downgrade_status_supported_to_unclear"
  | "downgrade_status_supported_to_contested"
  | "downgrade_status_contested_to_unclear"
  | "trim_findings_by_importance"
  | "drop_timeline_without_sources"
  | "merge_duplicate_timeline"
  | "trim_timeline_by_recency"
  | "trim_open_questions"
  | "apply_max_sources_limit"
  | "apply_max_findings_limit"
  | "apply_max_timeline_limit"
  | "apply_max_open_questions_limit"
  | "shorten_summary";

// ============================================
// DEFAULT LIMITS BY PROFILE
// ============================================

export const FILTER_PROFILE_DEFAULTS: Record<FilterProfile, Required<Omit<FilterConfig, "profile">>> = {
  strict: {
    maxFindings: 8,
    maxTimelineEvents: 10,
    maxSources: 15,
    maxOpenQuestions: 3,
  },
  default: {
    maxFindings: 15,
    maxTimelineEvents: 20,
    maxSources: 30,
    maxOpenQuestions: 5,
  },
  loose: {
    maxFindings: 25,
    maxTimelineEvents: 30,
    maxSources: 50,
    maxOpenQuestions: 10,
  },
};
