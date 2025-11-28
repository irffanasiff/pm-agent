/**
 * Filter Agent
 * Schema-preserving, deterministic, non-generative noise-clearing agent
 */

export { FilterAgent } from "./agent.js";
export type {
  FilterInput,
  FilterOutput,
  FilterConfig,
  FilterProfile,
  FilterMeta,
  FilterRule,
  FilteredFinding,
  FilteredTimelineEvent,
  FilteredOpenQuestion,
  FilteredSource,
} from "./types.js";
export { FILTER_PROFILE_DEFAULTS } from "./types.js";
export {
  FilterOutputSchema,
  validateSourceReferences,
  validateSubsetConstraint,
} from "./schema.js";
export { getFilterPrompt } from "./prompt.js";
