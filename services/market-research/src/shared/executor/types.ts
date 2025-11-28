/**
 * Executor Types
 * Interface for LLM execution layer
 */

import type { AgentProfile } from "../agent/types.js";

// ============================================
// EXECUTOR INTERFACE
// ============================================

/**
 * Executor interface - abstracts LLM execution
 */
export interface IExecutor {
  /**
   * Execute a prompt with given profile
   */
  execute(request: ExecutorRequest): Promise<ExecutorResponse>;

  /**
   * Check if executor is ready
   */
  isReady(): boolean;
}

// ============================================
// REQUEST / RESPONSE
// ============================================

/**
 * Request to executor
 */
export interface ExecutorRequest {
  /** The prompt to send */
  prompt: string;

  /** Optional system prompt */
  systemPrompt?: string;

  /** Agent profile with model, tools, limits */
  profile: AgentProfile;

  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Response from executor
 */
export interface ExecutorResponse {
  /** Whether execution succeeded */
  success: boolean;

  /** Raw output from the model */
  output: string;

  /** Session ID from the SDK */
  sessionId?: string;

  /** Cost in USD */
  costUsd: number;

  /** Duration in ms */
  durationMs: number;

  /** Token usage */
  tokens?: {
    input: number;
    output: number;
    cached?: number;
  };

  /** Tools that were used */
  toolsUsed: string[];

  /** Number of turns */
  turns: number;

  /** Error if failed */
  error?: {
    code: string;
    message: string;
  };
}

// ============================================
// EXECUTOR OPTIONS
// ============================================

/**
 * Options for creating an executor
 */
export interface ExecutorOptions {
  /** Working directory for tools */
  cwd?: string;

  /** Permission mode */
  permissionMode?: "bypassPermissions" | "default";

  /** Custom retry configuration */
  retries?: number;
  backoffMs?: number;
}
