/**
 * Research Pipeline
 * Orchestrates the full research flow: Discovery → Research → Critique
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

/**
 * Research Pipeline class
 */
export class ResearchPipeline {
  private log = logger.child({ component: "pipeline" });
  private client = getPolymarketClient();

  /**
   * Run the full research pipeline
   */
  async run(config: PipelineConfig): Promise<PipelineResult> {
    const correlationId = crypto.randomUUID();
    const startTime = Date.now();

    this.log.info("Pipeline started", { correlationId, config });

    const appConfig = getConfig();

    // Initialize result
    const result: PipelineResult = {
      correlationId,
      config,
      discovery: { markets: [], costUsd: 0, durationMs: 0 },
      research: new Map(),
      evaluations: new Map(),
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
      // Phase 1: Discovery
      this.log.info("Phase 1: Discovery", { correlationId });

      if (config.skipDiscoveryAgent) {
        // Quick discovery without agent
        const markets = await quickDiscovery({
          topic: config.topic,
          maxResults: config.maxMarkets ?? 5,
          minVolume: config.minVolume,
        });
        result.discovery = {
          markets,
          costUsd: 0,
          durationMs: Date.now() - startTime,
        };
      } else {
        // Full discovery with agent
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

      if (result.discovery.markets.length === 0) {
        this.log.warn("No markets found, ending pipeline", { correlationId });
        result.summary.totalDurationMs = Date.now() - startTime;
        return result;
      }

      // Phase 2: Prepare market data (fetch from Polymarket)
      this.log.info("Phase 2: Fetching market data", { correlationId });

      await Promise.all(
        result.discovery.markets.map((m) => this.prepareMarketData(m.id))
      );

      // Phase 3: Research (parallel per market)
      this.log.info("Phase 3: Research", {
        correlationId,
        count: result.discovery.markets.length,
      });

      const concurrency = config.concurrency ?? 3;
      const marketIds = result.discovery.markets.map((m) => m.id);

      for (let i = 0; i < marketIds.length; i += concurrency) {
        const batch = marketIds.slice(i, i + concurrency);

        const batchResults = await Promise.allSettled(
          batch.map((marketId) =>
            runResearch({
              marketId,
              depth: config.researchDepth ?? "standard",
              correlationId,
            })
          )
        );

        for (let j = 0; j < batch.length; j++) {
          const marketId = batch[j];
          const res = batchResults[j];

          if (res.status === "fulfilled") {
            result.research.set(marketId, res.value.research);
            result.summary.totalCostUsd += res.value.costUsd;
            result.summary.marketsResearched++;
          } else {
            result.research.set(
              marketId,
              res.reason instanceof Error
                ? res.reason
                : new Error(String(res.reason))
            );
          }
        }
      }

      // Phase 4: Evaluation (parallel)
      this.log.info("Phase 4: Evaluation", { correlationId });

      const researchedIds = Array.from(result.research.entries())
        .filter(([_, r]) => !(r instanceof Error))
        .map(([id]) => id);

      for (let i = 0; i < researchedIds.length; i += concurrency) {
        const batch = researchedIds.slice(i, i + concurrency);

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
          const res = batchResults[j];

          if (res.status === "fulfilled") {
            result.evaluations.set(marketId, res.value.evaluation);
            result.summary.totalCostUsd += res.value.costUsd;

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

      // Finalize
      result.summary.totalDurationMs = Date.now() - startTime;

      this.log.info("Pipeline complete", {
        correlationId,
        summary: result.summary,
      });

      // Save pipeline summary
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
      // Fetch fresh market data
      const markets = await this.client.getMarkets({ limit: 100, active: true });
      const market = markets.find((m) => m.id === marketId);

      if (market) {
        const normalized = normalizeGammaMarket(market);
        await saveMarketMeta(normalized);

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
