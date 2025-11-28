/**
 * @probable/research
 * Research agent service for Polymarket analysis
 */

import "dotenv/config";
import { createAnalystSystem } from "./systems/analyst/system.js";
import { createSupabaseObservability } from "./shared/observability/supabase.js";
import type { AnalystInput } from "./systems/analyst/types.js";

async function main() {
  console.log("Starting Probable Research Agent\n");

  // Create observability with Supabase
  const observability = createSupabaseObservability({
    systemName: "analyst",
    console: true,
    logLevel: "info",
  });

  // Create system with DB tracking
  const analyst = createAnalystSystem(
    {
      dataDir: "./data",
      defaultDepth: "standard",
    },
    {
      observability,
    }
  );

  console.log("System Info:", analyst.getInfo());
  console.log();

  // Test input - can be overridden via CLI args
  const subject = process.argv[2] || "Will the Federal Reserve cut interest rates in December 2024?";
  const depth = (process.argv[3] as "quick" | "standard" | "deep") || "quick";

  const input: AnalystInput = {
    subject,
    depth,
    focus: ["facts", "prediction"],
  };

  console.log("Running analysis...");
  console.log("Subject:", input.subject);
  console.log("Depth:", input.depth);
  console.log();

  try {
    const result = await analyst.run(input);

    console.log("\nAnalysis Complete!\n");
    console.log("=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(result.summary);
    console.log();

    console.log("=".repeat(60));
    console.log("KEY POINTS");
    console.log("=".repeat(60));
    for (const point of result.findings.keyPoints) {
      console.log(`- [${point.confidence}] ${point.point}`);
    }
    console.log();

    console.log("=".repeat(60));
    console.log("ASSESSMENT");
    console.log("=".repeat(60));
    console.log("Conclusion:", result.assessment.conclusion);
    console.log("Confidence:", (result.assessment.confidence * 100).toFixed(0) + "%");
    console.log("Reasoning:", result.assessment.reasoning.slice(0, 200) + "...");
    console.log();

    if (result.assessment.prediction) {
      console.log("=".repeat(60));
      console.log("PREDICTION");
      console.log("=".repeat(60));
      console.log("Outcome:", result.assessment.prediction.outcome);
      console.log("Probability:", (result.assessment.prediction.probability * 100).toFixed(0) + "%");
    }

    console.log();
    console.log("=".repeat(60));
    console.log("METADATA");
    console.log("=".repeat(60));
    console.log("Duration:", result.metadata.durationMs, "ms");
    console.log("Cost:", "$" + result.metadata.costUsd.toFixed(4));
    console.log("Agents Used:", result.metadata.agentsUsed.join(", "));
    console.log("Tools Used:", result.metadata.toolsUsed.join(", "));
    console.log("Sources Found:", result.sources.length);

  } catch (error) {
    console.error("Analysis failed:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
