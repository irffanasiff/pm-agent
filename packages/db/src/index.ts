/**
 * @probable/db
 * Database client and repositories for Probable platform
 */

// Supabase client
export {
  getSupabase,
  isSupabaseConfigured,
  resetSupabase,
  testConnection,
} from "./supabase.js";

// Types
export * from "./types.js";

// Repositories
export { workflowRepo, sessionRepo, entityRepo, toolRepo, llmRepo } from "./repositories/index.js";

// Event store
export {
  EventTypes,
  emitEvent,
  flushEvents,
  shutdown as shutdownEventStore,
  getQueueStats,
  // Workflow events
  emitWorkflowQueued,
  emitWorkflowStarted,
  emitWorkflowPhaseChanged,
  emitWorkflowProgress,
  emitWorkflowCompleted,
  emitWorkflowFailed,
  emitWorkflowCancelled,
  // Agent events
  emitAgentStarted,
  emitAgentThinking,
  emitAgentStreaming,
  emitAgentToolRunning,
  emitAgentTurnCompleted,
  emitAgentCompleted,
  emitAgentFailed,
  // Tool events
  emitToolStarted,
  emitToolProgress,
  emitToolCompleted,
  emitToolFailed,
  // Entity events
  emitEntityDiscovered,
  emitEntityProcessingStarted,
  emitEntityProgress,
  emitEntityCompleted,
  emitEntityFailed,
  // LLM events
  emitLLMRequestStarted,
  emitLLMFirstToken,
  emitLLMResponseCompleted,
  emitLLMError,
  // System events
  emitInfo,
  emitWarn,
  emitError,
} from "./event-store.js";
