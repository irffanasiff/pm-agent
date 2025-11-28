/**
 * Benchmark Runner
 * Executes benchmark suites and collects metrics
 */

import type { IStore } from "../../../shared/store/types.js";
import type { IExecutor } from "../../../shared/executor/types.js";
import type { IObservability } from "../../../shared/observability/types.js";
import type {
  BenchmarkCase,
  BenchmarkResult,
  BenchmarkRunConfig,
  BenchmarkRunSummary,
  BenchmarkMetrics,
  AccuracyScores,
  BenchmarkSuite,
} from "./types.js";
import { initializeWorkspace } from "../harness/initializer.js";
import { runWorkerLoop } from "../harness/worker.js";
import { AnalystWorkspaceManager } from "../workspace/manager.js";

// ============================================
// BENCHMARK DEPENDENCIES
// ============================================

export interface BenchmarkDependencies {
  store: IStore;
  executor: IExecutor;
  observability: IObservability;
}

// ============================================
// BENCHMARK RUNNER
// ============================================

/**
 * Run a single benchmark case
 */
export async function runBenchmarkCase(
  benchmarkCase: BenchmarkCase,
  deps: BenchmarkDependencies,
  config?: Partial<BenchmarkRunConfig>
): Promise<BenchmarkResult> {
  const { store, executor, observability } = deps;
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  observability.log("info", `[Benchmark] Starting case: ${benchmarkCase.name}`, {
    caseId: benchmarkCase.id,
  });

  try {
    // Initialize workspace
    const initResult = await initializeWorkspace(
      {
        subject: benchmarkCase.input.subject,
        depth: benchmarkCase.input.depth,
        focus: benchmarkCase.input.focus,
      },
      { store, executor, observability }
    );

    if (!initResult.success) {
      throw new Error(`Failed to initialize workspace: ${initResult.error}`);
    }

    const targetId = initResult.targetId;

    // Run worker loop
    const loopResult = await runWorkerLoop(
      targetId,
      { store, executor, observability },
      {
        maxIterations: config?.limits?.maxIterations ?? 10,
        maxTotalCostUsd: benchmarkCase.maxCostUsd ?? config?.limits?.maxCostUsd ?? 2.0,
        maxTotalDurationMs: benchmarkCase.timeoutMs ?? config?.limits?.maxDurationMs ?? 300000,
      }
    );

    // Load final workspace state
    const workspaceManager = new AnalystWorkspaceManager(store);
    const workspace = await workspaceManager.load(targetId);

    // Collect metrics
    const metrics: BenchmarkMetrics = {
      durationMs: Date.now() - startTime,
      costUsd: loopResult.totalCostUsd,
      iterations: loopResult.iterations,
      finalProgress: loopResult.finalProgress,
      claimsCount: workspace?.claims.claims.length ?? 0,
      hypothesesCount: workspace?.hypotheses.hypotheses.length ?? 0,
      sourcesCount: 0, // Would need to track this in workspace
    };

    // Calculate accuracy if expected outputs provided
    let accuracy: AccuracyScores | undefined;
    if (benchmarkCase.expected && workspace) {
      accuracy = calculateAccuracy(benchmarkCase, workspace, workspaceManager);
    }

    observability.log("info", `[Benchmark] Completed case: ${benchmarkCase.name}`, {
      caseId: benchmarkCase.id,
      durationMs: metrics.durationMs,
      costUsd: metrics.costUsd,
      accuracy: accuracy?.overallScore,
    });

    return {
      caseId: benchmarkCase.id,
      success: true,
      metrics,
      accuracy,
      startedAt,
      completedAt: new Date().toISOString(),
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    observability.log("error", `[Benchmark] Case failed: ${benchmarkCase.name}`, {
      caseId: benchmarkCase.id,
      error: errorMsg,
    });

    return {
      caseId: benchmarkCase.id,
      success: false,
      error: errorMsg,
      metrics: {
        durationMs: Date.now() - startTime,
        costUsd: 0,
        iterations: 0,
        finalProgress: 0,
        claimsCount: 0,
        hypothesesCount: 0,
        sourcesCount: 0,
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}

/**
 * Run a full benchmark suite
 */
export async function runBenchmarkSuite(
  suite: BenchmarkSuite,
  deps: BenchmarkDependencies,
  config?: BenchmarkRunConfig
): Promise<BenchmarkRunSummary> {
  const runId = config?.runId ?? `run_${Date.now()}`;
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  deps.observability.log("info", `[Benchmark] Starting suite: ${suite.name}`, {
    runId,
    caseCount: suite.cases.length,
  });

  // Filter cases if specified
  let casesToRun = suite.cases;

  if (config?.caseIds?.length) {
    casesToRun = casesToRun.filter((c) => config.caseIds!.includes(c.id));
  }

  if (config?.tags?.length) {
    casesToRun = casesToRun.filter((c) =>
      c.tags?.some((t) => config.tags!.includes(t))
    );
  }

  // Run cases (sequentially for now, could add parallelism)
  const results: BenchmarkResult[] = [];

  for (const benchmarkCase of casesToRun) {
    const result = await runBenchmarkCase(benchmarkCase, deps, config);
    results.push(result);
  }

  // Calculate aggregate stats
  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success).length;
  const totalCostUsd = results.reduce((sum, r) => sum + r.metrics.costUsd, 0);
  const avgDurationMs = results.reduce((sum, r) => sum + r.metrics.durationMs, 0) / results.length;
  const avgCostUsd = totalCostUsd / results.length;

  const accuracyScores = results
    .filter((r) => r.accuracy !== undefined)
    .map((r) => r.accuracy!.overallScore);
  const avgAccuracy = accuracyScores.length > 0
    ? accuracyScores.reduce((sum, s) => sum + s, 0) / accuracyScores.length
    : undefined;

  const summary: BenchmarkRunSummary = {
    runId,
    config: config ?? {},
    results,
    stats: {
      totalCases: casesToRun.length,
      successCount,
      failedCount,
      avgDurationMs,
      totalCostUsd,
      avgCostUsd,
      avgAccuracy,
    },
    startedAt,
    completedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - startTime,
  };

  deps.observability.log("info", `[Benchmark] Suite completed: ${suite.name}`, {
    runId,
    successCount,
    failedCount,
    totalCostUsd,
    avgAccuracy,
  });

  return summary;
}

// ============================================
// ACCURACY CALCULATION
// ============================================

/**
 * Calculate accuracy scores against expected outputs
 */
function calculateAccuracy(
  benchmarkCase: BenchmarkCase,
  workspace: Awaited<ReturnType<AnalystWorkspaceManager["load"]>>,
  _manager: AnalystWorkspaceManager
): AccuracyScores {
  const expected = benchmarkCase.expected!;
  const details = {
    matchedClaims: [] as string[],
    missedClaims: [] as string[],
    matchedHypotheses: [] as string[],
    missedHypotheses: [] as string[],
  };

  let scores: number[] = [];

  // Check claims accuracy
  if (expected.claims && workspace) {
    const actualClaims = workspace.claims.claims;

    for (const expectedClaim of expected.claims) {
      const matched = actualClaims.some((c) =>
        c.text.toLowerCase().includes(expectedClaim.pattern.toLowerCase())
      );

      if (matched) {
        details.matchedClaims.push(expectedClaim.pattern);
      } else {
        details.missedClaims.push(expectedClaim.pattern);
      }
    }

    const claimsScore = expected.claims.length > 0
      ? details.matchedClaims.length / expected.claims.length
      : 1;
    scores.push(claimsScore);
  }

  // Check hypotheses accuracy
  if (expected.hypotheses && workspace) {
    const actualHypotheses = workspace.hypotheses.hypotheses;

    for (const expectedHyp of expected.hypotheses) {
      const matched = actualHypotheses.some((h) =>
        h.statement.toLowerCase().includes(expectedHyp.pattern.toLowerCase()) &&
        (!expectedHyp.minConfidence || h.confidence >= expectedHyp.minConfidence)
      );

      if (matched) {
        details.matchedHypotheses.push(expectedHyp.pattern);
      } else {
        details.missedHypotheses.push(expectedHyp.pattern);
      }
    }

    const hypScore = expected.hypotheses.length > 0
      ? details.matchedHypotheses.length / expected.hypotheses.length
      : 1;
    scores.push(hypScore);
  }

  // Overall score (simple average for now)
  const overallScore = scores.length > 0
    ? scores.reduce((sum, s) => sum + s, 0) / scores.length
    : 1;

  return {
    claimsScore: expected.claims
      ? details.matchedClaims.length / expected.claims.length
      : undefined,
    hypothesesScore: expected.hypotheses
      ? details.matchedHypotheses.length / expected.hypotheses.length
      : undefined,
    overallScore,
    details,
  };
}

// ============================================
// RESULT FORMATTING
// ============================================

/**
 * Format benchmark summary as a report
 */
export function formatBenchmarkReport(summary: BenchmarkRunSummary): string {
  const lines: string[] = [];

  lines.push("═".repeat(60));
  lines.push(`Benchmark Run: ${summary.runId}`);
  lines.push("═".repeat(60));
  lines.push("");

  // Stats section
  lines.push("## Summary Statistics");
  lines.push("");
  lines.push(`- Total Cases: ${summary.stats.totalCases}`);
  lines.push(`- Successful: ${summary.stats.successCount}`);
  lines.push(`- Failed: ${summary.stats.failedCount}`);
  lines.push(`- Success Rate: ${((summary.stats.successCount / summary.stats.totalCases) * 100).toFixed(1)}%`);
  lines.push("");
  lines.push(`- Total Duration: ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
  lines.push(`- Avg Duration: ${(summary.stats.avgDurationMs / 1000).toFixed(1)}s per case`);
  lines.push(`- Total Cost: $${summary.stats.totalCostUsd.toFixed(4)}`);
  lines.push(`- Avg Cost: $${summary.stats.avgCostUsd.toFixed(4)} per case`);

  if (summary.stats.avgAccuracy !== undefined) {
    lines.push(`- Avg Accuracy: ${(summary.stats.avgAccuracy * 100).toFixed(1)}%`);
  }

  lines.push("");

  // Individual results
  lines.push("## Individual Results");
  lines.push("");

  for (const result of summary.results) {
    const status = result.success ? "✓" : "✗";
    const accuracy = result.accuracy
      ? ` (accuracy: ${(result.accuracy.overallScore * 100).toFixed(0)}%)`
      : "";

    lines.push(`${status} ${result.caseId}: ${result.metrics.durationMs}ms, $${result.metrics.costUsd.toFixed(4)}${accuracy}`);

    if (!result.success && result.error) {
      lines.push(`  Error: ${result.error}`);
    }
  }

  lines.push("");
  lines.push("═".repeat(60));

  return lines.join("\n");
}

// ============================================
// SAMPLE SUITE
// ============================================

/**
 * Create a sample benchmark suite for testing
 */
export function createSampleSuite(): BenchmarkSuite {
  return {
    id: "sample-v1",
    name: "Sample Benchmark Suite",
    description: "A sample suite for testing the benchmark runner",
    version: "1.0.0",
    cases: [
      {
        id: "quick-factual",
        name: "Quick Factual Query",
        description: "Tests quick research on a simple factual topic",
        input: {
          subject: "Current US Federal Reserve interest rate",
          depth: "quick",
          focus: ["facts"],
        },
        expected: {
          claims: [
            { pattern: "interest rate", minStrength: "medium" },
            { pattern: "federal reserve", minStrength: "low" },
          ],
        },
        tags: ["quick", "factual"],
        maxCostUsd: 0.5,
        timeoutMs: 60000,
      },
      {
        id: "standard-analysis",
        name: "Standard Market Analysis",
        description: "Tests standard depth analysis with predictions",
        input: {
          subject: "Impact of AI regulation on tech stocks",
          depth: "standard",
          focus: ["risks", "prediction"],
        },
        expected: {
          hypotheses: [
            { pattern: "regulation", minConfidence: 0.4 },
          ],
        },
        tags: ["standard", "market"],
        maxCostUsd: 1.0,
        timeoutMs: 180000,
      },
      {
        id: "event-research",
        name: "Event Research",
        description: "Tests research on a specific event",
        input: {
          subject: "2024 US Presidential Election polling trends",
          depth: "standard",
          focus: ["facts", "timeline"],
        },
        tags: ["standard", "event"],
        maxCostUsd: 1.0,
        timeoutMs: 180000,
      },
    ],
    defaults: {
      depth: "standard",
      maxCostUsd: 1.0,
      timeoutMs: 180000,
    },
  };
}
