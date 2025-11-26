/**
 * Research Output Schema
 * Defines the structured output from the ResearchAgent
 */

import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { getMarketDir, ensureMarketDir } from "./market.js";

/**
 * Research depth levels
 */
export type ResearchDepth = "quick" | "standard" | "deep";

/**
 * Impact/confidence levels
 */
export type ImpactLevel = "high" | "medium" | "low";
export type Direction = "yes" | "no" | "neutral";

/**
 * Key driver affecting market outcome
 */
export const KeyDriverSchema = z.object({
  driver: z.string(),
  impact: z.enum(["high", "medium", "low"]),
  direction: z.enum(["yes", "no", "neutral"]),
});

/**
 * Argument for/against an outcome
 */
export const ArgumentSchema = z.object({
  point: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  source: z.string().optional(),
});

/**
 * Risk identified in the market
 */
export const RiskSchema = z.object({
  type: z.enum([
    "resolution_ambiguity",
    "low_liquidity",
    "regulatory",
    "information_asymmetry",
    "timing",
    "other",
  ]),
  description: z.string(),
  severity: z.enum(["high", "medium", "low"]),
});

/**
 * Resolution analysis
 */
export const ResolutionSchema = z.object({
  criteria: z.string(),
  source: z.string(),
  ambiguityLevel: z.enum(["low", "medium", "high"]),
  concerns: z.array(z.string()),
});

/**
 * Probability assessment
 */
export const AssessmentSchema = z.object({
  impliedProbYes: z.number().min(0).max(1),
  researcherEstimate: z.number().min(0).max(1).optional(),
  divergence: z.number().optional(),
  reasoning: z.string().optional(),
});

/**
 * Source reference
 */
export const SourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  type: z.enum(["news", "official", "analysis", "data", "social"]),
  retrievedAt: z.string(),
  relevance: z.enum(["high", "medium", "low"]),
  keyQuote: z.string().optional(),
});

/**
 * Research metadata
 */
export const ResearchMetadataSchema = z.object({
  model: z.string(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
  }),
  cost: z.number(),
  duration: z.number(),
  toolsUsed: z.array(z.string()),
});

/**
 * Market snapshot at research time
 */
export const MarketSnapshotSchema = z.object({
  priceYes: z.number(),
  priceNo: z.number(),
  volume: z.number(),
  liquidity: z.number(),
  daysToResolution: z.number(),
});

/**
 * Full research output
 */
export const ResearchOutputSchema = z.object({
  // Identity
  marketId: z.string(),
  question: z.string(),
  researchedAt: z.string(),
  depth: z.enum(["quick", "standard", "deep"]),

  // Market snapshot
  snapshot: MarketSnapshotSchema,

  // Core analysis
  summary: z.string(),
  keyDrivers: z.array(KeyDriverSchema),

  // Arguments
  arguments: z.object({
    forYes: z.array(ArgumentSchema),
    forNo: z.array(ArgumentSchema),
  }),

  // Risk assessment
  risks: z.array(RiskSchema),

  // Resolution analysis
  resolution: ResolutionSchema,

  // Probability assessment
  assessment: AssessmentSchema,

  // Sources
  sources: z.array(SourceSchema),

  // Metadata
  metadata: ResearchMetadataSchema,
});

export type KeyDriver = z.infer<typeof KeyDriverSchema>;
export type Argument = z.infer<typeof ArgumentSchema>;
export type Risk = z.infer<typeof RiskSchema>;
export type Resolution = z.infer<typeof ResolutionSchema>;
export type Assessment = z.infer<typeof AssessmentSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type ResearchMetadata = z.infer<typeof ResearchMetadataSchema>;
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;
export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

/**
 * Save research output
 */
export async function saveResearch(research: ResearchOutput): Promise<void> {
  const dir = await ensureMarketDir(research.marketId);

  // Save JSON
  const jsonPath = path.join(dir, "research.json");
  await fs.writeFile(jsonPath, JSON.stringify(research, null, 2));

  // Save markdown summary
  const mdPath = path.join(dir, "research.md");
  await fs.writeFile(mdPath, formatResearchMarkdown(research));
}

/**
 * Load research output
 */
export async function loadResearch(marketId: string): Promise<ResearchOutput | null> {
  const filePath = path.join(getMarketDir(marketId), "research.json");
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return ResearchOutputSchema.parse(JSON.parse(content));
  } catch {
    return null;
  }
}

/**
 * Format research as human-readable markdown
 */
export function formatResearchMarkdown(research: ResearchOutput): string {
  const lines: string[] = [];

  lines.push(`# ${research.question}`);
  lines.push("");
  lines.push(`**Researched:** ${research.researchedAt}`);
  lines.push(`**Depth:** ${research.depth}`);
  lines.push("");

  // Market snapshot
  lines.push("## Market Snapshot");
  lines.push(`- **Yes Price:** ${(research.snapshot.priceYes * 100).toFixed(1)}%`);
  lines.push(`- **No Price:** ${(research.snapshot.priceNo * 100).toFixed(1)}%`);
  lines.push(`- **Volume:** $${research.snapshot.volume.toLocaleString()}`);
  lines.push(`- **Liquidity:** $${research.snapshot.liquidity.toLocaleString()}`);
  lines.push(`- **Days to Resolution:** ${research.snapshot.daysToResolution}`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push(research.summary);
  lines.push("");

  // Key Drivers
  lines.push("## Key Drivers");
  for (const driver of research.keyDrivers) {
    const arrow = driver.direction === "yes" ? "↑" : driver.direction === "no" ? "↓" : "→";
    lines.push(`- **${driver.driver}** [${driver.impact}] ${arrow}`);
  }
  lines.push("");

  // Arguments
  lines.push("## Arguments For YES");
  for (const arg of research.arguments.forYes) {
    lines.push(`- ${arg.point} (${arg.confidence} confidence)`);
    if (arg.source) lines.push(`  - Source: ${arg.source}`);
  }
  lines.push("");

  lines.push("## Arguments For NO");
  for (const arg of research.arguments.forNo) {
    lines.push(`- ${arg.point} (${arg.confidence} confidence)`);
    if (arg.source) lines.push(`  - Source: ${arg.source}`);
  }
  lines.push("");

  // Risks
  lines.push("## Risks");
  for (const risk of research.risks) {
    lines.push(`- **[${risk.severity.toUpperCase()}] ${risk.type}:** ${risk.description}`);
  }
  lines.push("");

  // Resolution
  lines.push("## Resolution");
  lines.push(`- **Criteria:** ${research.resolution.criteria}`);
  lines.push(`- **Source:** ${research.resolution.source}`);
  lines.push(`- **Ambiguity:** ${research.resolution.ambiguityLevel}`);
  if (research.resolution.concerns.length > 0) {
    lines.push("- **Concerns:**");
    for (const concern of research.resolution.concerns) {
      lines.push(`  - ${concern}`);
    }
  }
  lines.push("");

  // Assessment
  lines.push("## Assessment");
  lines.push(`- **Implied Probability (YES):** ${(research.assessment.impliedProbYes * 100).toFixed(1)}%`);
  if (research.assessment.researcherEstimate !== undefined) {
    lines.push(`- **Researcher Estimate:** ${(research.assessment.researcherEstimate * 100).toFixed(1)}%`);
    if (research.assessment.divergence !== undefined) {
      const sign = research.assessment.divergence > 0 ? "+" : "";
      lines.push(`- **Divergence:** ${sign}${(research.assessment.divergence * 100).toFixed(1)}pp`);
    }
  }
  if (research.assessment.reasoning) {
    lines.push(`- **Reasoning:** ${research.assessment.reasoning}`);
  }
  lines.push("");

  // Sources
  lines.push("## Sources");
  for (const source of research.sources) {
    lines.push(`- [${source.title}](${source.url}) (${source.type}, ${source.relevance} relevance)`);
    if (source.keyQuote) {
      lines.push(`  > ${source.keyQuote}`);
    }
  }
  lines.push("");

  // Metadata
  lines.push("---");
  lines.push(`*Model: ${research.metadata.model}*`);
  lines.push(`*Cost: $${research.metadata.cost.toFixed(4)}*`);
  lines.push(`*Duration: ${research.metadata.duration}ms*`);

  return lines.join("\n");
}

/**
 * Create an empty research template
 */
export function createResearchTemplate(
  marketId: string,
  question: string,
  depth: ResearchDepth
): Partial<ResearchOutput> {
  return {
    marketId,
    question,
    researchedAt: new Date().toISOString(),
    depth,
    snapshot: {
      priceYes: 0,
      priceNo: 0,
      volume: 0,
      liquidity: 0,
      daysToResolution: 0,
    },
    summary: "",
    keyDrivers: [],
    arguments: { forYes: [], forNo: [] },
    risks: [],
    resolution: {
      criteria: "",
      source: "",
      ambiguityLevel: "medium",
      concerns: [],
    },
    assessment: {
      impliedProbYes: 0,
    },
    sources: [],
    metadata: {
      model: "",
      tokens: { input: 0, output: 0 },
      cost: 0,
      duration: 0,
      toolsUsed: [],
    },
  };
}
