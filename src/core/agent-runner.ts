/**
 * Agent Runner
 * Production wrapper around Claude Agent SDK with profiles, retries, and cost tracking
 */

import { query, type QueryOptions, type QueryMessage } from "@anthropic-ai/claude-agent-sdk";
import { getConfig, type AgentProfile, type MCPServerConfig } from "./config.js";
import { logger, type ChildLogger } from "./logger.js";
import {
  AgentError,
  BudgetExceededError,
  MaxTurnsExceededError,
  isRetryableError,
  wrapError,
} from "./errors.js";

/**
 * Agent run configuration
 */
export interface AgentRunConfig {
  /** Agent profile to use */
  profile: "discovery" | "research" | "critic";
  /** The prompt to send to the agent */
  prompt: string;
  /** Optional system prompt override */
  systemPrompt?: string;
  /** Correlation ID for tracing */
  correlationId?: string;
  /** Additional context for logging */
  context?: Record<string, unknown>;
}

/**
 * Result from an agent run
 */
export interface AgentRunResult {
  /** Whether the run succeeded */
  success: boolean;
  /** The agent's text output */
  output: string;
  /** Session ID from the agent */
  sessionId?: string;
  /** Cost in USD */
  costUsd: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Number of turns taken */
  turns: number;
  /** Tools that were used */
  toolsUsed: string[];
  /** Any error that occurred */
  error?: Error;
}

/**
 * Map SDK model names to profile models
 */
function getModelId(model: "haiku" | "sonnet" | "opus"): string {
  const models = {
    haiku: "claude-sonnet-4-20250514", // Using sonnet as haiku proxy for now
    sonnet: "claude-sonnet-4-20250514",
    opus: "claude-sonnet-4-20250514", // Using sonnet as opus proxy for now
  };
  return models[model];
}

/**
 * Build MCP server configs for the SDK
 */
function buildMcpServers(
  mcpServers?: Record<string, MCPServerConfig>
): QueryOptions["mcpServers"] {
  if (!mcpServers) return undefined;

  const result: QueryOptions["mcpServers"] = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (config.type === "sse" && config.url) {
      result[name] = {
        type: "sse",
        url: config.url,
        headers: config.headers,
      };
    } else if (config.type === "stdio" && config.command) {
      result[name] = {
        type: "stdio",
        command: config.command,
        args: config.args,
        env: config.env,
      };
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an agent with the specified profile
 */
export async function runAgent(config: AgentRunConfig): Promise<AgentRunResult> {
  const appConfig = getConfig();
  const profile = appConfig.profiles[config.profile];
  const correlationId = config.correlationId ?? crypto.randomUUID();

  // Create a child logger with context
  const log = logger.child({
    correlationId,
    agentType: config.profile,
    ...config.context,
  });

  log.info("Starting agent run", {
    model: profile.model,
    maxTurns: profile.maxTurns,
    maxBudgetUsd: profile.maxBudgetUsd,
  });

  let lastError: Error | undefined;
  let attempt = 0;

  // Retry loop
  while (attempt < profile.retries) {
    attempt++;

    try {
      const result = await executeAgent(config, profile, log, correlationId);

      // Check budget
      if (result.costUsd > profile.maxBudgetUsd) {
        throw new BudgetExceededError(
          config.profile,
          profile.maxBudgetUsd,
          result.costUsd
        );
      }

      log.info("Agent run completed", {
        success: result.success,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        turns: result.turns,
        attempt,
      });

      // Log cost metric
      logger.metric("agent_cost_usd", result.costUsd, {
        correlationId,
        agentType: config.profile,
      });

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      log.warn(`Agent run failed (attempt ${attempt}/${profile.retries})`, {
        error: lastError.message,
      });

      // Only retry if error is retryable
      if (!isRetryableError(error)) {
        break;
      }

      // Exponential backoff
      if (attempt < profile.retries) {
        const backoffMs = profile.backoffMs * Math.pow(2, attempt - 1);
        log.debug(`Retrying in ${backoffMs}ms`);
        await sleep(backoffMs);
      }
    }
  }

  // All retries exhausted
  const wrapped = wrapError(lastError, "Agent run failed after retries");
  log.error("Agent run failed", wrapped);

  return {
    success: false,
    output: "",
    costUsd: 0,
    durationMs: 0,
    turns: 0,
    toolsUsed: [],
    error: wrapped,
  };
}

/**
 * Execute a single agent run (no retries)
 */
async function executeAgent(
  config: AgentRunConfig,
  profile: AgentProfile,
  log: ChildLogger,
  correlationId: string
): Promise<AgentRunResult> {
  const startTime = Date.now();
  const appConfig = getConfig();

  // Build query options
  const options: QueryOptions = {
    systemPrompt: config.systemPrompt,
    allowedTools: profile.tools,
    mcpServers: buildMcpServers(profile.mcpServers),
    maxTurns: profile.maxTurns,
    permissionMode: "bypassPermissions",
    cwd: process.cwd(),
  };

  log.debug("Executing query", { tools: profile.tools });

  const result = query({
    prompt: config.prompt,
    options,
  });

  // Process the stream
  let output = "";
  let sessionId: string | undefined;
  let costUsd = 0;
  let durationMs = 0;
  let turns = 0;
  const toolsUsed = new Set<string>();

  for await (const message of result) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          output += block.text;
        } else if (block.type === "tool_use") {
          toolsUsed.add(block.name);
          log.debug(`Tool used: ${block.name}`);
        }
      }
      turns++;
    } else if (message.type === "result") {
      if (message.subtype === "success") {
        costUsd = message.total_cost_usd ?? 0;
        durationMs = message.duration_ms ?? 0;
        sessionId = message.session_id;
      } else if (message.subtype === "error") {
        throw new AgentError(
          message.error ?? "Unknown agent error",
          config.profile,
          { correlationId }
        );
      } else if (message.subtype === "budget") {
        throw new BudgetExceededError(
          config.profile,
          profile.maxBudgetUsd,
          costUsd
        );
      } else if (message.subtype === "turns_exceeded") {
        throw new MaxTurnsExceededError(
          config.profile,
          profile.maxTurns
        );
      }
    }
  }

  return {
    success: true,
    output,
    sessionId,
    costUsd,
    durationMs: durationMs || Date.now() - startTime,
    turns,
    toolsUsed: Array.from(toolsUsed),
  };
}

/**
 * Create a runner bound to a specific profile
 */
export function createRunner(profile: "discovery" | "research" | "critic") {
  return {
    /**
     * Run the agent with this profile
     */
    run: (
      prompt: string,
      options?: {
        systemPrompt?: string;
        correlationId?: string;
        context?: Record<string, unknown>;
      }
    ) =>
      runAgent({
        profile,
        prompt,
        ...options,
      }),

    /**
     * Get the profile configuration
     */
    getProfile: () => getConfig().profiles[profile],
  };
}

// Export pre-configured runners
export const discoveryRunner = createRunner("discovery");
export const researchRunner = createRunner("research");
export const criticRunner = createRunner("critic");
