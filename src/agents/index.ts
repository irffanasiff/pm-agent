/**
 * Agent Exports
 * Re-exports all agent implementations and prompts
 */

// Discovery agent
export {
  runDiscovery,
  quickDiscovery,
  type DiscoveryInput,
  type DiscoveryResult,
  type SelectedMarket,
} from "./discovery.js";

// Research agent
export {
  runResearch,
  runBatchResearch,
  hasRecentResearch,
  type ResearchInput,
  type ResearchResult,
} from "./research.js";

// Critic agent
export {
  runCritic,
  runBatchCritic,
  hasRecentEvaluation,
  type CriticInput,
  type CriticResult,
} from "./critic.js";

// Prompts
export {
  getDiscoveryPrompt,
  getResearchPrompt,
  getCriticPrompt,
} from "./prompts.js";
