/**
 * Claude Executor
 * Implementation using Claude Agent SDK
 */

import {
  query,
  type Options,
  type SDKMessage,
  type SDKResultMessage,
  type SDKAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  IExecutor,
  ExecutorRequest,
  ExecutorResponse,
  ExecutorOptions,
} from "./types.js";
import type { AgentProfile, MCPServerConfig } from "../agent/types.js";

/**
 * Map model names to actual model IDs
 */
function getModelId(model: "haiku" | "sonnet" | "opus"): string {
  const models = {
    haiku: "claude-sonnet-4-20250514", // Using sonnet as haiku proxy
    sonnet: "claude-sonnet-4-20250514",
    opus: "claude-sonnet-4-20250514", // Using sonnet as opus proxy
  };
  return models[model];
}

/**
 * Build MCP server configs for the SDK
 */
function buildMcpServers(
  mcpServers?: Record<string, MCPServerConfig>
): Options["mcpServers"] {
  if (!mcpServers) return undefined;

  const result: Options["mcpServers"] = {};

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
 * Claude SDK Executor
 */
export class ClaudeExecutor implements IExecutor {
  private readonly options: ExecutorOptions;

  constructor(options: ExecutorOptions = {}) {
    this.options = {
      cwd: options.cwd ?? process.cwd(),
      permissionMode: options.permissionMode ?? "bypassPermissions",
      retries: options.retries ?? 2,
      backoffMs: options.backoffMs ?? 1000,
    };
  }

  /**
   * Check if executor is ready
   */
  isReady(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  /**
   * Execute a prompt
   */
  async execute(request: ExecutorRequest): Promise<ExecutorResponse> {
    const startTime = Date.now();
    const { prompt, systemPrompt, profile, context } = request;

    let lastError: Error | undefined;
    let attempt = 0;

    while (attempt < (this.options.retries ?? 2)) {
      attempt++;

      try {
        return await this.executeOnce(prompt, systemPrompt, profile, startTime);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!this.isRetryable(error) || attempt >= (this.options.retries ?? 2)) {
          break;
        }

        // Exponential backoff
        const delay = (this.options.backoffMs ?? 1000) * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return {
      success: false,
      output: "",
      costUsd: 0,
      durationMs: Date.now() - startTime,
      toolsUsed: [],
      turns: 0,
      error: {
        code: "EXECUTOR_ERROR",
        message: lastError?.message ?? "Unknown error",
      },
    };
  }

  /**
   * Execute once (no retries)
   */
  private async executeOnce(
    prompt: string,
    systemPrompt: string | undefined,
    profile: AgentProfile,
    startTime: number
  ): Promise<ExecutorResponse> {
    // Build SDK options
    const options: Options = {
      systemPrompt,
      allowedTools: profile.tools,
      mcpServers: buildMcpServers(profile.mcpServers),
      maxTurns: profile.maxTurns,
      maxBudgetUsd: profile.maxBudgetUsd,
      permissionMode: this.options.permissionMode as "bypassPermissions",
      cwd: this.options.cwd,
    };

    // Execute query
    const result = query({ prompt, options });

    // Process stream
    let output = "";
    let sessionId: string | undefined;
    let costUsd = 0;
    let durationMs = 0;
    let turns = 0;
    const toolsUsed = new Set<string>();
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const message of result) {
      if (message.type === "assistant") {
        const assistantMsg = message as SDKAssistantMessage;
        for (const block of assistantMsg.message.content) {
          if (block.type === "text") {
            output += block.text;
          } else if (block.type === "tool_use") {
            toolsUsed.add(block.name);
          }
        }
        turns++;
      } else if (message.type === "result") {
        const resultMsg = message as SDKResultMessage;

        if (resultMsg.subtype === "success") {
          costUsd = resultMsg.total_cost_usd ?? 0;
          durationMs = resultMsg.duration_ms ?? 0;
          sessionId = resultMsg.session_id;

          if (!output && resultMsg.result) {
            output = resultMsg.result;
          }
        } else if (resultMsg.subtype === "error_during_execution") {
          throw new Error(resultMsg.errors?.[0] ?? "Execution error");
        } else if (resultMsg.subtype === "error_max_budget_usd") {
          throw new Error(`Budget exceeded: $${resultMsg.total_cost_usd}`);
        } else if (resultMsg.subtype === "error_max_turns") {
          throw new Error(`Max turns exceeded: ${profile.maxTurns}`);
        }
      }
    }

    return {
      success: true,
      output,
      sessionId,
      costUsd,
      durationMs: durationMs || Date.now() - startTime,
      tokens: {
        input: inputTokens,
        output: outputTokens,
      },
      toolsUsed: Array.from(toolsUsed),
      turns,
    };
  }

  /**
   * Check if error is retryable
   */
  private isRetryable(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("timeout") ||
        message.includes("rate limit") ||
        message.includes("overloaded") ||
        message.includes("529") ||
        message.includes("503")
      );
    }
    return false;
  }
}

/**
 * Create a Claude executor with default options
 */
export function createClaudeExecutor(options?: ExecutorOptions): IExecutor {
  return new ClaudeExecutor(options);
}
