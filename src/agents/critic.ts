/**
 * Critic Agent
 * Evaluates the quality of research output
 */

import fs from "fs/promises";
import path from "path";
import { runAgent } from "../core/agent-runner.js";
import { logger } from "../core/logger.js";
import { AgentError } from "../core/errors.js";
import { getConfig } from "../core/config.js";
import {
  loadResearch,
  loadEvaluation,
  saveEvaluation,
  type EvaluationOutput,
  EvaluationOutputSchema,
  isResearchApproved,
  getAverageScore,
} from "../schemas/index.js";
import { getCriticPrompt } from "./prompts.js";

/**
 * Critic input configuration
 */
export interface CriticInput {
  marketId: string;
  correlationId?: string;
}

/**
 * Critic result
 */
export interface CriticResult {
  evaluation: EvaluationOutput;
  approved: boolean;
  costUsd: number;
  durationMs: number;
}

/**
 * Run the critic agent on a market's research
 */
export async function runCritic(input: CriticInput): Promise<CriticResult> {
  const config = getConfig();
  const correlationId = input.correlationId ?? crypto.randomUUID();

  const log = logger.child({
    correlationId,
    agentType: "critic",
    marketId: input.marketId,
  });

  log.info("Starting evaluation");

  const startTime = Date.now();

  // Step 1: Check if research exists
  const research = await loadResearch(input.marketId);

  if (!research) {
    throw new AgentError(
      `Research not found for market: ${input.marketId}`,
      "critic",
      { correlationId }
    );
  }

  log.debug("Loaded research", {
    researchedAt: research.researchedAt,
    depth: research.depth,
  });

  // Step 2: Get the data directory for this market
  const dataDir = path.join(config.defaults.dataDir, "markets", input.marketId);

  // Step 3: Build the prompt
  const prompt = getCriticPrompt({
    marketId: input.marketId,
    dataDir,
  });

  // Step 4: Run the agent
  const agentResult = await runAgent({
    profile: "critic",
    prompt,
    correlationId,
    context: { marketId: input.marketId },
  });

  if (!agentResult.success) {
    throw new AgentError(
      agentResult.error?.message ?? "Critic agent failed",
      "critic",
      {
        correlationId,
        cause: agentResult.error,
        context: { marketId: input.marketId },
      }
    );
  }

  // Step 5: Read and validate the evaluation output
  const evalFile = path.join(dataDir, "evaluation.json");
  let evaluation: EvaluationOutput;

  try {
    const content = await fs.readFile(evalFile, "utf-8");
    evaluation = EvaluationOutputSchema.parse(JSON.parse(content));
  } catch (error) {
    log.warn("Could not read evaluation output, creating fallback", {
      error: error instanceof Error ? error.message : String(error),
    });

    // Create a basic evaluation from agent output
    const now = new Date().toISOString();
    evaluation = {
      marketId: input.marketId,
      evaluatedAt: now,
      researchVersion: research.researchedAt,

      scores: {
        overall: 5,
        dataCompleteness: research.snapshot.volume > 0 ? 7 : 3,
        analysisDepth: research.keyDrivers.length > 0 ? 6 : 4,
        sourceQuality: research.sources.length > 3 ? 7 : 4,
        riskIdentification: research.risks.length > 0 ? 6 : 3,
        logicalConsistency: research.assessment.reasoning ? 7 : 5,
      },

      flags: [],
      suggestions: [],

      verdict: {
        decision: "revise",
        confidence: "low",
        summary: "Automated evaluation - manual review recommended",
      },

      metadata: {
        model: "claude-haiku",
        tokens: { input: 0, output: 0 },
        cost: agentResult.costUsd,
        duration: agentResult.durationMs,
      },
    };

    // Recalculate overall score
    evaluation.scores.overall = Math.round(getAverageScore(evaluation.scores) * 10) / 10;

    // Save the fallback evaluation
    await saveEvaluation(evaluation);
  }

  // Update metadata with actual costs
  evaluation.metadata.cost = agentResult.costUsd;
  evaluation.metadata.duration = agentResult.durationMs;

  const duration = Date.now() - startTime;
  const approved = isResearchApproved(evaluation);

  log.info("Evaluation complete", {
    marketId: input.marketId,
    verdict: evaluation.verdict.decision,
    overall: evaluation.scores.overall,
    approved,
    costUsd: agentResult.costUsd,
    durationMs: duration,
  });

  return {
    evaluation,
    approved,
    costUsd: agentResult.costUsd,
    durationMs: duration,
  };
}

/**
 * Run critic on multiple markets in parallel
 */
export async function runBatchCritic(
  marketIds: string[],
  options: {
    concurrency?: number;
    correlationId?: string;
  } = {}
): Promise<Map<string, CriticResult | Error>> {
  const { concurrency = 5, correlationId } = options;

  const log = logger.child({
    correlationId,
    agentType: "critic-batch",
    marketCount: marketIds.length,
  });

  log.info("Starting batch evaluation", { concurrency });

  const results = new Map<string, CriticResult | Error>();

  // Process in batches of `concurrency`
  for (let i = 0; i < marketIds.length; i += concurrency) {
    const batch = marketIds.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map((marketId) =>
        runCritic({
          marketId,
          correlationId,
        })
      )
    );

    for (let j = 0; j < batch.length; j++) {
      const marketId = batch[j];
      const result = batchResults[j];

      if (result.status === "fulfilled") {
        results.set(marketId, result.value);
      } else {
        results.set(
          marketId,
          result.reason instanceof Error
            ? result.reason
            : new Error(String(result.reason))
        );
      }
    }
  }

  const successful = Array.from(results.values()).filter(
    (r) => !(r instanceof Error)
  ).length;
  const approved = Array.from(results.values()).filter(
    (r) => !(r instanceof Error) && r.approved
  ).length;

  log.info("Batch evaluation complete", {
    total: marketIds.length,
    successful,
    approved,
    failed: marketIds.length - successful,
  });

  return results;
}

/**
 * Check if evaluation exists and is recent
 */
export async function hasRecentEvaluation(
  marketId: string,
  maxAgeHours: number = 24
): Promise<boolean> {
  const evaluation = await loadEvaluation(marketId);

  if (!evaluation) {
    return false;
  }

  const age =
    (Date.now() - new Date(evaluation.evaluatedAt).getTime()) / (1000 * 60 * 60);
  return age <= maxAgeHours;
}
