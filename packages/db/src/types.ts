/**
 * Database Types V3
 * Universal Agent Observability Schema
 */

// ============================================================
// STATUS TYPES
// ============================================================

export type WorkflowStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type SessionStatus =
  | "pending"
  | "initializing"
  | "running"
  | "thinking"
  | "streaming"
  | "tool_running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

export type ToolCallStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

export type MessageRole = "user" | "assistant" | "tool_result";

export type EventLevel = "debug" | "info" | "warn" | "error";

// ============================================================
// EVENT TYPES
// ============================================================

export const EventTypes = {
  // Workflow events
  WORKFLOW_QUEUED: "workflow.queued",
  WORKFLOW_STARTED: "workflow.started",
  WORKFLOW_PHASE_CHANGED: "workflow.phase_changed",
  WORKFLOW_PROGRESS: "workflow.progress",
  WORKFLOW_COMPLETED: "workflow.completed",
  WORKFLOW_FAILED: "workflow.failed",
  WORKFLOW_CANCELLED: "workflow.cancelled",

  // Agent events
  AGENT_STARTED: "agent.started",
  AGENT_THINKING: "agent.thinking",
  AGENT_STREAMING: "agent.streaming",
  AGENT_TOOL_RUNNING: "agent.tool_running",
  AGENT_TURN_COMPLETED: "agent.turn_completed",
  AGENT_COMPLETED: "agent.completed",
  AGENT_FAILED: "agent.failed",

  // Tool events
  TOOL_STARTED: "tool.started",
  TOOL_PROGRESS: "tool.progress",
  TOOL_COMPLETED: "tool.completed",
  TOOL_FAILED: "tool.failed",

  // Entity events
  ENTITY_DISCOVERED: "entity.discovered",
  ENTITY_PROCESSING_STARTED: "entity.processing_started",
  ENTITY_PROGRESS: "entity.progress",
  ENTITY_COMPLETED: "entity.completed",
  ENTITY_FAILED: "entity.failed",

  // LLM events
  LLM_REQUEST_STARTED: "llm.request_started",
  LLM_FIRST_TOKEN: "llm.first_token",
  LLM_RESPONSE_COMPLETED: "llm.response_completed",
  LLM_ERROR: "llm.error",

  // System events
  INFO: "system.info",
  WARN: "system.warn",
  ERROR: "system.error",
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes] | string;

// ============================================================
// ROW TYPES (what you get from database)
// ============================================================

export interface WorkflowRun {
  id: string;
  trace_id: string;
  name: string;
  version: string | null;
  initiated_by: string | null;
  initiated_from: string | null;
  input: Record<string, unknown>;
  input_summary: string | null;
  config: Record<string, unknown>;
  output: Record<string, unknown> | null;
  output_summary: string | null;
  status: WorkflowStatus;
  phases: Array<{
    name: string;
    status: string;
    started_at?: string;
    completed_at?: string;
    message?: string;
  }>;
  current_phase: string | null;
  progress_pct: number;
  progress_message: string | null;
  current_activity: string | null;
  current_session_id: string | null;
  counters: Record<string, number>;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_sessions: number;
  total_llm_calls: number;
  total_tool_calls: number;
  error_code: string | null;
  error_message: string | null;
  error_details: Record<string, unknown> | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AgentSession {
  id: string;
  workflow_id: string | null;
  parent_session_id: string | null;
  trace_id: string;
  agent_name: string;
  agent_version: string | null;
  task: string | null;
  task_type: string | null;
  context_type: string | null;
  context_id: string | null;
  model: string;
  model_config: Record<string, unknown>;
  system_prompt_hash: string | null;
  max_turns: number | null;
  max_tokens: number | null;
  max_cost_usd: number | null;
  timeout_ms: number | null;
  tools_available: string[];
  status: SessionStatus;
  current_turn: number;
  current_activity: string | null;
  current_llm_call_id: string | null;
  current_tool_call_id: string | null;
  streaming_text: string | null;
  result: unknown | null;
  result_summary: string | null;
  stop_reason: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  started_at: string | null;
  first_token_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  api_time_ms: number | null;
  tool_time_ms: number | null;
  tools_used: string[];
  tool_call_count: number;
  error_code: string | null;
  error_message: string | null;
  error_turn: number | null;
  error_details: Record<string, unknown> | null;
  sequence_number: number | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LLMCall {
  id: string;
  session_id: string;
  workflow_id: string | null;
  trace_id: string;
  turn_number: number;
  provider: string;
  model: string;
  system_prompt: string | null;
  messages: unknown[];
  tools_provided: unknown[];
  tool_choice: unknown | null;
  response_id: string | null;
  stop_reason: string | null;
  content_blocks: unknown[];
  text_response: string | null;
  tool_calls_requested: unknown[];
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  started_at: string | null;
  first_token_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  time_to_first_token_ms: number | null;
  tokens_per_second: number | null;
  is_streaming: boolean;
  is_error: boolean;
  error_code: string | null;
  error_message: string | null;
  retry_attempt: number;
  created_at: string;
}

export interface ToolCall {
  id: string;
  llm_call_id: string | null;
  session_id: string;
  workflow_id: string | null;
  trace_id: string;
  tool_use_id: string;
  tool_name: string;
  tool_type: string | null;
  parent_tool_call_id: string | null;
  depth: number;
  turn_number: number | null;
  sequence_in_turn: number;
  input: Record<string, unknown>;
  input_preview: string | null;
  output: Record<string, unknown> | null;
  output_preview: string | null;
  output_type: string | null;
  status: ToolCallStatus;
  progress_pct: number | null;
  progress_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  is_error: boolean;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export interface Entity {
  id: string;
  workflow_id: string | null;
  trace_id: string | null;
  entity_type: string;
  external_id: string;
  name: string;
  description: string | null;
  url: string | null;
  attributes: Record<string, unknown>;
  status: string;
  status_message: string | null;
  current_phase: string | null;
  progress_pct: number;
  current_session_id: string | null;
  results: Record<string, unknown>;
  scores: Record<string, number>;
  verdict: string | null;
  verdict_reason: string | null;
  verdict_confidence: number | null;
  total_cost_usd: number;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  priority: number;
  sort_order: number | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  session_id: string;
  llm_call_id: string | null;
  workflow_id: string | null;
  trace_id: string;
  turn_number: number;
  sequence_in_turn: number;
  role: MessageRole;
  content: unknown[];
  text_content: string | null;
  tool_use_id: string | null;
  tool_name: string | null;
  token_count: number | null;
  timestamp: string;
}

export interface Event {
  id: number;
  workflow_id: string | null;
  session_id: string | null;
  llm_call_id: string | null;
  tool_call_id: string | null;
  trace_id: string | null;
  event_type: string;
  event_source: string | null;
  level: EventLevel;
  message: string | null;
  payload: Record<string, unknown>;
  sequence_number: number;
  timestamp: string;
}

// ============================================================
// INSERT TYPES
// ============================================================

export interface WorkflowRunInsert {
  id?: string;
  trace_id?: string;
  name: string;
  version?: string;
  initiated_by?: string;
  initiated_from?: string;
  input?: Record<string, unknown>;
  input_summary?: string;
  config?: Record<string, unknown>;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentSessionInsert {
  id?: string;
  workflow_id?: string;
  parent_session_id?: string;
  trace_id: string;
  agent_name: string;
  agent_version?: string;
  task?: string;
  task_type?: string;
  context_type?: string;
  context_id?: string;
  model: string;
  model_config?: Record<string, unknown>;
  system_prompt_hash?: string;
  max_turns?: number;
  max_tokens?: number;
  max_cost_usd?: number;
  timeout_ms?: number;
  tools_available?: string[];
  sequence_number?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface LLMCallInsert {
  id?: string;
  session_id: string;
  workflow_id?: string;
  trace_id: string;
  turn_number: number;
  provider?: string;
  model: string;
  system_prompt?: string;
  messages?: unknown[];
  tools_provided?: unknown[];
  tool_choice?: unknown;
  is_streaming?: boolean;
  started_at?: string;
}

export interface ToolCallInsert {
  id?: string;
  llm_call_id?: string;
  session_id: string;
  workflow_id?: string;
  trace_id: string;
  tool_use_id: string;
  tool_name: string;
  tool_type?: string;
  parent_tool_call_id?: string;
  depth?: number;
  turn_number?: number;
  sequence_in_turn?: number;
  input: Record<string, unknown>;
  input_preview?: string;
  started_at?: string;
}

export interface EntityInsert {
  id?: string;
  workflow_id?: string;
  trace_id?: string;
  entity_type: string;
  external_id: string;
  name: string;
  description?: string;
  url?: string;
  attributes?: Record<string, unknown>;
  status?: string;
  priority?: number;
  sort_order?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MessageInsert {
  session_id: string;
  llm_call_id?: string;
  workflow_id?: string;
  trace_id: string;
  turn_number: number;
  sequence_in_turn?: number;
  role: MessageRole;
  content: unknown[];
  text_content?: string;
  tool_use_id?: string;
  tool_name?: string;
  token_count?: number;
}

export interface EventInsert {
  workflow_id?: string;
  session_id?: string;
  llm_call_id?: string;
  tool_call_id?: string;
  trace_id?: string;
  event_type: string;
  event_source?: string;
  level?: EventLevel;
  message?: string;
  payload?: Record<string, unknown>;
}

// ============================================================
// UPDATE TYPES
// ============================================================

export interface WorkflowRunUpdate {
  status?: WorkflowStatus;
  phases?: WorkflowRun["phases"];
  current_phase?: string | null;
  progress_pct?: number;
  progress_message?: string | null;
  current_activity?: string | null;
  current_session_id?: string | null;
  counters?: Record<string, number>;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  output?: Record<string, unknown>;
  output_summary?: string;
  total_cost_usd?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_sessions?: number;
  total_llm_calls?: number;
  total_tool_calls?: number;
  error_code?: string | null;
  error_message?: string | null;
  error_details?: Record<string, unknown> | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentSessionUpdate {
  status?: SessionStatus;
  current_turn?: number;
  current_activity?: string | null;
  current_llm_call_id?: string | null;
  current_tool_call_id?: string | null;
  streaming_text?: string | null;
  result?: unknown;
  result_summary?: string;
  stop_reason?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_usd?: number;
  started_at?: string;
  first_token_at?: string;
  completed_at?: string;
  duration_ms?: number;
  api_time_ms?: number;
  tool_time_ms?: number;
  tools_used?: string[];
  tool_call_count?: number;
  error_code?: string | null;
  error_message?: string | null;
  error_turn?: number | null;
  error_details?: Record<string, unknown> | null;
}

export interface LLMCallUpdate {
  response_id?: string;
  stop_reason?: string;
  content_blocks?: unknown[];
  text_response?: string;
  tool_calls_requested?: unknown[];
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_usd?: number;
  first_token_at?: string;
  completed_at?: string;
  duration_ms?: number;
  time_to_first_token_ms?: number;
  tokens_per_second?: number;
  is_error?: boolean;
  error_code?: string;
  error_message?: string;
  retry_attempt?: number;
}

export interface ToolCallUpdate {
  output?: Record<string, unknown>;
  output_preview?: string;
  output_type?: string;
  status?: ToolCallStatus;
  progress_pct?: number;
  progress_message?: string;
  completed_at?: string;
  duration_ms?: number;
  is_error?: boolean;
  error_code?: string;
  error_message?: string;
}

export interface EntityUpdate {
  name?: string;
  description?: string;
  url?: string;
  attributes?: Record<string, unknown>;
  status?: string;
  status_message?: string | null;
  current_phase?: string | null;
  progress_pct?: number;
  current_session_id?: string | null;
  results?: Record<string, unknown>;
  scores?: Record<string, number>;
  verdict?: string | null;
  verdict_reason?: string | null;
  verdict_confidence?: number | null;
  total_cost_usd?: number;
  processing_started_at?: string;
  processing_completed_at?: string;
  error_code?: string | null;
  error_message?: string | null;
  priority?: number;
  sort_order?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// ============================================================
// CONTEXT TYPES
// ============================================================

export interface TraceContext {
  traceId: string;
  workflowId?: string;
  sessionId?: string;
  llmCallId?: string;
  toolCallId?: string;
  entityId?: string;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

export function getEventCategory(eventType: string): string {
  const parts = eventType.split(".");
  return parts[0] || "unknown";
}
