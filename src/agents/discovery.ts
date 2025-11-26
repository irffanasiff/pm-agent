/**
 * Discovery Agent
 * Finds and filters relevant markets from Polymarket
 */

import fs from "fs/promises";
import path from "path";
import { runAgent } from "../core/agent-runner.js";
import { logger } from "../core/logger.js";
import { AgentError } from "../core/errors.js";
import { getConfig } from "../core/config.js";
import { getPolymarketClient } from "../tools/polymarket/client.js";
import { normalizeGammaMarket, type GammaMarket } from "../tools/polymarket/types.js";
import { getDiscoveryPrompt } from "./prompts.js";

/**
 * Discovery input configuration
 */
export interface DiscoveryInput {
  topic: string;
  maxResults?: number;
  minVolume?: number;
  minLiquidity?: number;
  correlationId?: string;
}

/**
 * Selected market from discovery
 */
export interface SelectedMarket {
  id: string;
  slug: string;
  question: string;
  category: string;
  volume: number;
  liquidity: number;
  relevanceScore: number;
  relevanceReason: string;
}

/**
 * Discovery result
 */
export interface DiscoveryResult {
  markets: SelectedMarket[];
  totalFetched: number;
  costUsd: number;
  durationMs: number;
}

/**
 * Run the discovery agent
 */
export async function runDiscovery(input: DiscoveryInput): Promise<DiscoveryResult> {
  const config = getConfig();
  const correlationId = input.correlationId ?? crypto.randomUUID();

  const log = logger.child({
    correlationId,
    agentType: "discovery",
    topic: input.topic,
  });

  log.info("Starting discovery", {
    maxResults: input.maxResults,
    minVolume: input.minVolume,
  });

  const startTime = Date.now();

  // Step 1: Fetch markets from Polymarket
  log.debug("Fetching markets from Polymarket");
  const client = getPolymarketClient();

  // Fetch more markets than needed to filter down
  const fetchLimit = Math.max((input.maxResults ?? 10) * 5, 50);
  const rawMarkets = await client.getMarkets({
    limit: fetchLimit,
    active: true,
  });

  log.info(`Fetched ${rawMarkets.length} markets from Polymarket`);

  // Step 2: Pre-filter by volume/liquidity if specified
  let filteredMarkets = rawMarkets;

  if (input.minVolume !== undefined) {
    filteredMarkets = filteredMarkets.filter(
      (m) => (typeof m.volume === "number" ? m.volume : 0) >= (input.minVolume ?? 0)
    );
  }

  if (input.minLiquidity !== undefined) {
    filteredMarkets = filteredMarkets.filter(
      (m) => (typeof m.liquidity === "number" ? m.liquidity : 0) >= (input.minLiquidity ?? 0)
    );
  }

  log.debug(`After pre-filtering: ${filteredMarkets.length} markets`);

  // Step 3: Prepare data directory
  const discoveryDir = path.join(config.defaults.dataDir, "markets", "discovery");
  await fs.mkdir(discoveryDir, { recursive: true });

  // Save markets for the agent to read
  const marketsFile = path.join(discoveryDir, "markets.json");
  await fs.writeFile(
    marketsFile,
    JSON.stringify(
      filteredMarkets.map((m) => ({
        id: m.id,
        slug: m.slug,
        question: m.question,
        description: m.description,
        category: m.category,
        volume: m.volume,
        liquidity: m.liquidity,
        endDate: m.endDate,
        active: m.active,
        closed: m.closed,
      })),
      null,
      2
    )
  );

  // Step 4: Run the agent
  const prompt = getDiscoveryPrompt({
    topic: input.topic,
    maxResults: input.maxResults ?? 10,
    minVolume: input.minVolume,
    minLiquidity: input.minLiquidity,
  });

  const agentResult = await runAgent({
    profile: "discovery",
    prompt,
    correlationId,
  });

  if (!agentResult.success) {
    throw new AgentError(
      agentResult.error?.message ?? "Discovery agent failed",
      "discovery",
      {
        correlationId,
        cause: agentResult.error,
      }
    );
  }

  // Step 5: Read the selected markets
  const selectedFile = path.join(discoveryDir, "selected.json");
  let selectedMarkets: SelectedMarket[] = [];

  try {
    const content = await fs.readFile(selectedFile, "utf-8");
    selectedMarkets = JSON.parse(content);
  } catch (error) {
    log.warn("Could not read selected markets, using fallback", {
      error: error instanceof Error ? error.message : String(error),
    });

    // Fallback: Use top markets by volume
    selectedMarkets = filteredMarkets
      .sort((a, b) => ((b.volume as number) ?? 0) - ((a.volume as number) ?? 0))
      .slice(0, input.maxResults ?? 10)
      .map((m) => ({
        id: m.id,
        slug: m.slug,
        question: m.question,
        category: m.category ?? "Unknown",
        volume: (m.volume as number) ?? 0,
        liquidity: (m.liquidity as number) ?? 0,
        relevanceScore: 0.5,
        relevanceReason: "Fallback: selected by volume",
      }));
  }

  // Step 6: Save normalized market data for selected markets
  for (const selected of selectedMarkets) {
    const rawMarket = rawMarkets.find((m) => m.id === selected.id);
    if (rawMarket) {
      const normalized = normalizeGammaMarket(rawMarket);
      const marketDir = path.join(config.defaults.dataDir, "markets", selected.id);
      await fs.mkdir(marketDir, { recursive: true });
      await fs.writeFile(
        path.join(marketDir, "meta.json"),
        JSON.stringify(normalized, null, 2)
      );
    }
  }

  const duration = Date.now() - startTime;

  log.info("Discovery complete", {
    found: selectedMarkets.length,
    totalFetched: rawMarkets.length,
    costUsd: agentResult.costUsd,
    durationMs: duration,
  });

  return {
    markets: selectedMarkets,
    totalFetched: rawMarkets.length,
    costUsd: agentResult.costUsd,
    durationMs: duration,
  };
}

/**
 * Quick discovery without agent (uses simple filtering)
 * Useful for testing or when you don't need AI-based relevance scoring
 */
export async function quickDiscovery(input: {
  topic: string;
  maxResults?: number;
  minVolume?: number;
}): Promise<SelectedMarket[]> {
  const client = getPolymarketClient();
  const results = await client.searchMarkets(input.topic, {
    limit: 100,
    active: true,
  });

  let filtered = results;

  if (input.minVolume !== undefined) {
    filtered = filtered.filter(
      (m) => ((m.volume as number) ?? 0) >= (input.minVolume ?? 0)
    );
  }

  return filtered
    .sort((a, b) => ((b.volume as number) ?? 0) - ((a.volume as number) ?? 0))
    .slice(0, input.maxResults ?? 10)
    .map((m) => ({
      id: m.id,
      slug: m.slug,
      question: m.question,
      category: m.category ?? "Unknown",
      volume: (m.volume as number) ?? 0,
      liquidity: (m.liquidity as number) ?? 0,
      relevanceScore: 1.0,
      relevanceReason: `Matches search term: ${input.topic}`,
    }));
}
