/**
 * Benchmark Types
 * Types for eval/benchmark runs
 */

// ============================================
// BENCHMARK CASE
// ============================================

/**
 * A single benchmark test case
 */
export interface BenchmarkCase {
  /** Unique case ID */
  id: string;

  /** Case name/title */
  name: string;

  /** Description of what this case tests */
  description?: string;

  /** Input to the analyst system */
  input: {
    subject: string;
    depth: "quick" | "standard" | "deep" | "exhaustive";
    focus?: string[];
  };

  /** Expected outputs (for accuracy scoring) */
  expected?: {
    /** Claims that should be found */
    claims?: ExpectedClaim[];

    /** Hypotheses that should be formed */
    hypotheses?: ExpectedHypothesis[];

    /** Minimum confidence in assessment */
    minConfidence?: number;

    /** Required sources */
    requiredSourceTypes?: string[];
  };

  /** Tags for filtering/categorization */
  tags?: string[];

  /** Timeout override for this case */
  timeoutMs?: number;

  /** Budget override for this case */
  maxCostUsd?: number;
}

export interface ExpectedClaim {
  /** Text pattern to match (substring) */
  pattern: string;

  /** Minimum strength required */
  minStrength?: "low" | "medium" | "high";
}

export interface ExpectedHypothesis {
  /** Text pattern to match (substring) */
  pattern: string;

  /** Minimum confidence required */
  minConfidence?: number;
}

// ============================================
// BENCHMARK RESULT
// ============================================

/**
 * Result from running a single benchmark case
 */
export interface BenchmarkResult {
  /** Case that was run */
  caseId: string;

  /** Whether the run completed successfully */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Metrics from the run */
  metrics: BenchmarkMetrics;

  /** Accuracy scores against expected outputs */
  accuracy?: AccuracyScores;

  /** Timestamp when run started */
  startedAt: string;

  /** Timestamp when run completed */
  completedAt: string;
}

/**
 * Metrics collected from a benchmark run
 */
export interface BenchmarkMetrics {
  /** Total duration in ms */
  durationMs: number;

  /** Total cost in USD */
  costUsd: number;

  /** Number of worker iterations */
  iterations: number;

  /** Final progress (0-1) */
  finalProgress: number;

  /** Number of claims extracted */
  claimsCount: number;

  /** Number of hypotheses formed */
  hypothesesCount: number;

  /** Number of sources found */
  sourcesCount: number;

  /** Token usage */
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
}

/**
 * Accuracy scores against expected outputs
 */
export interface AccuracyScores {
  /** Claims accuracy (0-1) */
  claimsScore?: number;

  /** Hypotheses accuracy (0-1) */
  hypothesesScore?: number;

  /** Confidence accuracy (0-1) */
  confidenceScore?: number;

  /** Source coverage (0-1) */
  sourceScore?: number;

  /** Overall weighted accuracy */
  overallScore: number;

  /** Details of what matched/missed */
  details?: {
    matchedClaims: string[];
    missedClaims: string[];
    matchedHypotheses: string[];
    missedHypotheses: string[];
  };
}

// ============================================
// BENCHMARK RUN
// ============================================

/**
 * Configuration for a benchmark run
 */
export interface BenchmarkRunConfig {
  /** Unique run ID */
  runId?: string;

  /** Run name/description */
  name?: string;

  /** Cases to run (all if empty) */
  caseIds?: string[];

  /** Tags to filter cases */
  tags?: string[];

  /** Global limits */
  limits?: {
    maxCostUsd?: number;
    maxDurationMs?: number;
    maxIterations?: number;
  };

  /** Parallel execution count */
  parallelism?: number;

  /** Prompt version to test (for A/B testing) */
  promptVersion?: string;

  /** Model override */
  model?: string;

  /** Output directory for results */
  outputDir?: string;
}

/**
 * Summary of a complete benchmark run
 */
export interface BenchmarkRunSummary {
  /** Run ID */
  runId: string;

  /** Run configuration */
  config: BenchmarkRunConfig;

  /** Individual results */
  results: BenchmarkResult[];

  /** Aggregate statistics */
  stats: {
    /** Total cases */
    totalCases: number;

    /** Successful cases */
    successCount: number;

    /** Failed cases */
    failedCount: number;

    /** Average duration */
    avgDurationMs: number;

    /** Total cost */
    totalCostUsd: number;

    /** Average cost per case */
    avgCostUsd: number;

    /** Average accuracy (if expected outputs provided) */
    avgAccuracy?: number;
  };

  /** When run started */
  startedAt: string;

  /** When run completed */
  completedAt: string;

  /** Total duration */
  totalDurationMs: number;
}

// ============================================
// BENCHMARK SUITE
// ============================================

/**
 * A collection of benchmark cases
 */
export interface BenchmarkSuite {
  /** Suite ID */
  id: string;

  /** Suite name */
  name: string;

  /** Description */
  description?: string;

  /** Version */
  version: string;

  /** Cases in this suite */
  cases: BenchmarkCase[];

  /** Default configuration */
  defaults?: {
    depth?: "quick" | "standard" | "deep" | "exhaustive";
    maxCostUsd?: number;
    timeoutMs?: number;
  };
}
