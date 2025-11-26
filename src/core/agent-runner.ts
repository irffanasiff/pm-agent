/**
 * Agent Runner - Claude Agent SDK Wrapper
 * Production wrapper around Claude Agent SDK with profiles, retries, and cost tracking
 *
 * THIS IS THE CORE SDK INTEGRATION:
 * =================================
 * This file wraps the Claude Agent SDK's query() function with:
 *   - Agent profiles (discovery/research/critic with different models & budgets)
 *   - Automatic retry with exponential backoff
 *   - Cost tracking and budget enforcement
 *   - Structured logging with correlation IDs
 *
 * EXECUTION FLOW:
 * ===============
 * runAgent(config)
 *   ├─ Get profile from config (model, maxTurns, budget, tools)
 *   ├─ RETRY LOOP (up to profile.retries times):
 *   │   ├─ executeAgent() - calls SDK query()
 *   │   ├─ Stream messages from Claude
 *   │   ├─ Track tool usage, cost, turns
 *   │   ├─ If success → return result
 *   │   ├─ If budget exceeded → throw BudgetExceededError
 *   │   └─ If retryable error → exponential backoff, retry
 *   └─ All retries failed → return error result
 *
 * KEY FUNCTIONS:
 *   runAgent()     - Main entry point with retry logic
 *   executeAgent() - Single SDK call, streams response
 *   query()        - SDK function that runs Claude (imported from SDK)
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

// ============================================================
// MAIN ENTRY POINT: runAgent()
// ============================================================
/**
 * Run an agent with the specified profile
 *
 * This is called by:
 *   - discovery.ts:135 (Discovery Agent - Haiku)
 *   - research.ts:87   (Research Agent - Sonnet)
 *   - critic.ts:84     (Critic Agent - Haiku)
 *
 * @param config - Agent configuration (profile, prompt, correlationId)
 * @returns AgentRunResult with output, cost, duration, tools used
 */
export async function runAgent(config: AgentRunConfig): Promise<AgentRunResult> {
  // --------------------------------------------------------
  // STEP 1: Load profile configuration
  // Profiles define: model, maxTurns, maxBudget, tools, retries
  // See config.ts for profile definitions
  // --------------------------------------------------------
  const appConfig = getConfig();
  const profile = appConfig.profiles[config.profile];
  const correlationId = config.correlationId ?? crypto.randomUUID();

  // Create a child logger with context for tracing
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

  // --------------------------------------------------------
  // STEP 2: RETRY LOOP
  // Attempts up to profile.retries times (default: 2-3)
  // Only retries on retryable errors (network, rate limits)
  // --------------------------------------------------------
  while (attempt < profile.retries) {
    attempt++;

    try {
      // *** EXECUTE THE AGENT ***
      // This calls the SDK and streams the response
      const result = await executeAgent(config, profile, log, correlationId);

      // Check if we exceeded budget (post-execution check)
      if (result.costUsd > profile.maxBudgetUsd) {
        throw new BudgetExceededError(
          config.profile,
          profile.maxBudgetUsd,
          result.costUsd
        );
      }

      // SUCCESS! Log and return
      log.info("Agent run completed", {
        success: result.success,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        turns: result.turns,
        attempt,
      });

      // Log cost metric for tracking
      logger.metric("agent_cost_usd", result.costUsd, {
        correlationId,
        agentType: config.profile,
      });

      return result;

    } catch (error) {
      // --------------------------------------------------------
      // ERROR HANDLING
      // --------------------------------------------------------
      lastError = error instanceof Error ? error : new Error(String(error));

      log.warn(`Agent run failed (attempt ${attempt}/${profile.retries})`, {
        error: lastError.message,
      });

      // Only retry if error is retryable (network issues, rate limits)
      // Non-retryable: budget exceeded, validation errors, etc.
      if (!isRetryableError(error)) {
        break;  // Don't retry, exit loop
      }

      // Exponential backoff before retry
      // attempt 1: backoffMs * 1 = 1000ms
      // attempt 2: backoffMs * 2 = 2000ms
      // attempt 3: backoffMs * 4 = 4000ms
      if (attempt < profile.retries) {
        const backoffMs = profile.backoffMs * Math.pow(2, attempt - 1);
        log.debug(`Retrying in ${backoffMs}ms`);
        await sleep(backoffMs);
      }
    }
  }

  // --------------------------------------------------------
  // ALL RETRIES EXHAUSTED - Return failure
  // --------------------------------------------------------
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

// ============================================================
// EXECUTE AGENT: Where the SDK is actually called
// ============================================================
/**
 * Execute a single agent run (no retries)
 *
 * THIS IS WHERE CLAUDE ACTUALLY RUNS:
 * 1. Build QueryOptions from profile
 * 2. Call query() from SDK - returns async generator
 * 3. Stream and process messages as they arrive
 * 4. Return accumulated result
 */
async function executeAgent(
  config: AgentRunConfig,
  profile: AgentProfile,
  log: ChildLogger,
  correlationId: string
): Promise<AgentRunResult> {
  const startTime = Date.now();
  const appConfig = getConfig();

  // --------------------------------------------------------
  // STEP 1: Build SDK query options from profile
  // --------------------------------------------------------
  const options: QueryOptions = {
    systemPrompt: config.systemPrompt,
    allowedTools: profile.tools,        // e.g., ["Bash", "Read", "Write", "WebSearch"]
    mcpServers: buildMcpServers(profile.mcpServers),  // Parallel.ai MCP for research
    maxTurns: profile.maxTurns,         // 5 for discovery/critic, 15 for research
    permissionMode: "bypassPermissions", // No human approval needed
    cwd: process.cwd(),                 // Working directory for file operations
  };

  log.debug("Executing query", { tools: profile.tools });

  // --------------------------------------------------------
  // STEP 2: CALL THE SDK - THIS STARTS CLAUDE
  // query() returns an async generator that yields messages
  // as Claude thinks, uses tools, and produces output
  // --------------------------------------------------------
  const result = query({
    prompt: config.prompt,  // The task prompt from getXxxPrompt()
    options,
  });

  // --------------------------------------------------------
  // STEP 3: STREAM PROCESSING LOOP
  // Process messages as they arrive from Claude
  // --------------------------------------------------------
  let output = "";
  let sessionId: string | undefined;
  let costUsd = 0;
  let durationMs = 0;
  let turns = 0;
  const toolsUsed = new Set<string>();

  // Iterate over the async generator
  for await (const message of result) {

    // ASSISTANT MESSAGE: Claude's response (text or tool use)
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          // Accumulate text output
          output += block.text;
        } else if (block.type === "tool_use") {
          // Track which tools were used
          toolsUsed.add(block.name);
          log.debug(`Tool used: ${block.name}`);
        }
      }
      turns++;  // Count conversation turns

    // RESULT MESSAGE: Final status from SDK
    } else if (message.type === "result") {
      if (message.subtype === "success") {
        // Success! Extract final metrics
        costUsd = message.total_cost_usd ?? 0;
        durationMs = message.duration_ms ?? 0;
        sessionId = message.session_id;

      } else if (message.subtype === "error") {
        // Agent encountered an error
        throw new AgentError(
          message.error ?? "Unknown agent error",
          config.profile,
          { correlationId }
        );

      } else if (message.subtype === "budget") {
        // Budget exceeded during execution
        throw new BudgetExceededError(
          config.profile,
          profile.maxBudgetUsd,
          costUsd
        );

      } else if (message.subtype === "turns_exceeded") {
        // Max turns reached without completion
        throw new MaxTurnsExceededError(
          config.profile,
          profile.maxTurns
        );
      }
    }
  }

  // --------------------------------------------------------
  // STEP 4: Return accumulated result
  // --------------------------------------------------------
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
