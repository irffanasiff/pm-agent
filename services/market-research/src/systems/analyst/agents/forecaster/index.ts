/**
 * Forecaster Agent
 * Orchestrator agent that drives research and produces probability estimates
 *
 * Three Phases:
 * 1. DECOMPOSE: Parse input, craft research questions
 * 2. ANALYZE: Aggregate evidence, check for gaps
 * 3. FORECAST: Produce calibrated probability estimate
 */

export { ForecasterAgent } from "./agent.js";

// New orchestrator types
export type {
  ResearchQuestion,
  EvidencePackage,
  ForecasterOrchestratorInput,
  ForecasterAnalyzeInput,
  DecomposeOutput,
  AnalyzeOutput,
  ForecastOutput,
  ForecasterOrchestratorOutput,
} from "./types.js";

// Legacy types (backward compatibility)
export type {
  ForecasterInput,
  ForecasterOutput,
  ForecastResult,
  ResearchRequest,
  Forecast,
  ForecastReasoning,
  TradeRecommendation,
  MarketData,
  BaseRate,
} from "./types.js";

// Schemas
export {
  ForecasterOutputSchema,
  ForecasterOrchestratorOutputSchema,
  ResearchQuestionSchema,
  DecomposeOutputSchema,
  AnalyzeOutputSchema,
  ForecastOutputSchema,
  ForecastReasoningSchema,
} from "./schema.js";

// Prompts
export {
  getForecasterPrompt,
  getDecomposePrompt,
  getAnalyzePrompt,
} from "./prompt.js";

// Prompt params types
export type {
  ForecasterPromptParams,
  DecomposePromptParams,
  AnalyzePromptParams,
} from "./prompt.js";
