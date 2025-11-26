/**
 * Research Agent
 * Performs deep research on a specific market
 */

import fs from "fs/promises";
import path from "path";
import { runAgent } from "../core/agent-runner.js";
import { logger } from "../core/logger.js";
import { AgentError } from "../core/errors.js";
import { getConfig } from "../core/config.js";
import {
  loadMarketMeta,
  loadResearch,
  saveResearch,
  type ResearchOutput,
  type ResearchDepth,
  ResearchOutputSchema,
} from "../schemas/index.js";
import { getResearchPrompt } from "./prompts.js";

/**
 * Research input configuration
 */
export interface ResearchInput {
  marketId: string;
  depth?: ResearchDepth;
  correlationId?: string;
}

/**
 * Research result
 */
export interface ResearchResult {
  research: ResearchOutput;
  costUsd: number;
  durationMs: number;
}

/**
 * Run the research agent on a market
 */
export async function runResearch(input: ResearchInput): Promise<ResearchResult> {
  const config = getConfig();
  const correlationId = input.correlationId ?? crypto.randomUUID();
  const depth = input.depth ?? "standard";

  const log = logger.child({
    correlationId,
    agentType: "research",
    marketId: input.marketId,
    depth,
  });

  log.info("Starting research");

  const startTime = Date.now();

  // Step 1: Load market metadata
  const meta = await loadMarketMeta(input.marketId);

  if (!meta) {
    throw new AgentError(
      `Market metadata not found: ${input.marketId}`,
      "research",
      { correlationId }
    );
  }

  log.debug("Loaded market metadata", {
    question: meta.question.slice(0, 50),
    volume: meta.volume,
  });

  // Step 2: Get the data directory for this market
  const dataDir = path.join(config.defaults.dataDir, "markets", input.marketId);

  // Step 3: Build the prompt
  const prompt = getResearchPrompt({
    marketId: input.marketId,
    question: meta.question,
    depth,
    dataDir,
  });

  // Step 4: Run the agent
  const agentResult = await runAgent({
    profile: "research",
    prompt,
    correlationId,
    context: {
      marketId: input.marketId,
      depth,
    },
  });

  if (!agentResult.success) {
    throw new AgentError(
      agentResult.error?.message ?? "Research agent failed",
      "research",
      {
        correlationId,
        cause: agentResult.error,
        context: { marketId: input.marketId },
      }
    );
  }

  // Step 5: Read and validate the research output
  const researchFile = path.join(dataDir, "research.json");
  let research: ResearchOutput;

  try {
    const content = await fs.readFile(researchFile, "utf-8");
    research = ResearchOutputSchema.parse(JSON.parse(content));
  } catch (error) {
    log.warn("Could not read research output, creating from agent output", {
      error: error instanceof Error ? error.message : String(error),
    });

    // Create a basic research output from what we know
    const now = new Date().toISOString();
    research = {
      marketId: input.marketId,
      question: meta.question,
      researchedAt: now,
      depth,

      snapshot: {
        priceYes: meta.outcomeYes.price,
        priceNo: meta.outcomeNo.price,
        volume: meta.volume,
        liquidity: meta.liquidity,
        daysToResolution: Math.max(
          0,
          Math.ceil(
            (new Date(meta.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          )
        ),
      },

      summary: agentResult.output.slice(0, 500),
      keyDrivers: [],

      arguments: {
        forYes: [],
        forNo: [],
      },

      risks: [],

      resolution: {
        criteria: "See market description",
        source: meta.resolutionSource ?? "Polymarket",
        ambiguityLevel: "medium",
        concerns: [],
      },

      assessment: {
        impliedProbYes: meta.outcomeYes.price,
      },

      sources: [],

      metadata: {
        model: "claude-sonnet",
        tokens: { input: 0, output: 0 },
        cost: agentResult.costUsd,
        duration: agentResult.durationMs,
        toolsUsed: agentResult.toolsUsed,
      },
    };

    // Save the fallback research
    await saveResearch(research);
  }

  // Update metadata with actual costs
  research.metadata.cost = agentResult.costUsd;
  research.metadata.duration = agentResult.durationMs;
  research.metadata.toolsUsed = agentResult.toolsUsed;

  const duration = Date.now() - startTime;

  log.info("Research complete", {
    marketId: input.marketId,
    depth,
    costUsd: agentResult.costUsd,
    durationMs: duration,
    sourcesFound: research.sources.length,
  });

  return {
    research,
    costUsd: agentResult.costUsd,
    durationMs: duration,
  };
}

/**
 * Run research on multiple markets in parallel
 */
export async function runBatchResearch(
  marketIds: string[],
  options: {
    depth?: ResearchDepth;
    concurrency?: number;
    correlationId?: string;
  } = {}
): Promise<Map<string, ResearchResult | Error>> {
  const { depth = "standard", concurrency = 3, correlationId } = options;

  const log = logger.child({
    correlationId,
    agentType: "research-batch",
    marketCount: marketIds.length,
  });

  log.info("Starting batch research", { concurrency, depth });

  const results = new Map<string, ResearchResult | Error>();

  // Process in batches of `concurrency`
  for (let i = 0; i < marketIds.length; i += concurrency) {
    const batch = marketIds.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map((marketId) =>
        runResearch({
          marketId,
          depth,
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

  log.info("Batch research complete", {
    total: marketIds.length,
    successful,
    failed: marketIds.length - successful,
  });

  return results;
}

/**
 * Check if research exists and is recent
 */
export async function hasRecentResearch(
  marketId: string,
  maxAgeHours: number = 24
): Promise<boolean> {
  const research = await loadResearch(marketId);

  if (!research) {
    return false;
  }

  const age =
    (Date.now() - new Date(research.researchedAt).getTime()) / (1000 * 60 * 60);
  return age <= maxAgeHours;
}
