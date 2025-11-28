/**
 * Core Agent Types
 * Domain-agnostic agent interfaces and types
 */

// ============================================
// AGENT INTERFACE
// ============================================

/**
 * Base agent interface - all agents implement this
 */
export interface IAgent<TInput = unknown, TOutput = unknown> {
  /** Unique agent identifier */
  readonly name: string;

  /** Agent version for tracking changes */
  readonly version: string;

  /** Run the agent with given input */
  run(input: TInput, context?: AgentContext): Promise<AgentResult<TOutput>>;

  /** Validate input before running */
  validateInput(input: unknown): TInput;

  /** Get agent metadata */
  getMetadata(): AgentMetadata;
}

// ============================================
// CONTEXT
// ============================================

/**
 * Context passed to agent runs
 */
export interface AgentContext {
  /** Session ID for this execution */
  sessionId?: string;

  /** Correlation ID for distributed tracing */
  correlationId?: string;

  /** Workflow run ID (for multi-step pipelines) */
  workflowRunId?: string;

  /** Target entity being processed */
  targetId?: string;

  /** Parent system name */
  systemName?: string;

  /** Parent agent name (for nested calls) */
  parentAgent?: string;

  /** Span ID for nested tracing */
  spanId?: string;

  /** Parent span ID */
  parentSpanId?: string;

  /** Domain (e.g., "polymarket", "crypto") */
  domain?: string;

  /** Domain-specific data */
  domainData?: Record<string, unknown>;

  /** Resource limits */
  limits?: AgentLimits;

  /** Additional context data */
  metadata?: Record<string, unknown>;
}

/**
 * Resource limits for agent execution
 */
export interface AgentLimits {
  maxCostUsd?: number;
  maxDurationMs?: number;
  maxTurns?: number;
}

// ============================================
// RESULTS
// ============================================

/**
 * Result from an agent run
 */
export interface AgentResult<T = unknown> {
  /** Whether the run succeeded */
  success: boolean;

  /** The output data */
  output: T;

  /** Error if failed */
  error?: AgentError;

  /** Execution metadata */
  metadata: ExecutionMetadata;
}

/**
 * Execution metadata
 */
export interface ExecutionMetadata {
  /** Agent that produced this */
  agentName: string;
  agentVersion: string;

  /** Timing */
  startedAt: string;
  completedAt: string;
  durationMs: number;

  /** Cost tracking */
  costUsd: number;

  /** LLM usage */
  tokens?: TokenUsage;

  /** Tools used */
  toolsUsed: string[];

  /** Tool call details */
  toolCalls?: ToolCallSummary[];

  /** Number of LLM turns */
  turns: number;

  /** Model used */
  model?: string;

  /** Prompt version used */
  promptVersion?: string;
}

/**
 * Token usage breakdown
 */
export interface TokenUsage {
  input: number;
  output: number;
  cached?: number;
  total?: number;
}

/**
 * Summary of a tool call
 */
export interface ToolCallSummary {
  toolName: string;
  args?: unknown;
  durationMs: number;
  success: boolean;
  error?: string;
}

// ============================================
// METADATA
// ============================================

/**
 * Agent metadata - describes what an agent does
 */
export interface AgentMetadata {
  name: string;
  version: string;
  description: string;

  /** Role within a system */
  role?: AgentRole;

  /** Domain this agent is specialized for (or "generic") */
  domain?: string;

  /** Capabilities this agent has */
  capabilities?: AgentCapability[];

  /** What this agent expects as input */
  inputSchema?: Record<string, unknown>;

  /** What this agent produces */
  outputSchema?: Record<string, unknown>;

  /** Tools this agent can use */
  tools: string[];

  /** Typical cost range */
  estimatedCost?: CostEstimate;
}

/**
 * Standard agent roles
 */
export type AgentRole =
  | "research"      // Primary research/information gathering
  | "verification"  // Fact-checking, validation
  | "synthesis"     // Combining and summarizing
  | "monitoring"    // Long-running observation
  | "planning"      // Strategy and planning
  | "execution"     // Taking actions
  | "critique"      // Quality assessment
  | string;         // Custom roles

/**
 * Agent capabilities for routing and filtering
 */
export type AgentCapability =
  | "web_search"     // Can search the web
  | "web_fetch"      // Can fetch web pages
  | "file_read"      // Can read files
  | "file_write"     // Can write files
  | "code_exec"      // Can execute code
  | "api_call"       // Can call external APIs
  | "kb_read"        // Can read knowledge base
  | "kb_write"       // Can write to knowledge base
  | "plan_update"    // Can update plans/todos
  | "hypothesis"     // Can form/update hypotheses
  | string;          // Custom capabilities

/**
 * Cost estimate for an agent
 */
export interface CostEstimate {
  min: number;
  max: number;
  typical: number;
  currency?: string;
}

// ============================================
// ERRORS
// ============================================

/**
 * Agent error with classification
 */
export interface AgentError {
  /** Error classification */
  type: AgentErrorType;

  /** Error code for programmatic handling */
  code: string;

  /** Human-readable message */
  message: string;

  /** Whether this error is retryable */
  retryable: boolean;

  /** Retry hint (e.g., "after 30s", "with different input") */
  retryHint?: string;

  /** Additional error context */
  context?: Record<string, unknown>;

  /** Underlying cause */
  cause?: Error;
}

/**
 * Error type classification
 */
export type AgentErrorType =
  | "validation"   // Input validation failed
  | "execution"    // Execution error (LLM or tool)
  | "model"        // Model-specific error (rate limit, etc.)
  | "timeout"      // Execution timeout
  | "budget"       // Cost limit exceeded
  | "turns"        // Turn limit exceeded
  | "infra"        // Infrastructure error
  | "unknown";     // Unknown error

// ============================================
// CONFIGURATION
// ============================================

/**
 * Agent profile configuration
 */
export interface AgentProfile {
  /** Model to use */
  model: "haiku" | "sonnet" | "opus";

  /** Maximum turns */
  maxTurns: number;

  /** Maximum budget in USD */
  maxBudgetUsd: number;

  /** Available tools */
  tools: string[];

  /** MCP servers */
  mcpServers?: Record<string, MCPServerConfig>;

  /** Retry configuration */
  retries: number;
  backoffMs: number;

  /** Temperature (0-1) */
  temperature?: number;
}

export interface MCPServerConfig {
  type: "sse" | "stdio" | "http";
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
  env?: Record<string, string>;
}
