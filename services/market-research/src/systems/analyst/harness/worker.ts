/**
 * Analyst Worker
 * Iterative worker that processes one feature per run
 */

import type { IStore } from "../../../shared/store/types.js";
import type { IExecutor } from "../../../shared/executor/types.js";
import type { IObservability } from "../../../shared/observability/types.js";
import type { AgentContext } from "../../../shared/agent/types.js";
import type { Feature } from "../workspace/types.js";
import { AnalystWorkspaceManager } from "../workspace/manager.js";
import { ResearcherAgent } from "../agents/researcher/agent.js";

// ============================================
// TYPES
// ============================================

export interface WorkerDependencies {
  store: IStore;
  executor: IExecutor;
  observability: IObservability;
}

export interface WorkerResult {
  success: boolean;
  targetId: string;

  /** Feature that was worked on */
  feature?: {
    id: string;
    name: string;
    status: "completed" | "failed" | "pending";
  };

  /** Overall workspace progress (0-1) */
  progress: number;

  /** Whether there's more work to do */
  hasMoreWork: boolean;

  /** Cost of this run */
  costUsd: number;

  /** Duration of this run */
  durationMs: number;

  /** Error if failed */
  error?: string;
}

export interface WorkerOptions {
  /** Maximum cost for this worker run */
  maxCostUsd?: number;

  /** Maximum duration for this worker run */
  maxDurationMs?: number;

  /** Specific feature ID to work on (overrides auto-selection) */
  featureId?: string;

  /** Domain context */
  domain?: string;

  /** Additional context for the agent */
  context?: Record<string, unknown>;
}

// ============================================
// WORKER
// ============================================

/**
 * Run one iteration of the analyst worker
 *
 * Pattern:
 * 1. Get bearings (load workspace, understand current state)
 * 2. Select next feature to work on
 * 3. Execute research for that feature
 * 4. Update workspace with results
 * 5. Clean exit with status
 */
export async function runWorker(
  targetId: string,
  deps: WorkerDependencies,
  options: WorkerOptions = {}
): Promise<WorkerResult> {
  const startTime = Date.now();
  const { store, executor, observability } = deps;
  const correlationId = crypto.randomUUID();

  observability.log("info", `[Worker] Starting worker run`, {
    targetId,
    correlationId,
  });

  // Track session
  const sessionId = await observability.startSession({
    agentName: "analyst-worker",
    agentVersion: "1.0.0",
    correlationId,
    input: { targetId, options },
  });

  try {
    // ========================================
    // STEP 1: GET BEARINGS
    // ========================================
    const workspaceManager = new AnalystWorkspaceManager(store);
    const workspace = await workspaceManager.load(targetId);

    if (!workspace) {
      throw new Error(`Workspace not found for target: ${targetId}`);
    }

    observability.log("info", `[Worker] Workspace loaded`, {
      progress: workspace.featureList.progress,
      pendingFeatures: workspace.featureList.features.filter((f) => f.status === "pending").length,
    });

    // Check if already complete
    if (workspace.featureList.progress >= 1) {
      return {
        success: true,
        targetId,
        progress: 1,
        hasMoreWork: false,
        costUsd: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // ========================================
    // STEP 2: SELECT NEXT FEATURE
    // ========================================
    let feature: Feature | null = null;

    if (options.featureId) {
      feature = workspace.featureList.features.find((f) => f.id === options.featureId) ?? null;
    } else {
      feature = await workspaceManager.getNextFeature(targetId);
    }

    if (!feature) {
      observability.log("info", `[Worker] No features to work on`);
      return {
        success: true,
        targetId,
        progress: workspace.featureList.progress,
        hasMoreWork: false,
        costUsd: 0,
        durationMs: Date.now() - startTime,
      };
    }

    observability.log("info", `[Worker] Selected feature`, {
      featureId: feature.id,
      featureName: feature.name,
      attempt: feature.attempts + 1,
    });

    // Mark feature as in progress
    await workspaceManager.startFeature(targetId, feature.id);

    // ========================================
    // STEP 3: EXECUTE RESEARCH
    // ========================================
    const researcher = new ResearcherAgent({
      store,
      executor,
      observability,
    });

    // Build context from workspace
    const workspaceSummary = await workspaceManager.getSummary(targetId);
    const recentHypotheses = workspace.hypotheses.hypotheses
      .filter((h) => h.status === "active")
      .slice(0, 3);
    const recentClaims = workspace.claims.claims
      .slice(-5)
      .map((c) => ({ text: c.text, strength: c.strength, verified: c.verified }));

    const agentContext: AgentContext = {
      correlationId,
      sessionId,
      targetId,
      systemName: "analyst",
      domain: options.domain,
      metadata: {
        featureId: feature.id,
        featureName: feature.name,
        workspaceSummary,
        activeHypotheses: recentHypotheses.map((h) => ({
          statement: h.statement,
          confidence: h.confidence,
        })),
        ...options.context,
      },
      limits: {
        maxCostUsd: options.maxCostUsd ?? 0.5,
        maxDurationMs: options.maxDurationMs ?? 120000,
      },
    };

    // Build prompt for this specific feature
    const prompt = buildFeaturePrompt(
      workspace.featureList.subject,
      feature,
      workspaceSummary,
      recentHypotheses,
      recentClaims
    );

    const result = await researcher.run(
      {
        subject: prompt,
        targetId,
        depth: "standard",
        focus: [feature.category ?? "facts"],
        context: options.context,
      },
      agentContext
    );

    // ========================================
    // STEP 4: UPDATE WORKSPACE
    // ========================================
    if (result.success) {
      await workspaceManager.completeFeature(
        targetId,
        feature.id,
        result.output.summary
      );

      // Extract and add claims from key points
      for (const keyPoint of result.output.findings.keyPoints) {
        if (keyPoint.confidence === "high" && keyPoint.evidence.length > 0) {
          await workspaceManager.addClaim(targetId, keyPoint.point,
            result.output.sources
              .filter((s) => keyPoint.evidence.some((e) => e.toLowerCase().includes(s.title.toLowerCase())))
              .map((s) => ({
                title: s.title,
                url: s.url,
                type: s.type,
                accessedAt: s.retrievedAt,
                quote: s.keyQuote,
                credibility: s.credibility,
              })),
            {
              strength: keyPoint.confidence === "high" ? "high" : "medium",
              tags: keyPoint.category ? [keyPoint.category] : undefined,
            }
          );
        }
      }

      // Update hypothesis confidence based on evidence found
      const activeHypotheses = workspace.hypotheses.hypotheses.filter((h) => h.status === "active");
      for (const hypothesis of activeHypotheses) {
        // Check supporting perspectives
        const supportingEvidence = result.output.findings.perspectives.supporting
          .filter((p) =>
            p.claim.toLowerCase().includes(hypothesis.statement.toLowerCase().slice(0, 30)) ||
            hypothesis.statement.toLowerCase().includes(p.claim.toLowerCase().slice(0, 30))
          );

        // Check opposing perspectives
        const opposingEvidence = result.output.findings.perspectives.opposing
          .filter((p) =>
            p.claim.toLowerCase().includes(hypothesis.statement.toLowerCase().slice(0, 30)) ||
            hypothesis.statement.toLowerCase().includes(p.claim.toLowerCase().slice(0, 30))
          );

        // Update confidence if we found relevant evidence
        if (supportingEvidence.length > 0 || opposingEvidence.length > 0) {
          const confidenceAdjustment =
            (supportingEvidence.length * 0.1) - (opposingEvidence.length * 0.15);
          const newConfidence = Math.max(0, Math.min(1, hypothesis.confidence + confidenceAdjustment));

          const evidence = supportingEvidence[0] ?? opposingEvidence[0];
          if (evidence && Math.abs(confidenceAdjustment) > 0.05) {
            await workspaceManager.updateHypothesisConfidence(
              targetId,
              hypothesis.id,
              newConfidence,
              {
                description: evidence.claim,
                source: evidence.source,
                strength: evidence.strength ?? "moderate",
                supporting: supportingEvidence.length > 0,
              }
            );
          }
        }
      }

      // Extract and add any new hypotheses from research
      if (result.output.assessment?.prediction) {
        const pred = result.output.assessment.prediction;
        await workspaceManager.addHypothesis(
          targetId,
          pred.outcome,
          pred.probability,
          "prediction"
        );
      }

      observability.log("info", `[Worker] Feature completed`, {
        featureId: feature.id,
        costUsd: result.metadata.costUsd,
        claimsExtracted: result.output.findings.keyPoints.filter((k) => k.confidence === "high").length,
      });
    } else {
      await workspaceManager.failFeature(
        targetId,
        feature.id,
        result.error?.message ?? "Unknown error"
      );

      observability.log("warn", `[Worker] Feature failed`, {
        featureId: feature.id,
        error: result.error?.message,
      });
    }

    // ========================================
    // STEP 5: CLEAN EXIT
    // ========================================
    const updatedWorkspace = await workspaceManager.load(targetId);
    const hasMoreWork = (updatedWorkspace?.featureList.progress ?? 0) < 1;

    await observability.endSession(sessionId, {
      success: result.success,
      output: {
        feature: {
          id: feature.id,
          name: feature.name,
          status: result.success ? "completed" : "failed",
        },
        progress: updatedWorkspace?.featureList.progress ?? 0,
      },
      metadata: {
        durationMs: Date.now() - startTime,
        costUsd: result.metadata.costUsd,
      },
    });

    return {
      success: result.success,
      targetId,
      feature: {
        id: feature.id,
        name: feature.name,
        status: result.success ? "completed" : (feature.attempts >= 3 ? "failed" : "pending"),
      },
      progress: updatedWorkspace?.featureList.progress ?? 0,
      hasMoreWork,
      costUsd: result.metadata.costUsd,
      durationMs: Date.now() - startTime,
      error: result.error?.message,
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    observability.log("error", `[Worker] Worker failed`, {
      targetId,
      error: errorMsg,
    });

    await observability.endSession(sessionId, {
      success: false,
      error,
      metadata: { durationMs: Date.now() - startTime },
    });

    return {
      success: false,
      targetId,
      progress: 0,
      hasMoreWork: true,
      costUsd: 0,
      durationMs: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

/**
 * Run worker until completion or budget exhausted
 */
export async function runWorkerLoop(
  targetId: string,
  deps: WorkerDependencies,
  options: {
    maxIterations?: number;
    maxTotalCostUsd?: number;
    maxTotalDurationMs?: number;
    domain?: string;
  } = {}
): Promise<{
  success: boolean;
  iterations: number;
  totalCostUsd: number;
  totalDurationMs: number;
  finalProgress: number;
}> {
  const maxIterations = options.maxIterations ?? 10;
  const maxTotalCost = options.maxTotalCostUsd ?? 5;
  const maxTotalDuration = options.maxTotalDurationMs ?? 600000; // 10 minutes

  let iterations = 0;
  let totalCost = 0;
  let totalDuration = 0;
  let finalProgress = 0;

  const startTime = Date.now();

  while (iterations < maxIterations) {
    // Check budget
    if (totalCost >= maxTotalCost) {
      deps.observability.log("info", `[WorkerLoop] Budget exhausted`, { totalCost });
      break;
    }

    // Check time
    if (Date.now() - startTime >= maxTotalDuration) {
      deps.observability.log("info", `[WorkerLoop] Time limit reached`);
      break;
    }

    const result = await runWorker(targetId, deps, {
      maxCostUsd: Math.min(0.5, maxTotalCost - totalCost),
      domain: options.domain,
    });

    iterations++;
    totalCost += result.costUsd;
    totalDuration += result.durationMs;
    finalProgress = result.progress;

    if (!result.hasMoreWork) {
      deps.observability.log("info", `[WorkerLoop] All features completed`);
      break;
    }

    if (!result.success) {
      deps.observability.log("warn", `[WorkerLoop] Iteration failed, continuing`, {
        error: result.error,
      });
    }
  }

  return {
    success: finalProgress >= 1,
    iterations,
    totalCostUsd: totalCost,
    totalDurationMs: totalDuration,
    finalProgress,
  };
}

// ============================================
// HELPERS
// ============================================

/**
 * Build prompt for a specific feature
 */
function buildFeaturePrompt(
  subject: string,
  feature: Feature,
  workspaceSummary: string,
  hypotheses: Array<{ statement: string; confidence: number }>,
  recentClaims?: Array<{ text: string; strength: string; verified: boolean }>
): string {
  let prompt = `## Research Task

**Overall Subject:** ${subject}

**Current Focus:** ${feature.name}

**Task:** ${feature.description}

`;

  if (workspaceSummary) {
    prompt += `## Current Progress

${workspaceSummary}

`;
  }

  if (hypotheses.length > 0) {
    prompt += `## Working Hypotheses

Consider these active hypotheses during your research:

${hypotheses.map((h) => `- [${(h.confidence * 100).toFixed(0)}% confidence] ${h.statement}`).join("\n")}

If you find evidence that supports or contradicts these hypotheses, note it in your findings.

`;
  }

  if (recentClaims && recentClaims.length > 0) {
    prompt += `## Established Claims

The following claims have been established from previous research:

${recentClaims.map((c) => `- [${c.strength}${c.verified ? ", verified" : ""}] ${c.text}`).join("\n")}

Build upon these claims where relevant. If you find contradicting information, note it explicitly.

`;
  }

  prompt += `## Instructions

1. Focus specifically on: ${feature.name}
2. Be thorough but stay within scope
3. Cite sources for all claims - high-confidence findings with sources will be saved as claims
4. Note any new hypotheses that emerge - predictions will be tracked as hypotheses
5. Identify any blockers or dependencies
6. Look for evidence that supports or contradicts existing hypotheses

Begin your research now.`;

  return prompt;
}
