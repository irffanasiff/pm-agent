/**
 * Research Pipeline - Main Orchestrator
 * Orchestrates the full research flow: Discovery → Research → Critique
 *
 * PIPELINE PHASES:
 * ================
 * Phase 1: DISCOVERY
 *   - Find markets matching the topic
 *   - Either quickDiscovery() (no AI) or runDiscovery() (with AI)
 *   - Output: List of SelectedMarket objects
 *
 * Phase 2: PREPARE DATA
 *   - Fetch fresh market data from Polymarket API
 *   - Save meta.json and orderbook.json for each market
 *   - Runs in parallel for all markets
 *
 * Phase 3: RESEARCH (parallel)
 *   - Run Research Agent (Claude Sonnet) for each market
 *   - Agent uses WebSearch + MCP tools to gather information
 *   - Output: research.json + research.md for each market
 *   - Processes in batches of `concurrency` (default: 3)
 *
 * Phase 4: EVALUATION (parallel)
 *   - Run Critic Agent (Claude Haiku) for each researched market
 *   - Evaluates quality, identifies issues, gives verdict
 *   - Output: evaluation.json for each market
 *   - Marks markets as approved/revise/reject
 *
 * CALL FLOW:
 * ==========
 * index.ts:281 → runPipeline(config)
 *                     ↓
 *               ResearchPipeline.run(config)
 *                     ↓
 *               Phase 1 → Phase 2 → Phase 3 → Phase 4 → Return results
 */

import fs from "fs/promises";
import path from "path";
import { logger } from "../core/logger.js";
import { getConfig } from "../core/config.js";
import { getPolymarketClient } from "../tools/polymarket/client.js";
import { normalizeGammaMarket, normalizeOrderbook } from "../tools/polymarket/types.js";
import {
  runDiscovery,
  quickDiscovery,
  runResearch,
  runCritic,
  type SelectedMarket,
} from "../agents/index.js";
import {
  saveMarketMeta,
  saveOrderbook,
  type ResearchOutput,
  type EvaluationOutput,
  type ResearchDepth,
} from "../schemas/index.js";

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  topic: string;
  maxMarkets?: number;
  researchDepth?: ResearchDepth;
  minVolume?: number;
  minLiquidity?: number;
  skipDiscoveryAgent?: boolean; // Use quick discovery instead
  concurrency?: number;
}

/**
 * Pipeline result summary
 */
export interface PipelineSummary {
  marketsFound: number;
  marketsResearched: number;
  marketsApproved: number;
  totalCostUsd: number;
  totalDurationMs: number;
}

/**
 * Full pipeline result
 */
export interface PipelineResult {
  correlationId: string;
  config: PipelineConfig;
  discovery: {
    markets: SelectedMarket[];
    costUsd: number;
    durationMs: number;
  };
  research: Map<string, ResearchOutput | Error>;
  evaluations: Map<string, EvaluationOutput | Error>;
  summary: PipelineSummary;
  approvedMarkets: string[];
}

// ============================================================
// RESEARCH PIPELINE CLASS
// ============================================================
/**
 * Research Pipeline class
 * Orchestrates all 4 phases of the research process
 */
export class ResearchPipeline {
  private log = logger.child({ component: "pipeline" });
  private client = getPolymarketClient();

  /**
   * Run the full research pipeline
   *
   * EXECUTION FLOW:
   * Phase 1: Discovery → Phase 2: Prepare → Phase 3: Research → Phase 4: Evaluate
   *
   * @param config - Pipeline configuration (topic, maxMarkets, depth, etc.)
   * @returns PipelineResult with all research and evaluations
   */
  async run(config: PipelineConfig): Promise<PipelineResult> {
    const correlationId = crypto.randomUUID();  // Unique ID for tracing
    const startTime = Date.now();

    this.log.info("Pipeline started", { correlationId, config });

    const appConfig = getConfig();

    // Initialize result object to accumulate all output
    const result: PipelineResult = {
      correlationId,
      config,
      discovery: { markets: [], costUsd: 0, durationMs: 0 },
      research: new Map(),      // marketId → ResearchOutput or Error
      evaluations: new Map(),   // marketId → EvaluationOutput or Error
      summary: {
        marketsFound: 0,
        marketsResearched: 0,
        marketsApproved: 0,
        totalCostUsd: 0,
        totalDurationMs: 0,
      },
      approvedMarkets: [],
    };

    try {
      // ========================================================
      // PHASE 1: DISCOVERY
      // Find markets matching the topic
      // ========================================================
      this.log.info("Phase 1: Discovery", { correlationId });

      if (config.skipDiscoveryAgent) {
        // --quick flag: Use simple keyword search (no AI)
        // Faster and cheaper, but less intelligent filtering
        const markets = await quickDiscovery({
          topic: config.topic,
          maxResults: config.maxMarkets ?? 5,
          minVolume: config.minVolume,
        });
        result.discovery = {
          markets,
          costUsd: 0,  // No AI cost
          durationMs: Date.now() - startTime,
        };
      } else {
        // Full discovery with AI agent (Claude Haiku)
        // Agent reads pre-fetched markets and intelligently selects
        // *** FIRST runAgent() CALL HAPPENS HERE ***
        // discovery.ts:135 → runAgent({ profile: "discovery", ... })
        const discoveryResult = await runDiscovery({
          topic: config.topic,
          maxResults: config.maxMarkets ?? 5,
          minVolume: config.minVolume,
          minLiquidity: config.minLiquidity,
          correlationId,
        });
        result.discovery = {
          markets: discoveryResult.markets,
          costUsd: discoveryResult.costUsd,
          durationMs: discoveryResult.durationMs,
        };
      }

      result.summary.marketsFound = result.discovery.markets.length;
      result.summary.totalCostUsd += result.discovery.costUsd;

      this.log.info(`Found ${result.discovery.markets.length} markets`, { correlationId });

      // Early exit if no markets found
      if (result.discovery.markets.length === 0) {
        this.log.warn("No markets found, ending pipeline", { correlationId });
        result.summary.totalDurationMs = Date.now() - startTime;
        return result;
      }

      // ========================================================
      // PHASE 2: PREPARE MARKET DATA
      // Fetch fresh data from Polymarket API for each market
      // ========================================================
      this.log.info("Phase 2: Fetching market data", { correlationId });

      // Run in parallel for all markets
      await Promise.all(
        result.discovery.markets.map((m) => this.prepareMarketData(m.id))
      );
      // After this: data/markets/{id}/meta.json and orderbook.json exist

      // ========================================================
      // PHASE 3: RESEARCH (parallel, batched)
      // Run Research Agent (Claude Sonnet) for each market
      // ========================================================
      this.log.info("Phase 3: Research", {
        correlationId,
        count: result.discovery.markets.length,
      });

      const concurrency = config.concurrency ?? 3;  // Max parallel agents
      const marketIds = result.discovery.markets.map((m) => m.id);

      // Process in batches to control parallelism
      for (let i = 0; i < marketIds.length; i += concurrency) {
        const batch = marketIds.slice(i, i + concurrency);

        // Run up to 3 research agents in parallel
        // Each calls: research.ts:87 → runAgent({ profile: "research", ... })
        const batchResults = await Promise.allSettled(
          batch.map((marketId) =>
            runResearch({
              marketId,
              depth: config.researchDepth ?? "standard",
              correlationId,
            })
          )
        );

        // Collect results (success or error) for each market
        for (let j = 0; j < batch.length; j++) {
          const marketId = batch[j];
          const res = batchResults[j];

          if (res.status === "fulfilled") {
            result.research.set(marketId, res.value.research);
            result.summary.totalCostUsd += res.value.costUsd;
            result.summary.marketsResearched++;
          } else {
            // Store error for this market
            result.research.set(
              marketId,
              res.reason instanceof Error
                ? res.reason
                : new Error(String(res.reason))
            );
          }
        }
      }

      // ========================================================
      // PHASE 4: EVALUATION (parallel, batched)
      // Run Critic Agent (Claude Haiku) for each researched market
      // ========================================================
      this.log.info("Phase 4: Evaluation", { correlationId });

      // Only evaluate markets that were successfully researched
      const researchedIds = Array.from(result.research.entries())
        .filter(([_, r]) => !(r instanceof Error))
        .map(([id]) => id);

      // Process in batches to control parallelism
      for (let i = 0; i < researchedIds.length; i += concurrency) {
        const batch = researchedIds.slice(i, i + concurrency);

        // Run up to 3 critic agents in parallel
        // Each calls: critic.ts:84 → runAgent({ profile: "critic", ... })
        const batchResults = await Promise.allSettled(
          batch.map((marketId) =>
            runCritic({
              marketId,
              correlationId,
            })
          )
        );

        // Collect evaluations and track approvals
        for (let j = 0; j < batch.length; j++) {
          const marketId = batch[j];
          const res = batchResults[j];

          if (res.status === "fulfilled") {
            result.evaluations.set(marketId, res.value.evaluation);
            result.summary.totalCostUsd += res.value.costUsd;

            // Track approved markets (score >= 7, no critical flags)
            if (res.value.approved) {
              result.approvedMarkets.push(marketId);
              result.summary.marketsApproved++;
            }
          } else {
            result.evaluations.set(
              marketId,
              res.reason instanceof Error
                ? res.reason
                : new Error(String(res.reason))
            );
          }
        }
      }

      // ========================================================
      // FINALIZE
      // ========================================================
      result.summary.totalDurationMs = Date.now() - startTime;

      this.log.info("Pipeline complete", {
        correlationId,
        summary: result.summary,
      });

      // Save pipeline summary to data/pipelines/{correlationId}.json
      await this.savePipelineSummary(correlationId, result);

      return result;

    } catch (error) {
      this.log.error("Pipeline failed", error, { correlationId });
      result.summary.totalDurationMs = Date.now() - startTime;
      throw error;
    }
  }

  /**
   * Fetch and save market data from Polymarket
   */
  private async prepareMarketData(marketId: string): Promise<void> {
    const config = getConfig();
    const marketDir = path.join(config.defaults.dataDir, "markets", marketId);
    await fs.mkdir(marketDir, { recursive: true });

    try {
      // Fetch fresh market data (only open markets)
      const markets = await this.client.getMarkets({
        limit: 100,
        active: true,
        closed: false,  // Only get open markets
      });
      const market = markets.find((m) => m.id === marketId);

      if (market) {
        const normalized = normalizeGammaMarket(market);
        await saveMarketMeta(normalized);
        this.log.debug(`Saved market meta for ${marketId}`);

        // Try to get orderbook if we have token IDs
        if (normalized.outcomeYes.tokenId) {
          try {
            const rawOrderbook = await this.client.getOrderbook(
              normalized.outcomeYes.tokenId
            );
            const normalizedOB = normalizeOrderbook(
              rawOrderbook,
              marketId,
              normalized.outcomeYes.tokenId
            );
            await saveOrderbook(normalizedOB);
          } catch {
            // Orderbook might not exist for all markets
          }
        }
      } else {
        this.log.warn(`Market ${marketId} not found in API response`);
      }
    } catch (error) {
      this.log.warn(`Failed to prepare market data: ${marketId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Save pipeline summary to file
   */
  private async savePipelineSummary(
    correlationId: string,
    result: PipelineResult
  ): Promise<void> {
    const config = getConfig();
    const summaryDir = path.join(config.defaults.dataDir, "pipelines");
    await fs.mkdir(summaryDir, { recursive: true });

    const summaryPath = path.join(summaryDir, `${correlationId}.json`);
    await fs.writeFile(
      summaryPath,
      JSON.stringify(
        {
          correlationId,
          config: result.config,
          discovery: {
            markets: result.discovery.markets,
            costUsd: result.discovery.costUsd,
            durationMs: result.discovery.durationMs,
          },
          summary: result.summary,
          approvedMarkets: result.approvedMarkets,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );
  }
}

/**
 * Create and run a pipeline
 */
export async function runPipeline(config: PipelineConfig): Promise<PipelineResult> {
  const pipeline = new ResearchPipeline();
  return pipeline.run(config);
}
