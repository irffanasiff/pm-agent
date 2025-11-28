/**
 * Analyst System Types
 * Generic deep analysis system - domain agnostic
 */

import type { ExecutionMetadata } from "../../shared/agent/types.js";

// ============================================
// SYSTEM INPUT
// ============================================

/**
 * Input to the Analyst system
 */
export interface AnalystInput {
  /**
   * Target identifier (optional - use for referencing stored data)
   */
  targetId?: string;

  /**
   * Subject to analyze (the question/topic)
   */
  subject: string;

  /**
   * Additional context for analysis
   */
  context?: Record<string, unknown>;

  /**
   * How deep to analyze
   */
  depth: AnalysisDepth;

  /**
   * Areas to focus on
   */
  focus?: AnalysisFocus[];

  /**
   * Resource limits
   */
  limits?: {
    maxCostUsd?: number;
    maxDurationMs?: number;
  };
}

export type AnalysisDepth = "quick" | "standard" | "deep" | "exhaustive";

export type AnalysisFocus =
  | "facts"          // Factual information
  | "sentiment"      // Opinion/sentiment analysis
  | "risks"          // Risk identification
  | "opportunities"  // Opportunity identification
  | "comparison"     // Compare alternatives
  | "prediction"     // Future prediction
  | "recommendation" // Action recommendation
  | string;          // Custom focus area

// ============================================
// SYSTEM OUTPUT
// ============================================

/**
 * Output from the Analyst system
 */
export interface AnalystOutput {
  /**
   * Target that was analyzed
   */
  targetId?: string;
  subject: string;

  /**
   * Executive summary
   */
  summary: string;

  /**
   * Detailed findings
   */
  findings: AnalysisFindings;

  /**
   * Overall assessment
   */
  assessment: Assessment;

  /**
   * Sources used
   */
  sources: Source[];

  /**
   * System metadata
   */
  metadata: AnalystMetadata;
}

// ============================================
// FINDINGS
// ============================================

export interface AnalysisFindings {
  /**
   * Key points discovered
   */
  keyPoints: KeyPoint[];

  /**
   * Arguments/perspectives
   */
  perspectives: {
    supporting: Argument[];
    opposing: Argument[];
    neutral?: Argument[];
  };

  /**
   * Identified risks
   */
  risks: Risk[];

  /**
   * Identified opportunities (optional)
   */
  opportunities?: Opportunity[];

  /**
   * Timeline/events (optional)
   */
  timeline?: TimelineEvent[];
}

export interface KeyPoint {
  point: string;
  confidence: ConfidenceLevel;
  evidence: string[];
  category?: string;
}

export interface Argument {
  claim: string;
  confidence: ConfidenceLevel;
  source?: string;
  strength?: "strong" | "moderate" | "weak";
}

export interface Risk {
  type: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  likelihood?: "certain" | "likely" | "possible" | "unlikely";
  mitigation?: string;
}

export interface Opportunity {
  description: string;
  potential: "high" | "medium" | "low";
  timeframe?: string;
  requirements?: string[];
}

export interface TimelineEvent {
  date: string;
  event: string;
  significance: "high" | "medium" | "low";
  source?: string;
}

// ============================================
// ASSESSMENT
// ============================================

export interface Assessment {
  /**
   * Overall conclusion
   */
  conclusion: string;

  /**
   * Confidence in the conclusion
   */
  confidence: number; // 0-1

  /**
   * Detailed reasoning
   */
  reasoning: string;

  /**
   * Recommendation (if focus includes it)
   */
  recommendation?: Recommendation;

  /**
   * Prediction (if focus includes it)
   */
  prediction?: Prediction;
}

export interface Recommendation {
  action: string;
  conviction: ConfidenceLevel;
  rationale: string;
  caveats?: string[];
}

export interface Prediction {
  outcome: string;
  probability: number;
  timeframe?: string;
  assumptions: string[];
}

// ============================================
// SOURCES
// ============================================

export interface Source {
  url?: string;
  title: string;
  type: SourceType;
  retrievedAt: string;
  relevance: ConfidenceLevel;
  keyQuote?: string;
  credibility?: ConfidenceLevel;
}

export type SourceType =
  | "official"    // Official sources (gov, company)
  | "news"        // News articles
  | "analysis"    // Expert analysis
  | "data"        // Data sources
  | "social"      // Social media
  | "academic"    // Academic papers
  | "other";

// ============================================
// METADATA
// ============================================

export interface AnalystMetadata extends ExecutionMetadata {
  /**
   * System version
   */
  systemVersion: string;

  /**
   * Agents used in this analysis
   */
  agentsUsed: string[];

  /**
   * Number of research iterations
   */
  iterations: number;

  /**
   * Analysis depth achieved
   */
  depthAchieved: AnalysisDepth;

  /**
   * Focus areas covered
   */
  focusCovered: string[];
}

// ============================================
// COMMON TYPES
// ============================================

export type ConfidenceLevel = "high" | "medium" | "low";

// ============================================
// SYSTEM OPTIONS
// ============================================

export interface AnalystSystemOptions {
  /**
   * Domain configuration (e.g., "polymarket")
   */
  domain?: string;

  /**
   * Base data directory
   */
  dataDir?: string;

  /**
   * Default analysis depth
   */
  defaultDepth?: AnalysisDepth;

  /**
   * Enable/disable specific agents
   */
  agents?: {
    researcher?: boolean;
    factChecker?: boolean;
    synthesizer?: boolean;
  };
}
