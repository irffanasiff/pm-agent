/**
 * System Types
 * Core interfaces for agent systems
 */

import type { ExecutionMetadata, AgentRole } from "../agent/types.js";

// ============================================
// SYSTEM INTERFACE
// ============================================

/**
 * Base system interface - all systems implement this
 * Systems orchestrate internal agents to accomplish complex tasks
 */
export interface ISystem<TInput = unknown, TOutput = unknown> {
  /** Unique system identifier */
  readonly name: string;

  /** System version for tracking changes */
  readonly version: string;

  /** Run the system with given input */
  run(input: TInput, context?: SystemContext): Promise<TOutput>;

  /** Get system info including internal agents */
  getInfo(): SystemInfo;
}

// ============================================
// CONTEXT
// ============================================

/**
 * Context passed to system runs
 */
export interface SystemContext {
  /** Correlation ID for distributed tracing */
  correlationId?: string;

  /** Workflow run ID (for multi-step pipelines) */
  workflowRunId?: string;

  /** Target entity being processed */
  targetId?: string;

  /** Domain context (e.g., "polymarket", "crypto") */
  domain?: string;

  /** User/initiator identifier */
  initiatedBy?: string;

  /** Resource limits */
  limits?: SystemLimits;

  /** Additional context data */
  metadata?: Record<string, unknown>;
}

/**
 * Resource limits for system execution
 */
export interface SystemLimits {
  /** Maximum cost in USD */
  maxCostUsd?: number;

  /** Maximum duration in milliseconds */
  maxDurationMs?: number;

  /** Maximum LLM turns across all agents */
  maxTurns?: number;

  /** Maximum number of internal agent invocations */
  maxAgentCalls?: number;
}

// ============================================
// SYSTEM INFO
// ============================================

/**
 * System information including internal agents
 */
export interface SystemInfo {
  name: string;
  version: string;
  description?: string;

  /** Internal agents this system can use */
  agents: SystemAgentRef[];

  /** Domains this system supports */
  supportedDomains?: string[];
}

/**
 * Reference to an internal agent
 */
export interface SystemAgentRef {
  /** Agent name */
  name: string;

  /** Agent version */
  version: string;

  /** Role within the system */
  role: AgentRole;

  /** Whether this agent is enabled */
  enabled: boolean;
}

// AgentRole is imported from agent/types.ts

// ============================================
// SYSTEM RESULT
// ============================================

/**
 * Result from a system run
 */
export interface SystemResult<T = unknown> {
  /** Whether the run succeeded */
  success: boolean;

  /** The output data */
  output: T;

  /** Error if failed */
  error?: SystemError;

  /** Execution metadata */
  metadata: SystemMetadata;
}

/**
 * System execution metadata
 */
export interface SystemMetadata extends ExecutionMetadata {
  /** System version */
  systemVersion: string;

  /** Agents that were invoked */
  agentsUsed: AgentInvocation[];

  /** Number of internal agent calls */
  agentCallCount: number;
}

/**
 * Record of an agent invocation
 */
export interface AgentInvocation {
  name: string;
  version: string;
  role: AgentRole;
  durationMs: number;
  costUsd: number;
  success: boolean;
}

// ============================================
// ERRORS
// ============================================

/**
 * System error with classification
 */
export interface SystemError {
  /** Error classification */
  type: SystemErrorType;

  /** Human-readable message */
  message: string;

  /** Error code for programmatic handling */
  code: string;

  /** Whether this error is retryable */
  retryable: boolean;

  /** Underlying agent errors if any */
  agentErrors?: Array<{
    agentName: string;
    error: string;
  }>;

  /** Additional error details */
  details?: Record<string, unknown>;
}

export type SystemErrorType =
  | "validation"   // Input validation failed
  | "agent"        // Internal agent failed
  | "timeout"      // Execution timeout
  | "budget"       // Cost limit exceeded
  | "infra"        // Infrastructure error
  | "unknown";
