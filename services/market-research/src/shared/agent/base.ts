/**
 * Base Agent Class
 * Abstract base class that agents can extend
 */

import type {
  IAgent,
  AgentContext,
  AgentResult,
  AgentMetadata,
  AgentProfile,
  ExecutionMetadata,
} from "./types.js";
import type { IExecutor, ExecutorRequest } from "../executor/types.js";
import type { IStore } from "../store/types.js";
import type { IObservability } from "../observability/types.js";

/**
 * Dependencies injected into agents
 */
export interface AgentDependencies {
  executor: IExecutor;
  store: IStore;
  observability: IObservability;
}

/**
 * Base agent configuration
 */
export interface BaseAgentConfig {
  name: string;
  version: string;
  description: string;
  profile: AgentProfile;
}

/**
 * Abstract base agent class
 * Provides common functionality for all agents
 */
export abstract class BaseAgent<TInput, TOutput> implements IAgent<TInput, TOutput> {
  readonly name: string;
  readonly version: string;

  protected readonly config: BaseAgentConfig;
  protected readonly deps: AgentDependencies;

  constructor(config: BaseAgentConfig, deps: AgentDependencies) {
    this.name = config.name;
    this.version = config.version;
    this.config = config;
    this.deps = deps;
  }

  /**
   * Run the agent
   */
  async run(input: TInput, context?: AgentContext): Promise<AgentResult<TOutput>> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const correlationId = context?.correlationId ?? crypto.randomUUID();

    // Start observability tracking
    const sessionId = await this.deps.observability.startSession({
      agentName: this.name,
      agentVersion: this.version,
      correlationId,
      input,
    });

    try {
      // Validate input
      const validatedInput = this.validateInput(input);

      // Build the prompt
      const prompt = await this.buildPrompt(validatedInput, context);

      // Execute via executor
      const execResult = await this.deps.executor.execute({
        prompt,
        profile: this.config.profile,
        context: {
          correlationId,
          agentName: this.name,
          ...context?.metadata,
        },
      });

      if (!execResult.success) {
        throw new Error(execResult.error?.message ?? "Execution failed");
      }

      // Parse the output
      const output = await this.parseOutput(execResult.output, validatedInput, context);

      // Build metadata
      const metadata: ExecutionMetadata = {
        agentName: this.name,
        agentVersion: this.version,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        costUsd: execResult.costUsd,
        tokens: execResult.tokens,
        toolsUsed: execResult.toolsUsed,
        turns: execResult.turns,
      };

      // Record success
      await this.deps.observability.endSession(sessionId, {
        success: true,
        output,
        metadata,
      });

      return {
        success: true,
        output,
        metadata,
      };

    } catch (error) {
      const metadata: ExecutionMetadata = {
        agentName: this.name,
        agentVersion: this.version,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        costUsd: 0,
        toolsUsed: [],
        turns: 0,
      };

      // Record failure
      await this.deps.observability.endSession(sessionId, {
        success: false,
        error,
        metadata,
      });

      return {
        success: false,
        output: null as unknown as TOutput,
        error: {
          type: "execution",
          code: "AGENT_ERROR",
          message: error instanceof Error ? error.message : String(error),
          retryable: this.isRetryable(error),
          cause: error instanceof Error ? error : undefined,
        },
        metadata,
      };
    }
  }

  /**
   * Validate input - must be implemented by subclass
   */
  abstract validateInput(input: unknown): TInput;

  /**
   * Build prompt for the agent - must be implemented by subclass
   */
  protected abstract buildPrompt(input: TInput, context?: AgentContext): Promise<string>;

  /**
   * Parse output from executor - must be implemented by subclass
   */
  protected abstract parseOutput(
    raw: string,
    input: TInput,
    context?: AgentContext
  ): Promise<TOutput>;

  /**
   * Get agent metadata
   */
  getMetadata(): AgentMetadata {
    return {
      name: this.name,
      version: this.version,
      description: this.config.description,
      tools: this.config.profile.tools,
      estimatedCost: {
        min: 0.001,
        max: this.config.profile.maxBudgetUsd,
        typical: this.config.profile.maxBudgetUsd * 0.5,
      },
    };
  }

  /**
   * Check if an error is retryable
   */
  protected isRetryable(error: unknown): boolean {
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
