/**
 * Forecaster Agent
 * Converts evidence into probability estimates
 * End of pipeline - NO tools except Write for output
 */

import { z } from "zod";
import type {
  AgentContext,
  AgentResult,
  AgentProfile,
} from "../../../../shared/agent/types.js";
import type { IExecutor } from "../../../../shared/executor/types.js";
import type { IStore } from "../../../../shared/store/types.js";
import type { IObservability } from "../../../../shared/observability/types.js";
import type { ForecasterInput, ForecasterOutput } from "./types.js";
import { getForecasterPrompt } from "./prompt.js";
import { ForecasterOutputSchema } from "./schema.js";

// ============================================
// AGENT CONFIGURATION
// ============================================

const FORECASTER_PROFILE: AgentProfile = {
  model: "sonnet",
  maxTurns: 10, // Forecaster is reasoning-only, shouldn't need many turns
  maxBudgetUsd: 0.50, // Much cheaper than researcher - no web searches
  tools: ["Write"], // Only Write tool to save output
  mcpServers: {},
  retries: 2,
  backoffMs: 1000,
};

// ============================================
// AGENT DEPENDENCIES
// ============================================

export interface ForecasterDependencies {
  store: IStore;
  executor: IExecutor;
  observability: IObservability;
}

// ============================================
// FORECASTER AGENT
// ============================================

/**
 * Forecaster Agent
 * Takes evidence and produces probability estimates
 */
export class ForecasterAgent {
  readonly name = "forecaster";
  readonly version = "1.0.0";

  private readonly deps: ForecasterDependencies;
  private readonly profile: AgentProfile;

  constructor(
    deps: ForecasterDependencies,
    profile?: Partial<AgentProfile>
  ) {
    this.deps = deps;
    this.profile = { ...FORECASTER_PROFILE, ...profile };
  }

  /**
   * Run the forecaster agent
   */
  async run(
    input: ForecasterInput,
    context?: AgentContext
  ): Promise<AgentResult<ForecasterOutput>> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const correlationId = context?.correlationId ?? crypto.randomUUID();

    // Start session tracking
    const sessionId = await this.deps.observability.startSession({
      agentName: this.name,
      agentVersion: this.version,
      correlationId,
      input: {
        question: input.question,
        hasMarket: !!input.market,
        hasBaseRates: !!input.baseRates?.length,
        evidenceSummary: input.evidence.summary.slice(0, 200),
      },
    });

    try {
      // Validate input
      const validatedInput = this.validateInput(input);

      // Determine output path
      const outputKey = validatedInput.targetId
        ? `analyst/${validatedInput.targetId}/forecast`
        : `analyst/temp/${correlationId}/forecast`;

      // Build prompt
      const prompt = getForecasterPrompt({
        question: validatedInput.question,
        evidence: validatedInput.evidence,
        market: validatedInput.market,
        baseRates: validatedInput.baseRates,
        budget: validatedInput.budget,
        resolutionDate: validatedInput.resolutionDate,
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
      let output: ForecasterOutput;

      try {
        const savedOutput = await this.deps.store.read<unknown>(outputKey);
        output = ForecasterOutputSchema.parse(savedOutput);
      } catch {
        // Fallback: try to parse from agent output
        output = this.createFallbackOutput(validatedInput, execResult.output);
      }

      // Build result
      const result: AgentResult<ForecasterOutput> = {
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
        output:
          output.mode === "forecast"
            ? {
                mode: output.mode,
                probability: output.forecast.probability,
                confidence: output.forecast.confidence,
              }
            : {
                mode: output.mode,
                question: output.request.question,
              },
        metadata: result.metadata,
      });

      return result;
    } catch (error) {
      const errorResult: AgentResult<ForecasterOutput> = {
        success: false,
        output: null as unknown as ForecasterOutput,
        error: {
          type: "execution",
          code: "FORECASTER_ERROR",
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
  validateInput(input: unknown): ForecasterInput {
    const schema = z.object({
      question: z.string().min(1),
      evidence: z.object({
        summary: z.string(),
        findings: z.array(z.any()),
        timeline: z.array(z.any()),
        openQuestions: z.array(z.any()),
        sources: z.array(z.any()),
      }),
      market: z
        .object({
          yesPrice: z.number().min(0).max(1),
          noPrice: z.number().min(0).max(1).optional(),
          volume24h: z.number().optional(),
          liquidity: z.number().optional(),
          source: z.string(),
          fetchedAt: z.string(),
        })
        .optional(),
      baseRates: z
        .array(
          z.object({
            referenceClass: z.string(),
            probability: z.number().min(0).max(1),
            sampleSize: z.number().optional(),
            source: z.string(),
            applicability: z.enum(["high", "medium", "low"]),
          })
        )
        .optional(),
      budget: z
        .object({
          remainingUsd: z.number(),
          maxResearchCalls: z.number(),
        })
        .optional(),
      resolutionDate: z.string().optional(),
      targetId: z.string().optional(),
    });

    return schema.parse(input) as ForecasterInput;
  }

  /**
   * Create fallback output if agent didn't write to file
   */
  private createFallbackOutput(
    input: ForecasterInput,
    rawOutput: string
  ): ForecasterOutput {
    // Try to extract probability from raw output
    const probMatch = rawOutput.match(/probability[:\s]+([0-9.]+)/i);
    const prob = probMatch ? parseFloat(probMatch[1]) : 0.5;

    return {
      mode: "forecast",
      forecast: {
        outcome: "YES",
        probability: Math.min(0.99, Math.max(0.01, prob)),
        lowerBound: Math.max(0.01, prob - 0.2),
        upperBound: Math.min(0.99, prob + 0.2),
        confidence: "low",
        baselinesUsed: [
          {
            source: "Market price (if available)",
            value: input.market?.yesPrice ?? 0.5,
            weight: 0.5,
            reasoning: "Fallback output - used market as anchor",
          },
        ],
        evidenceSummary:
          "Fallback output - agent did not produce structured JSON",
        probabilityReasoning: rawOutput.slice(0, 500),
        assumptions: ["Fallback output - assumptions unclear"],
      },
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
