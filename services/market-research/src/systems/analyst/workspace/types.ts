/**
 * Analyst Workspace Types
 * Schemas for per-target workspace files
 */

// ============================================
// VERSIONED BASE
// ============================================

/**
 * Base for all versioned documents
 */
export interface VersionedDoc {
  /** Schema version for migration */
  schemaVersion: string;

  /** When this document was created */
  createdAt: string;

  /** When this document was last updated */
  updatedAt: string;
}

// ============================================
// FEATURE LIST
// ============================================

/**
 * Feature list for long-running research
 * Tracks what aspects need to be researched
 */
export interface FeatureList extends VersionedDoc {
  schemaVersion: "feature_list_v1";

  /** Target being researched */
  targetId: string;

  /** Original subject/question */
  subject: string;

  /** Features to research */
  features: Feature[];

  /** Overall progress (0-1) */
  progress: number;

  /** Number of completed features */
  completedCount: number;

  /** Total number of features */
  totalCount: number;
}

/**
 * A single research feature/aspect
 */
export interface Feature {
  /** Unique feature ID */
  id: string;

  /** Feature name/title */
  name: string;

  /** What needs to be researched */
  description: string;

  /** Priority (1=highest) */
  priority: number;

  /** Current status */
  status: FeatureStatus;

  /** Category/type */
  category?: FeatureCategory;

  /** Dependencies on other features */
  dependsOn?: string[];

  /** When this feature was completed */
  completedAt?: string;

  /** Notes from completion */
  completionNotes?: string;

  /** Number of attempts */
  attempts: number;

  /** Last error if failed */
  lastError?: string;
}

export type FeatureStatus =
  | "pending"      // Not started
  | "in_progress"  // Currently being worked on
  | "completed"    // Successfully completed
  | "blocked"      // Waiting on dependencies
  | "failed"       // Failed after max attempts
  | "skipped";     // Deliberately skipped

export type FeatureCategory =
  | "facts"           // Factual information gathering
  | "context"         // Background context
  | "stakeholders"    // Key parties involved
  | "timeline"        // Historical events
  | "predictions"     // Future forecasts
  | "risks"           // Risk identification
  | "opportunities"   // Opportunity identification
  | "sources"         // Source discovery
  | "verification"    // Fact-checking
  | "synthesis"       // Combining information
  | string;           // Custom categories

// ============================================
// HYPOTHESES
// ============================================

/**
 * Hypotheses document for tracking beliefs
 */
export interface HypothesesDoc extends VersionedDoc {
  schemaVersion: "hypotheses_v1";

  /** Target being researched */
  targetId: string;

  /** Current hypotheses */
  hypotheses: Hypothesis[];

  /** Rejected hypotheses (for learning) */
  rejected: Hypothesis[];
}

/**
 * A single hypothesis
 */
export interface Hypothesis {
  /** Unique hypothesis ID */
  id: string;

  /** The hypothesis statement */
  statement: string;

  /** Current confidence (0-1) */
  confidence: number;

  /** Supporting evidence */
  supporting: Evidence[];

  /** Contradicting evidence */
  contradicting: Evidence[];

  /** When this hypothesis was formed */
  formedAt: string;

  /** When confidence was last updated */
  lastUpdated: string;

  /** Status */
  status: HypothesisStatus;

  /** Category */
  category?: string;
}

export type HypothesisStatus =
  | "active"      // Currently held
  | "confirmed"   // Confirmed with high confidence
  | "rejected"    // Rejected based on evidence
  | "uncertain";  // Needs more investigation

/**
 * Evidence for/against a hypothesis
 */
export interface Evidence {
  /** Description of evidence */
  description: string;

  /** Source reference */
  source?: string;

  /** Strength of this evidence */
  strength: "strong" | "moderate" | "weak";

  /** When this evidence was found */
  foundAt: string;
}

// ============================================
// CLAIMS
// ============================================

/**
 * Claims document for tracking verified facts
 * Claims are more concrete than hypotheses - they're supported by sources
 */
export interface ClaimsDoc extends VersionedDoc {
  schemaVersion: "claims_v1";

  /** Target being researched */
  targetId: string;

  /** Verified claims */
  claims: Claim[];
}

/**
 * A single claim with evidence
 */
export interface Claim {
  /** Unique claim ID */
  id: string;

  /** The claim text */
  text: string;

  /** Sources supporting this claim */
  sources: ClaimSource[];

  /** When this claim was made/found */
  date?: string;

  /** Strength/confidence of this claim */
  strength: ClaimStrength;

  /** Topic tags for categorization */
  tags?: string[];

  /** Related hypothesis IDs */
  relatedHypotheses?: string[];

  /** When this claim was added */
  addedAt: string;

  /** Whether this claim has been verified */
  verified: boolean;

  /** Verification notes */
  verificationNotes?: string;
}

export type ClaimStrength = "low" | "medium" | "high";

/**
 * Source for a claim
 */
export interface ClaimSource {
  /** URL or document ID */
  url?: string;

  /** Source title */
  title: string;

  /** Source type */
  type: "official" | "news" | "analysis" | "data" | "social" | "academic" | "other";

  /** When the source was accessed */
  accessedAt: string;

  /** Relevant quote from source */
  quote?: string;

  /** Credibility assessment */
  credibility?: "high" | "medium" | "low";
}

// ============================================
// PROGRESS LOG
// ============================================

/**
 * Progress log entry
 */
export interface ProgressEntry {
  /** When this entry was logged */
  timestamp: string;

  /** Session ID that created this entry */
  sessionId?: string;

  /** Type of entry */
  type: ProgressEntryType;

  /** Human-readable message */
  message: string;

  /** Feature ID if relevant */
  featureId?: string;

  /** Additional data */
  data?: Record<string, unknown>;
}

export type ProgressEntryType =
  | "initialized"      // Workspace was initialized
  | "feature_started"  // Started working on a feature
  | "feature_completed"// Completed a feature
  | "feature_failed"   // Failed to complete a feature
  | "hypothesis_added" // Added a new hypothesis
  | "hypothesis_updated" // Updated hypothesis confidence
  | "research_updated" // Updated research document
  | "error"            // Error occurred
  | "note";            // General note

// ============================================
// PLAN / TODO
// ============================================

/**
 * Plan document for current session goals
 */
export interface PlanDoc extends VersionedDoc {
  schemaVersion: "plan_v1";

  /** Target being researched */
  targetId: string;

  /** Current session goals */
  currentGoals: PlanGoal[];

  /** Completed goals (history) */
  completedGoals: PlanGoal[];

  /** Blockers/issues */
  blockers: string[];

  /** Next steps after current session */
  nextSteps: string[];
}

/**
 * A goal in the plan
 */
export interface PlanGoal {
  /** Goal ID */
  id: string;

  /** Goal description */
  description: string;

  /** Status */
  status: "pending" | "in_progress" | "completed" | "blocked";

  /** Priority */
  priority: number;

  /** When completed */
  completedAt?: string;

  /** Outcome notes */
  outcome?: string;
}

// ============================================
// FULL WORKSPACE
// ============================================

/**
 * Complete workspace state for a target
 */
export interface AnalystWorkspace {
  /** Target ID */
  targetId: string;

  /** Feature list */
  featureList: FeatureList;

  /** Hypotheses */
  hypotheses: HypothesesDoc;

  /** Claims */
  claims: ClaimsDoc;

  /** Plan */
  plan: PlanDoc;

  /** Progress log entries */
  progressLog: ProgressEntry[];

  /** Whether workspace is initialized */
  initialized: boolean;

  /** When workspace was created */
  createdAt: string;

  /** When workspace was last accessed */
  lastAccessedAt: string;
}
