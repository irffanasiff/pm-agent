/**
 * Custom Error Types
 * Structured errors for better handling and debugging
 */

/**
 * Base error class for all PM Agent errors
 */
export class PMAgentError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;
  public readonly retryable: boolean;

  constructor(
    message: string,
    code: string,
    options?: {
      cause?: Error;
      context?: Record<string, unknown>;
      retryable?: boolean;
    }
  ) {
    super(message);
    this.name = "PMAgentError";
    this.code = code;
    this.context = options?.context;
    this.retryable = options?.retryable ?? false;

    if (options?.cause) {
      this.cause = options.cause;
    }

    // Maintains proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      retryable: this.retryable,
      stack: this.stack,
    };
  }
}

/**
 * Configuration errors
 */
export class ConfigError extends PMAgentError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "CONFIG_ERROR", { context, retryable: false });
    this.name = "ConfigError";
  }
}

/**
 * Agent execution errors
 */
export class AgentError extends PMAgentError {
  public readonly agentType: string;
  public readonly sessionId?: string;

  constructor(
    message: string,
    agentType: string,
    options?: {
      cause?: Error;
      sessionId?: string;
      context?: Record<string, unknown>;
      retryable?: boolean;
    }
  ) {
    super(message, "AGENT_ERROR", options);
    this.name = "AgentError";
    this.agentType = agentType;
    this.sessionId = options?.sessionId;
  }
}

/**
 * Agent budget exceeded
 */
export class BudgetExceededError extends AgentError {
  public readonly budgetUsd: number;
  public readonly spentUsd: number;

  constructor(
    agentType: string,
    budgetUsd: number,
    spentUsd: number,
    sessionId?: string
  ) {
    super(
      `Budget exceeded: spent $${spentUsd.toFixed(4)} of $${budgetUsd.toFixed(4)} budget`,
      agentType,
      {
        sessionId,
        context: { budgetUsd, spentUsd },
        retryable: false,
      }
    );
    this.name = "BudgetExceededError";
    this.budgetUsd = budgetUsd;
    this.spentUsd = spentUsd;
  }
}

/**
 * Agent max turns exceeded
 */
export class MaxTurnsExceededError extends AgentError {
  public readonly maxTurns: number;

  constructor(agentType: string, maxTurns: number, sessionId?: string) {
    super(
      `Max turns exceeded: limit was ${maxTurns}`,
      agentType,
      {
        sessionId,
        context: { maxTurns },
        retryable: false,
      }
    );
    this.name = "MaxTurnsExceededError";
    this.maxTurns = maxTurns;
  }
}

/**
 * Polymarket API errors
 */
export class PolymarketError extends PMAgentError {
  public readonly statusCode?: number;
  public readonly endpoint?: string;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      statusCode?: number;
      endpoint?: string;
      context?: Record<string, unknown>;
    }
  ) {
    // Rate limits are retryable
    const retryable = options?.statusCode === 429;

    super(message, "POLYMARKET_ERROR", { ...options, retryable });
    this.name = "PolymarketError";
    this.statusCode = options?.statusCode;
    this.endpoint = options?.endpoint;
  }
}

/**
 * Network/connectivity errors
 */
export class NetworkError extends PMAgentError {
  constructor(message: string, cause?: Error) {
    super(message, "NETWORK_ERROR", { cause, retryable: true });
    this.name = "NetworkError";
  }
}

/**
 * Validation errors (schemas, inputs)
 */
export class ValidationError extends PMAgentError {
  public readonly field?: string;
  public readonly expected?: string;
  public readonly received?: string;

  constructor(
    message: string,
    options?: {
      field?: string;
      expected?: string;
      received?: string;
      context?: Record<string, unknown>;
    }
  ) {
    super(message, "VALIDATION_ERROR", { context: options?.context, retryable: false });
    this.name = "ValidationError";
    this.field = options?.field;
    this.expected = options?.expected;
    this.received = options?.received;
  }
}

/**
 * Tool execution errors
 */
export class ToolError extends PMAgentError {
  public readonly toolName: string;

  constructor(
    message: string,
    toolName: string,
    options?: {
      cause?: Error;
      context?: Record<string, unknown>;
      retryable?: boolean;
    }
  ) {
    super(message, "TOOL_ERROR", options);
    this.name = "ToolError";
    this.toolName = toolName;
  }
}

/**
 * MCP server errors
 */
export class MCPError extends PMAgentError {
  public readonly serverName: string;

  constructor(
    message: string,
    serverName: string,
    options?: {
      cause?: Error;
      context?: Record<string, unknown>;
    }
  ) {
    super(message, "MCP_ERROR", { ...options, retryable: true });
    this.name = "MCPError";
    this.serverName = serverName;
  }
}

/**
 * Type guard to check if error is a PM Agent error
 */
export function isPMAgentError(error: unknown): error is PMAgentError {
  return error instanceof PMAgentError;
}

/**
 * Type guard for retryable errors
 */
export function isRetryableError(error: unknown): boolean {
  if (isPMAgentError(error)) {
    return error.retryable;
  }

  // Check for common retryable network errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("rate limit")
    );
  }

  return false;
}

/**
 * Wrap an unknown error into a PM Agent error
 */
export function wrapError(error: unknown, defaultMessage = "Unknown error"): PMAgentError {
  if (isPMAgentError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new PMAgentError(error.message || defaultMessage, "UNKNOWN_ERROR", {
      cause: error,
    });
  }

  return new PMAgentError(
    typeof error === "string" ? error : defaultMessage,
    "UNKNOWN_ERROR"
  );
}
