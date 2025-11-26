#!/usr/bin/env node
/**
 * PM Agent CLI
 * Research agent for Polymarket prediction markets
 */

import "dotenv/config";
import { logger } from "./core/logger.js";
import { getConfig } from "./core/config.js";
import { runPipeline, type PipelineConfig } from "./pipeline/research-pipeline.js";
import { quickDiscovery } from "./agents/index.js";
import type { ResearchDepth } from "./schemas/index.js";

/**
 * Parse command line arguments
 */
function parseArgs(): {
  command: string;
  topic: string;
  options: {
    maxMarkets?: number;
    depth?: ResearchDepth;
    minVolume?: number;
    quick?: boolean;
    verbose?: boolean;
  };
} {
  const args = process.argv.slice(2);

  // Default values
  const result = {
    command: "research",
    topic: "",
    options: {
      maxMarkets: 5,
      depth: "standard" as ResearchDepth,
      minVolume: undefined as number | undefined,
      quick: false,
      verbose: false,
    },
  };

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "discover" || arg === "research" || arg === "help") {
      result.command = arg;
    } else if (arg === "--topic" || arg === "-t") {
      result.topic = args[++i] ?? "";
    } else if (arg === "--max" || arg === "-m") {
      result.options.maxMarkets = parseInt(args[++i] ?? "5", 10);
    } else if (arg === "--depth" || arg === "-d") {
      const depth = args[++i];
      if (depth === "quick" || depth === "standard" || depth === "deep") {
        result.options.depth = depth;
      }
    } else if (arg === "--min-volume") {
      result.options.minVolume = parseInt(args[++i] ?? "0", 10);
    } else if (arg === "--quick" || arg === "-q") {
      result.options.quick = true;
    } else if (arg === "--verbose" || arg === "-v") {
      result.options.verbose = true;
    } else if (!arg.startsWith("-") && !result.topic) {
      result.topic = arg;
    }
  }

  return result;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
PM Agent - Polymarket Research Agent

USAGE:
  npm run research -- [command] [options]
  npx tsx src/index.ts [command] [options]

COMMANDS:
  research <topic>    Run full research pipeline (default)
  discover <topic>    Only discover markets, no research
  help               Show this help message

OPTIONS:
  -t, --topic <topic>     Topic to research (e.g., "crypto", "elections")
  -m, --max <number>      Maximum markets to research (default: 5)
  -d, --depth <level>     Research depth: quick, standard, deep (default: standard)
      --min-volume <usd>  Minimum market volume in USD
  -q, --quick             Use quick discovery (no agent)
  -v, --verbose           Enable debug logging

EXAMPLES:
  npm run research -- crypto
  npm run research -- --topic "US elections" --max 3 --depth deep
  npm run research -- discover "bitcoin" --min-volume 10000

OUTPUT:
  Results are saved to ./data/markets/{marketId}/
  - meta.json       Market metadata
  - research.json   Structured research
  - research.md     Human-readable research
  - evaluation.json Critic evaluation
`);
}

/**
 * Format and display results
 */
function displayResults(result: Awaited<ReturnType<typeof runPipeline>>): void {
  console.log("\n" + "=".repeat(60));
  console.log("PIPELINE RESULTS");
  console.log("=".repeat(60));

  console.log(`\nCorrelation ID: ${result.correlationId}`);
  console.log(`Topic: ${result.config.topic}`);
  console.log(`Depth: ${result.config.researchDepth ?? "standard"}`);

  console.log("\n--- Summary ---");
  console.log(`Markets Found:      ${result.summary.marketsFound}`);
  console.log(`Markets Researched: ${result.summary.marketsResearched}`);
  console.log(`Markets Approved:   ${result.summary.marketsApproved}`);
  console.log(`Total Cost:         $${result.summary.totalCostUsd.toFixed(4)}`);
  console.log(`Total Duration:     ${(result.summary.totalDurationMs / 1000).toFixed(1)}s`);

  if (result.approvedMarkets.length > 0) {
    console.log("\n--- Approved Markets ---");
    for (const marketId of result.approvedMarkets) {
      const market = result.discovery.markets.find((m) => m.id === marketId);
      if (market) {
        console.log(`\n  ${market.question.slice(0, 70)}...`);
        console.log(`    Volume: $${market.volume.toLocaleString()}`);
        console.log(`    Data: ./data/markets/${marketId}/`);
      }
    }
  }

  if (result.summary.marketsResearched > result.summary.marketsApproved) {
    console.log("\n--- Markets Needing Revision ---");
    for (const [marketId, evaluation] of result.evaluations) {
      if (!(evaluation instanceof Error) && evaluation.verdict.decision !== "accept") {
        const market = result.discovery.markets.find((m) => m.id === marketId);
        if (market) {
          console.log(`\n  ${market.question.slice(0, 70)}...`);
          console.log(`    Verdict: ${evaluation.verdict.decision}`);
          console.log(`    Score: ${evaluation.scores.overall}/10`);
          console.log(`    Reason: ${evaluation.verdict.summary}`);
        }
      }
    }
  }

  console.log("\n" + "=".repeat(60));
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { command, topic, options } = parseArgs();

  // Handle help
  if (command === "help" || (!topic && command !== "help")) {
    printHelp();
    process.exit(command === "help" ? 0 : 1);
  }

  // Set log level
  if (options.verbose) {
    logger.setLevel("debug");
  } else {
    logger.setLevel("info");
  }

  // Validate config
  try {
    getConfig();
  } catch (error) {
    console.error("Configuration error:", error instanceof Error ? error.message : error);
    console.error("\nMake sure you have a .env file with required variables:");
    console.error("  ANTHROPIC_API_KEY");
    console.error("  PARALLEL_API_KEY");
    console.error("  POLYMARKET_PROXY_URL");
    console.error("  PROXY_SECRET");
    process.exit(1);
  }

  console.log(`\nPM Agent - Researching: "${topic}"\n`);

  try {
    if (command === "discover") {
      // Just discover markets
      console.log("Running market discovery...\n");

      const markets = await quickDiscovery({
        topic,
        maxResults: options.maxMarkets,
        minVolume: options.minVolume,
      });

      console.log(`Found ${markets.length} markets:\n`);
      for (const market of markets) {
        console.log(`  ${market.question.slice(0, 70)}...`);
        console.log(`    Slug: ${market.slug}`);
        console.log(`    Volume: $${market.volume.toLocaleString()}`);
        console.log(`    Relevance: ${(market.relevanceScore * 100).toFixed(0)}%`);
        console.log();
      }
    } else {
      // Full research pipeline
      const pipelineConfig: PipelineConfig = {
        topic,
        maxMarkets: options.maxMarkets,
        researchDepth: options.depth,
        minVolume: options.minVolume,
        skipDiscoveryAgent: options.quick,
        concurrency: 3,
      };

      console.log("Running research pipeline...\n");
      console.log(`  Max Markets: ${pipelineConfig.maxMarkets}`);
      console.log(`  Depth: ${pipelineConfig.researchDepth}`);
      console.log(`  Discovery: ${pipelineConfig.skipDiscoveryAgent ? "quick" : "agent"}`);
      console.log();

      const result = await runPipeline(pipelineConfig);

      displayResults(result);
    }
  } catch (error) {
    console.error("\nPipeline failed:", error instanceof Error ? error.message : error);
    if (options.verbose && error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run
main().catch(console.error);
