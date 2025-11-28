/**
 * Researcher Agent
 * Core research agent for the Analyst system
 */

import { z } from "zod";
import type { AgentContext, AgentResult, AgentProfile } from "../../../../shared/agent/types.js";
import type { IExecutor } from "../../../../shared/executor/types.js";
import type { IStore } from "../../../../shared/store/types.js";
import type { IObservability } from "../../../../shared/observability/types.js";
import type { ResearcherInput, ResearcherOutput } from "./types.js";
import { getResearcherPrompt } from "./prompt.js";
import { ResearcherOutputSchema } from "./schema.js";

// ============================================
// AGENT CONFIGURATION
// ============================================

const RESEARCHER_PROFILE: AgentProfile = {
  model: "sonnet",
  maxTurns: 40,
  maxBudgetUsd: 3.0,
  tools: ["Bash", "Read", "Write", "WebSearch"],
  mcpServers: {
    // MCP servers can be added for enhanced research
  },
  retries: 2,
  backoffMs: 1000,
};

// ============================================
// AGENT DEPENDENCIES
// ============================================

export interface ResearcherDependencies {
  store: IStore;
  executor: IExecutor;
  observability: IObservability;
}

// ============================================
// RESEARCHER AGENT
// ============================================

/**
 * Researcher Agent
 * Performs deep research on a given subject
 */
export class ResearcherAgent {
  readonly name = "researcher";
  readonly version = "1.0.0";

  private readonly deps: ResearcherDependencies;
  private readonly profile: AgentProfile;

  constructor(deps: ResearcherDependencies, profile?: Partial<AgentProfile>) {
    this.deps = deps;
    this.profile = { ...RESEARCHER_PROFILE, ...profile };
  }

  /**
   * Run the researcher agent
   */
  async run(
    input: ResearcherInput,
    context?: AgentContext
  ): Promise<AgentResult<ResearcherOutput>> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const correlationId = context?.correlationId ?? crypto.randomUUID();

    // Start session tracking
    const sessionId = await this.deps.observability.startSession({
      agentName: this.name,
      agentVersion: this.version,
      correlationId,
      input,
    });

    try {
      // Validate input
      const validatedInput = this.validateInput(input);

      // Determine output path
      const outputKey = validatedInput.targetId
        ? `analyst/${validatedInput.targetId}/research`
        : `analyst/temp/${correlationId}/research`;

      // Build prompt
      const prompt = getResearcherPrompt({
        subject: validatedInput.subject,
        depth: validatedInput.depth,
        focus: validatedInput.focus,
        context: validatedInput.context,
        outputPath: this.deps.store.getPath(outputKey),
      });

      // Execute
      const execResult = await this.deps.executor.execute({
        prompt,
        profile: this.profile,
        context: {
          correlationId,
          agentName: this.name,
        },
      });

      if (!execResult.success) {
        throw new Error(execResult.error?.message ?? "Execution failed");
      }

      // Try to read output from file
      let output: ResearcherOutput;

      try {
        const savedOutput = await this.deps.store.read<unknown>(outputKey);
        output = ResearcherOutputSchema.parse(savedOutput);
      } catch {
        // Fallback: parse from agent output
        output = this.createFallbackOutput(validatedInput, execResult.output);
      }

      // Build result
      const result: AgentResult<ResearcherOutput> = {
        success: true,
        output,
        metadata: {
          agentName: this.name,
          agentVersion: this.version,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          costUsd: execResult.costUsd,
          tokens: execResult.tokens,
          toolsUsed: execResult.toolsUsed,
          turns: execResult.turns,
        },
      };

      // End session
      await this.deps.observability.endSession(sessionId, {
        success: true,
        output,
        metadata: result.metadata,
      });

      return result;

    } catch (error) {
      const errorResult: AgentResult<ResearcherOutput> = {
        success: false,
        output: null as unknown as ResearcherOutput,
        error: {
          type: "execution",
          code: "RESEARCHER_ERROR",
          message: error instanceof Error ? error.message : String(error),
          retryable: this.isRetryable(error),
        },
        metadata: {
          agentName: this.name,
          agentVersion: this.version,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          costUsd: 0,
          toolsUsed: [],
          turns: 0,
        },
      };

      await this.deps.observability.endSession(sessionId, {
        success: false,
        error,
        metadata: errorResult.metadata,
      });

      return errorResult;
    }
  }

  /**
   * Validate input
   */
  validateInput(input: unknown): ResearcherInput {
    const schema = z.object({
      subject: z.string().min(1),
      targetId: z.string().optional(),
      context: z.record(z.string(), z.unknown()).optional(),
      depth: z.enum(["quick", "standard", "deep", "exhaustive"]),
      focus: z.array(z.string()).optional(),
    });

    return schema.parse(input);
  }

  /**
   * Create fallback output if agent didn't write to file
   */
  private createFallbackOutput(
    _input: ResearcherInput,
    rawOutput: string
  ): ResearcherOutput {
    return {
      summary: `Fallback output - agent did not produce structured JSON. Raw: ${rawOutput.slice(0, 300)}`,
      findings: [],
      timeline: [],
      openQuestions: [
        {
          question: "Why did the agent fail to produce structured output?",
          reason: "Agent did not write valid JSON to the output file",
        },
      ],
      sources: [],
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
        message.includes("overloaded")
      );
    }
    return false;
  }
}
