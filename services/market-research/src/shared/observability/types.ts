/**
 * Observability Types
 * Interface for logging, tracing, and metrics
 */

// ============================================
// OBSERVABILITY INTERFACE
// ============================================

/**
 * Observability interface - abstracts logging/tracing
 */
export interface IObservability {
  /**
   * Start tracking an agent session
   */
  startSession(params: StartSessionParams): Promise<string>;

  /**
   * End a session
   */
  endSession(sessionId: string, result: SessionResult): Promise<void>;

  /**
   * Record an event
   */
  recordEvent(event: ObservabilityEvent): Promise<void>;

  /**
   * Log a message
   */
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void;

  /**
   * Record a metric
   */
  metric(name: string, value: number, tags?: Record<string, string>): void;

  /**
   * Start a span for nested tracing
   */
  startSpan?(name: string, context?: SpanContext): SpanHandle;

  /**
   * End a span
   */
  endSpan?(handle: SpanHandle, data?: Record<string, unknown>): void;
}

// ============================================
// SESSION TRACKING
// ============================================

export interface StartSessionParams {
  agentName: string;
  agentVersion: string;
  correlationId: string;
  input: unknown;
  metadata?: Record<string, unknown>;
}

export interface SessionResult {
  success: boolean;
  output?: unknown;
  error?: unknown;
  metadata?: unknown;
}

// ============================================
// SPANS (NESTED TRACING)
// ============================================

/**
 * Context for creating a span
 */
export interface SpanContext {
  /** Parent span ID */
  parentSpanId?: string;

  /** Session ID this span belongs to */
  sessionId?: string;

  /** Correlation ID for distributed tracing */
  correlationId?: string;

  /** Additional attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Handle returned when starting a span
 */
export interface SpanHandle {
  /** Unique span ID */
  spanId: string;

  /** Parent span ID */
  parentSpanId?: string;

  /** Span name */
  name: string;

  /** When span was started */
  startTime: number;
}

// ============================================
// EVENT TAXONOMY
// ============================================

/**
 * Standardized event types
 */
export type EventType =
  // System events
  | "system.started"
  | "system.completed"
  | "system.failed"

  // Agent events
  | "agent.started"
  | "agent.thinking"
  | "agent.turn_completed"
  | "agent.completed"
  | "agent.failed"
  | "agent.retry"

  // Executor events
  | "executor.request"
  | "executor.response"
  | "executor.error"
  | "executor.retry"

  // Tool events
  | "tool.started"
  | "tool.completed"
  | "tool.failed"

  // Store events
  | "store.read"
  | "store.write"
  | "store.delete"

  // Workspace events
  | "workspace.initialized"
  | "workspace.loaded"
  | "workspace.updated"
  | "feature.started"
  | "feature.completed"
  | "feature.failed"
  | "hypothesis.added"
  | "hypothesis.updated"

  // Custom events
  | string;

/**
 * Structured observability event
 */
export interface ObservabilityEvent {
  /** Event type (from taxonomy or custom) */
  type: EventType;

  /** When the event occurred */
  timestamp?: string;

  /** Correlation ID for distributed tracing */
  correlationId?: string;

  /** Session ID this event belongs to */
  sessionId?: string;

  /** Workflow run ID */
  workflowRunId?: string;

  /** Span ID for nested tracing */
  spanId?: string;

  /** Parent span ID */
  parentSpanId?: string;

  /** System name (e.g., "analyst", "scout") */
  systemName?: string;

  /** Agent name */
  agentName?: string;

  /** Target ID being processed */
  targetId?: string;

  /** Event severity */
  level?: LogLevel;

  /** Event-specific data */
  data?: Record<string, unknown>;
}

// ============================================
// SPECIFIC EVENT PAYLOADS
// ============================================

/**
 * Agent started event data
 */
export interface AgentStartedEventData {
  agentName: string;
  agentVersion: string;
  model?: string;
  task?: string;
}

/**
 * Agent completed event data
 */
export interface AgentCompletedEventData {
  agentName: string;
  turns: number;
  durationMs: number;
  costUsd: number;
  toolsUsed: string[];
  promptVersion?: string;
}

/**
 * Agent failed event data
 */
export interface AgentFailedEventData {
  agentName: string;
  errorType: string;
  errorMessage: string;
  retryable: boolean;
}

/**
 * Tool event data
 */
export interface ToolEventData {
  toolName: string;
  args?: unknown;
  durationMs?: number;
  success?: boolean;
  result?: string;
  error?: string;
}

/**
 * Executor event data
 */
export interface ExecutorEventData {
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  latencyMs?: number;
}

// ============================================
// LOG LEVELS
// ============================================

export type LogLevel = "debug" | "info" | "warn" | "error";

// ============================================
// OPTIONS
// ============================================

export interface ObservabilityOptions {
  /** Minimum log level */
  logLevel?: LogLevel;

  /** Enable console output */
  console?: boolean;

  /** Custom event handler */
  onEvent?: (event: ObservabilityEvent) => void;

  /** Enable span tracing */
  enableSpans?: boolean;
}

// ============================================
// METRICS
// ============================================

/**
 * Standard metrics
 */
export type MetricName =
  | "agent.duration_ms"
  | "agent.cost_usd"
  | "agent.turns"
  | "agent.tokens_input"
  | "agent.tokens_output"
  | "tool.duration_ms"
  | "tool.call_count"
  | "executor.latency_ms"
  | "executor.retry_count"
  | "workspace.progress"
  | "workspace.feature_count"
  | string;

/**
 * Metric with tags
 */
export interface Metric {
  name: MetricName;
  value: number;
  timestamp: string;
  tags?: Record<string, string>;
  unit?: "ms" | "usd" | "count" | "percent" | "bytes";
}
