/**
 * Filter Agent
 * Schema-preserving, deterministic, non-generative noise-clearing agent
 * Acts as "airlock" between Researcher and Forecaster
 *
 * Key properties:
 * - Subset-only: can only drop, merge, reorder, downgrade
 * - No tools except Write for output
 * - No status upgrades
 * - Frozen source labels
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
import type { FilterInput, FilterOutput } from "./types.js";
import { getFilterPrompt } from "./prompt.js";
import {
  FilterOutputSchema,
  validateSourceReferences,
  validateSubsetConstraint,
} from "./schema.js";

// ============================================
// AGENT CONFIGURATION
// ============================================

const FILTER_PROFILE: AgentProfile = {
  model: "sonnet",
  maxTurns: 5, // Filter is simple - should complete quickly
  maxBudgetUsd: 0.30, // Cheaper than forecaster - just filtering
  tools: ["Write"], // Only Write tool to save output
  mcpServers: {},
  retries: 2,
  backoffMs: 1000,
};

// ============================================
// AGENT DEPENDENCIES
// ============================================

export interface FilterDependencies {
  store: IStore;
  executor: IExecutor;
  observability: IObservability;
}

// ============================================
// FILTER AGENT
// ============================================

/**
 * Filter Agent
 * Cleans and compresses research output for forecaster
 */
export class FilterAgent {
  readonly name = "filter";
  readonly version = "1.0.0";

  private readonly deps: FilterDependencies;
  private readonly profile: AgentProfile;

  constructor(deps: FilterDependencies, profile?: Partial<AgentProfile>) {
    this.deps = deps;
    this.profile = { ...FILTER_PROFILE, ...profile };
  }

  /**
   * Run the filter agent
   */
  async run(
    input: FilterInput,
    context?: AgentContext
  ): Promise<AgentResult<FilterOutput>> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const correlationId = context?.correlationId ?? crypto.randomUUID();

    // Start session tracking
    const sessionId = await this.deps.observability.startSession({
      agentName: this.name,
      agentVersion: this.version,
      correlationId,
      input: {
        questionId: input.questionId,
        subject: input.subject.slice(0, 100),
        rawFindingsCount: input.rawResearch.findings.length,
        rawSourcesCount: input.rawResearch.sources.length,
        profile: input.config?.profile ?? "default",
      },
    });

    try {
      // Validate input
      const validatedInput = this.validateInput(input);

      // Determine output path
      const outputKey = validatedInput.targetId
        ? `analyst/${validatedInput.targetId}/filtered`
        : `analyst/temp/${correlationId}/filtered`;

      // Build prompt
      const prompt = getFilterPrompt({
        questionId: validatedInput.questionId,
        subject: validatedInput.subject,
        rawResearch: validatedInput.rawResearch,
        config: validatedInput.config,
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
      let output: FilterOutput;

      try {
        const savedOutput = await this.deps.store.read<unknown>(outputKey);
        output = FilterOutputSchema.parse(savedOutput);

        // Validate constraints
        const refErrors = validateSourceReferences(output);
        if (refErrors.length > 0) {
          this.deps.observability.log("warn", `[Filter] Source reference errors`, {
            errors: refErrors.slice(0, 5),
          });
        }

        const rawUrls = new Set(validatedInput.rawResearch.sources.map((s) => s.url));
        const subsetErrors = validateSubsetConstraint(output, rawUrls);
        if (subsetErrors.length > 0) {
          this.deps.observability.log("warn", `[Filter] Subset constraint violations`, {
            errors: subsetErrors.slice(0, 5),
          });
        }
      } catch {
        // Fallback: pass through raw research with minimal meta
        output = this.createFallbackOutput(validatedInput);
      }

      // Build result
      const result: AgentResult<FilterOutput> = {
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

      // Log filtering stats
      this.deps.observability.log("info", `[Filter] Complete`, {
        inputFindings: validatedInput.rawResearch.findings.length,
        outputFindings: output.findings.length,
        inputSources: validatedInput.rawResearch.sources.length,
        outputSources: output.sources.length,
        droppedFindings: output.meta.droppedFindingsCount,
        droppedSources: output.meta.droppedSourcesCount,
        rulesUsed: output.meta.rulesUsed,
      });

      // End session
      await this.deps.observability.endSession(sessionId, {
        success: true,
        output: {
          findingsKept: output.findings.length,
          sourcesKept: output.sources.length,
          rulesUsed: output.meta.rulesUsed.length,
        },
        metadata: result.metadata,
      });

      return result;
    } catch (error) {
      const errorResult: AgentResult<FilterOutput> = {
        success: false,
        output: null as unknown as FilterOutput,
        error: {
          type: "execution",
          code: "FILTER_ERROR",
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
  validateInput(input: unknown): FilterInput {
    const schema = z.object({
      questionId: z.string().min(1),
      subject: z.string().min(1),
      rawResearch: z.object({
        summary: z.string(),
        findings: z.array(z.any()),
        timeline: z.array(z.any()),
        openQuestions: z.array(z.any()),
        sources: z.array(z.any()),
      }),
      config: z
        .object({
          profile: z.enum(["strict", "default", "loose"]).optional(),
          maxFindings: z.number().optional(),
          maxTimelineEvents: z.number().optional(),
          maxSources: z.number().optional(),
          maxOpenQuestions: z.number().optional(),
        })
        .optional(),
      targetId: z.string().optional(),
    });

    return schema.parse(input) as FilterInput;
  }

  /**
   * Create fallback output if agent didn't produce valid output
   * Fallback = pass through raw research unchanged (safe default)
   */
  private createFallbackOutput(input: FilterInput): FilterOutput {
    // Safe fallback: pass through raw research with meta indicating no filtering
    return {
      summary: input.rawResearch.summary,
      findings: input.rawResearch.findings.map((f) => ({
        topic: f.topic,
        claim: f.claim,
        status: f.status,
        supportingSources: f.supportingSources,
        opposingSources: f.opposingSources,
        notes: f.notes,
      })),
      timeline: input.rawResearch.timeline.map((t) => ({
        date: t.date,
        event: t.event,
        sources: t.sources,
      })),
      openQuestions: input.rawResearch.openQuestions.map((q) => ({
        question: q.question,
        reason: q.reason,
      })),
      sources: input.rawResearch.sources.map((s) => ({
        url: s.url,
        title: s.title,
        type: s.type,
        publishedAt: s.publishedAt,
        retrievedAt: s.retrievedAt,
        relevance: s.relevance,
        credibility: s.credibility,
      })),
      meta: {
        droppedFindingsCount: 0,
        droppedSourcesCount: 0,
        droppedTimelineEventsCount: 0,
        droppedOpenQuestionsCount: 0,
        rulesUsed: [],
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
