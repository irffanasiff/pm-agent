/**
 * Analyst System Test
 * Simple test to verify the system works with DB tracking
 */

import "dotenv/config";
import { createAnalystSystem } from "./system.js";
import { createSupabaseObservability } from "../../shared/observability/supabase.js";
import type { AnalystInput } from "./types.js";

async function main() {
  console.log("🧪 Testing Analyst System with DB Tracking\n");

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

  // Test input
  const input: AnalystInput = {
    subject: "Will the Federal Reserve cut interest rates in December 2024?",
    depth: "quick", // Use quick for testing
    focus: ["facts", "prediction"],
  };

  console.log("📊 Running analysis...");
  console.log("Subject:", input.subject);
  console.log("Depth:", input.depth);
  console.log();

  try {
    const result = await analyst.run(input);

    console.log("✅ Analysis Complete!\n");
    console.log("═".repeat(60));
    console.log("SUMMARY");
    console.log("═".repeat(60));
    console.log(result.summary);
    console.log();

    console.log("═".repeat(60));
    console.log("KEY POINTS");
    console.log("═".repeat(60));
    for (const point of result.findings.keyPoints) {
      console.log(`• [${point.confidence}] ${point.point}`);
    }
    console.log();

    console.log("═".repeat(60));
    console.log("ASSESSMENT");
    console.log("═".repeat(60));
    console.log("Conclusion:", result.assessment.conclusion);
    console.log("Confidence:", (result.assessment.confidence * 100).toFixed(0) + "%");
    console.log("Reasoning:", result.assessment.reasoning.slice(0, 200) + "...");
    console.log();

    if (result.assessment.prediction) {
      console.log("═".repeat(60));
      console.log("PREDICTION");
      console.log("═".repeat(60));
      console.log("Outcome:", result.assessment.prediction.outcome);
      console.log("Probability:", (result.assessment.prediction.probability * 100).toFixed(0) + "%");
    }

    console.log();
    console.log("═".repeat(60));
    console.log("METADATA");
    console.log("═".repeat(60));
    console.log("Duration:", result.metadata.durationMs, "ms");
    console.log("Cost:", "$" + result.metadata.costUsd.toFixed(4));
    console.log("Agents Used:", result.metadata.agentsUsed.join(", "));
    console.log("Tools Used:", result.metadata.toolsUsed.join(", "));
    console.log("Sources Found:", result.sources.length);

  } catch (error) {
    console.error("❌ Analysis failed:", error);
  }
}

main().catch(console.error);
