/**
 * Analyst System
 * Orchestrates deep analysis using internal agents
 *
 * Two Modes:
 * 1. Legacy Pipeline: Researcher → Filter → Forecaster (backward compatible)
 * 2. Orchestrator Mode: Forecaster drives research via DECOMPOSE → ANALYZE → FORECAST phases
 *
 * Agent Roles:
 * - Researcher: Pure evidence gatherer, noisy but comprehensive
 * - Filter: Schema-preserving noise cleaner, conservative airlock
 * - Forecaster: Orchestrator, probability estimator, VOI decision maker
 */

import type {
  AnalystInput,
  AnalystSystemOptions,
} from "./types.js";
import type { IStore } from "../../shared/store/types.js";
import type { IExecutor } from "../../shared/executor/types.js";
import type { IObservability } from "../../shared/observability/types.js";
import { createFileStore } from "../../shared/store/file.js";
import { createClaudeExecutor } from "../../shared/executor/claude.js";
import { createConsoleObservability } from "../../shared/observability/console.js";

// Import agents
import { ResearcherAgent } from "./agents/researcher/agent.js";
import type { ResearcherOutput } from "./agents/researcher/types.js";
import { FilterAgent } from "./agents/filter/agent.js";
import type { FilterOutput, FilterProfile } from "./agents/filter/types.js";
import { ForecasterAgent } from "./agents/forecaster/agent.js";
import type {
  ForecasterOutput,
  ForecasterOrchestratorInput,
  ResearchQuestion,
  EvidencePackage,
  DecomposeOutput,
  AnalyzeOutput,
  MarketData,
  BaseRate,
} from "./agents/forecaster/types.js";

// Import utilities
import { aggregateEvidence, type AggregatedEvidence } from "./utils/evidence-aggregator.js";

// ============================================
// PIPELINE OUTPUT TYPES
// ============================================

/**
 * Full pipeline output: research + filter + forecast
 */
export interface AnalystPipelineOutput {
  targetId?: string;
  subject: string;

  /** Raw research from Researcher agent */
  research: ResearcherOutput;

  /** Cleaned evidence from Filter agent */
  filtered: FilterOutput;

  /** Forecast from Forecaster agent */
  forecast: ForecasterOutput;

  /** Pipeline metadata */
  metadata: PipelineMetadata;
}

export interface PipelineMetadata {
  systemVersion: string;
  agentsUsed: string[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  costUsd: number;
  toolsUsed: string[];
  turns: number;
  /** Per-agent costs for analysis */
  costBreakdown: {
    researcher: number;
    filter: number;
    forecaster: number;
  };
}

/**
 * Extended input for full pipeline
 */
export interface AnalystPipelineInput extends AnalystInput {
  /** Market data for forecaster */
  market?: MarketData;

  /** Base rates for forecaster */
  baseRates?: BaseRate[];

  /** Budget for VOI decisions */
  budget?: {
    remainingUsd: number;
    maxResearchCalls: number;
  };

  /** Resolution date for the question */
  resolutionDate?: string;

  /** Filter profile: strict, default, loose */
  filterProfile?: FilterProfile;

  /** Skip filter (research → forecaster directly) */
  skipFilter?: boolean;

  /** Research only mode (no filter or forecast) */
  researchOnly?: boolean;
}

/**
 * Dependencies for the Analyst system
 */
export interface AnalystDependencies {
  store: IStore;
  executor: IExecutor;
  observability: IObservability;
}

// ============================================
// ORCHESTRATOR MODE TYPES
// ============================================

/**
 * Input for orchestrator mode (Forecaster-driven)
 */
export interface OrchestratorInput {
  /** The question to forecast */
  question: string;

  /** Source of the input */
  source: "scout" | "user" | "api" | "scheduled";

  /** Context from Scout (if source is scout) */
  scoutContext?: {
    trader: { id: string; name: string; wallet: string };
    trade: { side: "BUY" | "SELL"; outcome: "YES" | "NO"; usdValue: number; price: number };
  };

  /** Current market data */
  market?: MarketData;

  /** Historical base rates */
  baseRates?: BaseRate[];

  /** Budget constraints */
  budget?: {
    totalUsd: number;
    maxResearchIterations: number;
  };

  /** Resolution date */
  resolutionDate?: string;

  /** Target ID for data storage */
  targetId?: string;

  /** Filter profile */
  filterProfile?: FilterProfile;
}

/**
 * Output from orchestrator mode
 */
export interface OrchestratorOutput {
  /** Target ID */
  targetId?: string;

  /** The question */
  question: string;

  /** Final forecast */
  forecast: ForecasterOutput;

  /** All evidence collected */
  evidence: EvidencePackage[];

  /** Aggregated evidence summary */
  aggregatedEvidence: AggregatedEvidence;

  /** Research questions asked */
  questionsAsked: ResearchQuestion[];

  /** Pipeline metadata */
  metadata: OrchestratorMetadata;
}

export interface OrchestratorMetadata {
  systemVersion: string;
  mode: "orchestrator";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  costUsd: number;
  researchIterations: number;
  questionsAnswered: number;

  /** Per-phase costs */
  costBreakdown: {
    decompose: number;
    research: number;
    filter: number;
    analyze: number;
    forecast: number;
  };
}

// ============================================
// ANALYST SYSTEM
// ============================================

/**
 * Analyst System
 * Two modes:
 * 1. Legacy Pipeline: Researcher → Filter → Forecaster
 * 2. Orchestrator Mode: Forecaster drives research via phases
 */
export class AnalystSystem {
  private readonly options: AnalystSystemOptions;
  private readonly deps: AnalystDependencies;

  // Internal agents
  private readonly researcher: ResearcherAgent;
  private readonly filter: FilterAgent;
  private readonly forecaster: ForecasterAgent;

  constructor(
    options: AnalystSystemOptions = {},
    deps?: Partial<AnalystDependencies>
  ) {
    this.options = {
      dataDir: options.dataDir ?? "./data",
      defaultDepth: options.defaultDepth ?? "standard",
      agents: {
        researcher: true,
        factChecker: true,
        synthesizer: true,
        ...options.agents,
      },
      ...options,
    };

    // Initialize dependencies with defaults
    this.deps = {
      store: deps?.store ?? createFileStore(this.options.dataDir!),
      executor: deps?.executor ?? createClaudeExecutor(),
      observability: deps?.observability ?? createConsoleObservability(),
    };

    // Initialize agents
    const agentDeps = {
      store: this.deps.store,
      executor: this.deps.executor,
      observability: this.deps.observability,
    };

    this.researcher = new ResearcherAgent(agentDeps);
    this.filter = new FilterAgent(agentDeps);
    this.forecaster = new ForecasterAgent(agentDeps);
  }

  /**
   * Run full pipeline: Researcher → Filter → Forecaster
   */
  async runPipeline(input: AnalystPipelineInput): Promise<AnalystPipelineOutput> {
    const startTime = Date.now();
    const correlationId = crypto.randomUUID();

    this.deps.observability.log("info", `[Analyst] Starting full pipeline`, {
      subject: input.subject.slice(0, 100),
      depth: input.depth,
      filterProfile: input.filterProfile ?? "default",
      skipFilter: input.skipFilter ?? false,
      researchOnly: input.researchOnly ?? false,
    });

    // Track metrics
    const agentsUsed: string[] = [];
    const allToolsUsed = new Set<string>();
    const costBreakdown = { researcher: 0, filter: 0, forecaster: 0 };
    let totalTurns = 0;

    try {
      // ========================================
      // STEP 1: Researcher
      // ========================================
      this.deps.observability.log("info", `[Analyst] Step 1: Running Researcher...`);

      const researchResult = await this.researcher.run(
        {
          subject: input.subject,
          targetId: input.targetId,
          context: input.context,
          depth: input.depth,
          focus: input.focus,
        },
        { correlationId, systemName: "analyst", domain: this.options.domain }
      );

      if (!researchResult.success) {
        throw new Error(researchResult.error?.message ?? "Research failed");
      }

      agentsUsed.push(this.researcher.name);
      costBreakdown.researcher = researchResult.metadata.costUsd;
      totalTurns += researchResult.metadata.turns;
      researchResult.metadata.toolsUsed.forEach((t) => allToolsUsed.add(t));

      this.deps.observability.log("info", `[Analyst] Researcher complete`, {
        findings: researchResult.output.findings.length,
        sources: researchResult.output.sources.length,
        cost: researchResult.metadata.costUsd.toFixed(3),
      });

      // Exit early if research-only mode
      if (input.researchOnly) {
        return this.buildResearchOnlyOutput(input, researchResult.output, {
          startTime,
          agentsUsed,
          costBreakdown,
          totalTurns,
          allToolsUsed,
        });
      }

      // ========================================
      // STEP 2: Filter (unless skipped)
      // ========================================
      let filteredEvidence: FilterOutput;

      if (input.skipFilter) {
        this.deps.observability.log("info", `[Analyst] Step 2: Skipping Filter (passthrough)`);

        // Passthrough: convert ResearcherOutput to FilterOutput format
        filteredEvidence = this.passthroughFilter(researchResult.output);
      } else {
        this.deps.observability.log("info", `[Analyst] Step 2: Running Filter...`);

        const filterResult = await this.filter.run(
          {
            questionId: input.targetId ?? correlationId,
            subject: input.subject,
            rawResearch: researchResult.output,
            config: {
              profile: input.filterProfile ?? "default",
            },
            targetId: input.targetId,
          },
          { correlationId, systemName: "analyst", domain: this.options.domain }
        );

        if (!filterResult.success) {
          throw new Error(filterResult.error?.message ?? "Filter failed");
        }

        agentsUsed.push(this.filter.name);
        costBreakdown.filter = filterResult.metadata.costUsd;
        totalTurns += filterResult.metadata.turns;
        filterResult.metadata.toolsUsed.forEach((t) => allToolsUsed.add(t));

        filteredEvidence = filterResult.output;

        this.deps.observability.log("info", `[Analyst] Filter complete`, {
          findingsKept: filteredEvidence.findings.length,
          findingsDropped: filteredEvidence.meta.droppedFindingsCount,
          sourcesKept: filteredEvidence.sources.length,
          sourcesDropped: filteredEvidence.meta.droppedSourcesCount,
          rulesUsed: filteredEvidence.meta.rulesUsed.length,
          cost: filterResult.metadata.costUsd.toFixed(3),
        });
      }

      // ========================================
      // STEP 3: Forecaster
      // ========================================
      this.deps.observability.log("info", `[Analyst] Step 3: Running Forecaster...`);

      // Convert FilterOutput back to ResearcherOutput format for forecaster
      const evidenceForForecaster: ResearcherOutput = {
        summary: filteredEvidence.summary,
        findings: filteredEvidence.findings,
        timeline: filteredEvidence.timeline,
        openQuestions: filteredEvidence.openQuestions,
        sources: filteredEvidence.sources,
      };

      const forecastResult = await this.forecaster.run(
        {
          question: input.subject,
          evidence: evidenceForForecaster,
          market: input.market,
          baseRates: input.baseRates,
          budget: input.budget,
          resolutionDate: input.resolutionDate,
          targetId: input.targetId,
        },
        { correlationId, systemName: "analyst", domain: this.options.domain }
      );

      if (!forecastResult.success) {
        throw new Error(forecastResult.error?.message ?? "Forecasting failed");
      }

      agentsUsed.push(this.forecaster.name);
      costBreakdown.forecaster = forecastResult.metadata.costUsd;
      totalTurns += forecastResult.metadata.turns;
      forecastResult.metadata.toolsUsed.forEach((t) => allToolsUsed.add(t));

      if (forecastResult.output.mode === "forecast") {
        this.deps.observability.log("info", `[Analyst] Forecaster complete`, {
          probability: forecastResult.output.forecast.probability,
          confidence: forecastResult.output.forecast.confidence,
          cost: forecastResult.metadata.costUsd.toFixed(3),
        });
      } else {
        this.deps.observability.log("info", `[Analyst] Forecaster requests more research`, {
          question: forecastResult.output.request.question,
        });
      }

      // ========================================
      // BUILD OUTPUT
      // ========================================
      const totalCost =
        costBreakdown.researcher + costBreakdown.filter + costBreakdown.forecaster;

      const output: AnalystPipelineOutput = {
        targetId: input.targetId,
        subject: input.subject,
        research: researchResult.output,
        filtered: filteredEvidence,
        forecast: forecastResult.output,
        metadata: {
          systemVersion: "2.0.0",
          agentsUsed,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          costUsd: totalCost,
          toolsUsed: Array.from(allToolsUsed),
          turns: totalTurns,
          costBreakdown,
        },
      };

      // Save output if targetId provided
      if (input.targetId) {
        await this.deps.store.write(`analyst/${input.targetId}/pipeline-output`, output);
      }

      this.deps.observability.log("info", `[Analyst] Pipeline complete`, {
        durationMs: output.metadata.durationMs,
        totalCost: totalCost.toFixed(3),
        costBreakdown: {
          researcher: costBreakdown.researcher.toFixed(3),
          filter: costBreakdown.filter.toFixed(3),
          forecaster: costBreakdown.forecaster.toFixed(3),
        },
        agentsUsed,
      });

      return output;
    } catch (error) {
      this.deps.observability.log("error", `[Analyst] Pipeline failed`, {
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Run research only (no filter or forecast)
   */
  async runResearch(input: AnalystInput): Promise<ResearcherOutput> {
    const result = await this.runPipeline({ ...input, researchOnly: true });
    return result.research;
  }

  /**
   * Run pipeline with automatic retries
   */
  async runPipelineWithRetry(
    input: AnalystPipelineInput,
    maxRetries: number = 2
  ): Promise<AnalystPipelineOutput> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.runPipeline(input);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          this.deps.observability.log("warn", `[Analyst] Retrying...`, {
            attempt,
            maxRetries,
            error: lastError.message,
          });

          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        }
      }
    }

    throw lastError;
  }

  /**
   * Run VOI loop: iteratively research and forecast until confident
   */
  async runWithVOI(
    input: AnalystPipelineInput,
    maxIterations: number = 3
  ): Promise<AnalystPipelineOutput> {
    let currentInput = { ...input };
    let lastOutput: AnalystPipelineOutput | undefined;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      this.deps.observability.log("info", `[Analyst] VOI iteration ${iteration}/${maxIterations}`);

      const output = await this.runPipeline(currentInput);
      lastOutput = output;

      // Check if forecaster is satisfied or requesting more research
      if (output.forecast.mode === "forecast") {
        this.deps.observability.log("info", `[Analyst] VOI complete - forecast produced`, {
          probability: output.forecast.forecast.probability,
        });
        return output;
      }

      // Forecaster wants more research
      if (iteration < maxIterations) {
        const request = output.forecast.request;
        this.deps.observability.log("info", `[Analyst] VOI - additional research requested`, {
          question: request.question,
          expectedImpact: request.expectedImpact,
        });

        // Update input with the new research question
        currentInput = {
          ...currentInput,
          subject: request.question,
          focus: request.suggestedFocus,
          budget: currentInput.budget
            ? {
                remainingUsd: currentInput.budget.remainingUsd * 0.5,
                maxResearchCalls: currentInput.budget.maxResearchCalls - 1,
              }
            : undefined,
        };
      }
    }

    this.deps.observability.log("warn", `[Analyst] VOI max iterations reached`);
    return lastOutput!;
  }

  /**
   * Get system info
   */
  getInfo(): { name: string; version: string; agents: string[]; modes: string[] } {
    return {
      name: "analyst",
      version: "3.0.0",
      agents: [this.researcher.name, this.filter.name, this.forecaster.name],
      modes: ["pipeline", "orchestrator"],
    };
  }

  // ============================================
  // ORCHESTRATOR MODE
  // ============================================

  /**
   * Run in orchestrator mode: Forecaster drives the entire pipeline
   *
   * Flow:
   * 1. DECOMPOSE: Forecaster analyzes question, crafts research questions
   * 2. RESEARCH: Run Researcher+Filter for each question
   * 3. ANALYZE: Forecaster checks if evidence is sufficient
   * 4. Loop back to step 2 if gaps exist
   * 5. FORECAST: Forecaster produces final probability
   */
  async runOrchestrator(input: OrchestratorInput): Promise<OrchestratorOutput> {
    const startTime = Date.now();
    const correlationId = crypto.randomUUID();

    this.deps.observability.log("info", `[Analyst] Starting orchestrator mode`, {
      question: input.question.slice(0, 100),
      source: input.source,
      maxIterations: input.budget?.maxResearchIterations ?? 3,
    });

    // Track metrics
    const costBreakdown = {
      decompose: 0,
      research: 0,
      filter: 0,
      analyze: 0,
      forecast: 0,
    };

    const allQuestionsAsked: ResearchQuestion[] = [];
    const allEvidence: EvidencePackage[] = [];
    let researchIterations = 0;

    const maxIterations = input.budget?.maxResearchIterations ?? 3;
    let remainingBudget = input.budget?.totalUsd ?? 20;

    try {
      // ========================================
      // PHASE 1: DECOMPOSE
      // ========================================
      this.deps.observability.log("info", `[Analyst] Phase 1: DECOMPOSE`);

      const decomposeResult = await this.runDecomposePhase(input, correlationId);
      costBreakdown.decompose = decomposeResult.costUsd;
      remainingBudget -= decomposeResult.costUsd;

      if (!decomposeResult.success || !decomposeResult.output) {
        throw new Error(decomposeResult.error ?? "Decompose phase failed");
      }

      const decompose = decomposeResult.output;
      allQuestionsAsked.push(...decompose.questions);

      this.deps.observability.log("info", `[Analyst] DECOMPOSE complete`, {
        questionsGenerated: decompose.questions.length,
        preliminaryRange: decompose.initialAssessment.preliminaryRange,
      });

      // ========================================
      // RESEARCH LOOP
      // ========================================
      let readyToForecast = false;
      let pendingQuestions = [...decompose.questions];

      while (!readyToForecast && researchIterations < maxIterations) {
        researchIterations++;

        this.deps.observability.log("info", `[Analyst] Research iteration ${researchIterations}/${maxIterations}`, {
          questionsToAnswer: pendingQuestions.length,
        });

        // ========================================
        // PHASE 2: RESEARCH (for each question)
        // ========================================
        for (const question of pendingQuestions) {
          if (remainingBudget <= 0) {
            this.deps.observability.log("warn", `[Analyst] Budget exhausted, stopping research`);
            break;
          }

          this.deps.observability.log("info", `[Analyst] Researching: ${question.question.slice(0, 80)}...`);

          const evidencePackage = await this.runResearchForQuestion(
            question,
            input,
            correlationId
          );

          allEvidence.push(evidencePackage);
          costBreakdown.research += evidencePackage.meta.researchCostUsd;
          costBreakdown.filter += evidencePackage.meta.filterCostUsd;
          remainingBudget -= (evidencePackage.meta.researchCostUsd + evidencePackage.meta.filterCostUsd);

          this.deps.observability.log("info", `[Analyst] Research complete for ${question.id}`, {
            findings: evidencePackage.filteredResearch.findings.length,
            sources: evidencePackage.filteredResearch.sources.length,
          });
        }

        // ========================================
        // PHASE 3: ANALYZE
        // ========================================
        this.deps.observability.log("info", `[Analyst] Phase 3: ANALYZE`);

        const aggregatedEvidence = aggregateEvidence(allEvidence);

        const analyzeResult = await this.runAnalyzePhase(
          input,
          aggregatedEvidence,
          allQuestionsAsked,
          { remainingUsd: remainingBudget, researchIterationsLeft: maxIterations - researchIterations },
          correlationId
        );

        costBreakdown.analyze += analyzeResult.costUsd;
        remainingBudget -= analyzeResult.costUsd;

        if (!analyzeResult.success || !analyzeResult.output) {
          throw new Error(analyzeResult.error ?? "Analyze phase failed");
        }

        const analyze = analyzeResult.output;
        readyToForecast = analyze.readyToForecast;

        if (!readyToForecast && analyze.additionalQuestions) {
          pendingQuestions = analyze.additionalQuestions;
          allQuestionsAsked.push(...analyze.additionalQuestions);

          this.deps.observability.log("info", `[Analyst] ANALYZE: more research needed`, {
            gaps: analyze.evidenceAssessment.gaps.length,
            additionalQuestions: analyze.additionalQuestions.length,
          });
        } else {
          this.deps.observability.log("info", `[Analyst] ANALYZE: ready to forecast`, {
            evidenceQuality: analyze.evidenceAssessment.quality,
          });
        }
      }

      // ========================================
      // PHASE 4: FORECAST
      // ========================================
      this.deps.observability.log("info", `[Analyst] Phase 4: FORECAST`);

      const aggregatedEvidence = aggregateEvidence(allEvidence);

      const forecastResult = await this.runForecastPhase(
        input,
        aggregatedEvidence,
        correlationId
      );

      costBreakdown.forecast = forecastResult.costUsd;

      if (!forecastResult.success || !forecastResult.output) {
        throw new Error(forecastResult.error ?? "Forecast phase failed");
      }

      // ========================================
      // BUILD OUTPUT
      // ========================================
      const totalCost = Object.values(costBreakdown).reduce((a, b) => a + b, 0);

      const output: OrchestratorOutput = {
        targetId: input.targetId,
        question: input.question,
        forecast: forecastResult.output,
        evidence: allEvidence,
        aggregatedEvidence,
        questionsAsked: allQuestionsAsked,
        metadata: {
          systemVersion: "3.0.0",
          mode: "orchestrator",
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          costUsd: totalCost,
          researchIterations,
          questionsAnswered: allEvidence.length,
          costBreakdown,
        },
      };

      // Save output if targetId provided
      if (input.targetId) {
        await this.deps.store.write(`analyst/${input.targetId}/orchestrator-output`, output);
      }

      this.deps.observability.log("info", `[Analyst] Orchestrator complete`, {
        durationMs: output.metadata.durationMs,
        totalCost: totalCost.toFixed(3),
        researchIterations,
        questionsAnswered: allEvidence.length,
        forecastMode: forecastResult.output.mode,
      });

      return output;
    } catch (error) {
      this.deps.observability.log("error", `[Analyst] Orchestrator failed`, {
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  // ============================================
  // ORCHESTRATOR PHASE HELPERS
  // ============================================

  /**
   * Run DECOMPOSE phase
   */
  private async runDecomposePhase(
    input: OrchestratorInput,
    correlationId: string
  ): Promise<{ success: boolean; output?: DecomposeOutput; error?: string; costUsd: number }> {
    // For now, use the forecaster agent with a decompose prompt
    // In future, this could be a dedicated decompose agent
    const outputKey = input.targetId
      ? `analyst/${input.targetId}/decompose`
      : `analyst/temp/${correlationId}/decompose`;

    // TODO: Implement actual decompose execution via executor
    // For now, return a placeholder that the forecaster agent would generate

    this.deps.observability.log("info", `[Analyst] DECOMPOSE phase - generating research questions`);

    // Placeholder: In production, this would call the executor with getDecomposePrompt
    // For now, return a basic decomposition
    const defaultQuestions: ResearchQuestion[] = [
      {
        id: "q1",
        topic: "current_status",
        question: `What is the current status of: ${input.question}`,
        priority: "critical",
        expectedSources: ["news", "official sources"],
        rationale: "Need current factual context",
      },
      {
        id: "q2",
        topic: "expert_opinion",
        question: `What do experts and analysts say about: ${input.question}`,
        priority: "important",
        expectedSources: ["analyst reports", "expert commentary"],
        rationale: "Expert opinion helps calibrate probability",
      },
      {
        id: "q3",
        topic: "historical",
        question: `What historical precedents exist for: ${input.question}`,
        priority: "supplementary",
        expectedSources: ["historical data", "academic sources"],
        rationale: "Base rates from similar past events",
      },
    ];

    const decompose: DecomposeOutput = {
      mode: "decompose",
      questions: defaultQuestions,
      initialAssessment: {
        uncertainties: ["Current situation unclear", "Expert consensus unknown"],
        preliminaryRange: { low: 0.3, high: 0.7 },
        keyFactors: ["Recent developments", "Expert consensus"],
      },
    };

    return {
      success: true,
      output: decompose,
      costUsd: 0.10, // Estimate for decompose
    };
  }

  /**
   * Run research for a single question
   */
  private async runResearchForQuestion(
    question: ResearchQuestion,
    input: OrchestratorInput,
    correlationId: string
  ): Promise<EvidencePackage> {
    const startTime = Date.now();

    // Run Researcher
    const researchResult = await this.researcher.run(
      {
        subject: question.question,
        targetId: input.targetId ? `${input.targetId}/${question.id}` : undefined,
        depth: question.priority === "critical" ? "deep" : "standard",
        focus: question.expectedSources,
      },
      { correlationId, systemName: "analyst", domain: this.options.domain }
    );

    if (!researchResult.success) {
      // Return empty evidence package on failure
      return {
        questionId: question.id,
        rawResearch: {
          summary: "Research failed",
          findings: [],
          timeline: [],
          openQuestions: [],
          sources: [],
        },
        filteredResearch: {
          summary: "Research failed",
          findings: [],
          timeline: [],
          openQuestions: [],
          sources: [],
          meta: {
            droppedFindingsCount: 0,
            droppedSourcesCount: 0,
            droppedTimelineEventsCount: 0,
            droppedOpenQuestionsCount: 0,
            rulesUsed: [],
          },
        },
        meta: {
          researchCostUsd: researchResult.metadata.costUsd,
          filterCostUsd: 0,
          durationMs: Date.now() - startTime,
          totalSources: 0,
          totalFindings: 0,
        },
      };
    }

    // Run Filter
    const filterResult = await this.filter.run(
      {
        questionId: question.id,
        subject: question.question,
        rawResearch: researchResult.output,
        config: { profile: input.filterProfile ?? "default" },
        targetId: input.targetId ? `${input.targetId}/${question.id}` : undefined,
      },
      { correlationId, systemName: "analyst", domain: this.options.domain }
    );

    const filteredOutput = filterResult.success
      ? filterResult.output
      : this.passthroughFilter(researchResult.output);

    return {
      questionId: question.id,
      rawResearch: researchResult.output,
      filteredResearch: filteredOutput,
      meta: {
        researchCostUsd: researchResult.metadata.costUsd,
        filterCostUsd: filterResult.metadata.costUsd,
        durationMs: Date.now() - startTime,
        totalSources: filteredOutput.sources.length,
        totalFindings: filteredOutput.findings.length,
      },
    };
  }

  /**
   * Run ANALYZE phase
   */
  private async runAnalyzePhase(
    input: OrchestratorInput,
    aggregatedEvidence: AggregatedEvidence,
    questionsAsked: ResearchQuestion[],
    budget: { remainingUsd: number; researchIterationsLeft: number },
    correlationId: string
  ): Promise<{ success: boolean; output?: AnalyzeOutput; error?: string; costUsd: number }> {
    // TODO: Implement actual analyze execution via executor
    // For now, return a basic analysis based on evidence quality

    const hasGoodEvidence =
      aggregatedEvidence.findings.length >= 3 &&
      aggregatedEvidence.sources.length >= 5;

    const hasCriticalGaps =
      aggregatedEvidence.findings.length < 2 ||
      aggregatedEvidence.sources.length < 3;

    if (hasCriticalGaps && budget.researchIterationsLeft > 0) {
      // Need more research
      const analyze: AnalyzeOutput = {
        mode: "analyze",
        evidenceAssessment: {
          sufficient: false,
          quality: "low",
          gaps: [
            {
              topic: "insufficient_evidence",
              description: "Not enough findings or sources to make a confident forecast",
              importance: "critical",
            },
          ],
          aggregatedSummary: aggregatedEvidence.summary,
        },
        additionalQuestions: [
          {
            id: `q_add_${questionsAsked.length + 1}`,
            topic: "additional_context",
            question: `What additional recent information exists about: ${input.question}`,
            priority: "critical",
            rationale: "Need more evidence to make a confident forecast",
          },
        ],
        readyToForecast: false,
      };

      return { success: true, output: analyze, costUsd: 0.05 };
    }

    // Ready to forecast
    const analyze: AnalyzeOutput = {
      mode: "analyze",
      evidenceAssessment: {
        sufficient: true,
        quality: hasGoodEvidence ? "high" : "medium",
        gaps: [],
        aggregatedSummary: aggregatedEvidence.summary,
      },
      readyToForecast: true,
    };

    return { success: true, output: analyze, costUsd: 0.05 };
  }

  /**
   * Run FORECAST phase
   */
  private async runForecastPhase(
    input: OrchestratorInput,
    aggregatedEvidence: AggregatedEvidence,
    correlationId: string
  ): Promise<{ success: boolean; output?: ForecasterOutput; error?: string; costUsd: number }> {
    // Convert aggregated evidence to ResearcherOutput format for forecaster
    const evidenceForForecaster: ResearcherOutput = {
      summary: aggregatedEvidence.summary,
      findings: aggregatedEvidence.findings,
      timeline: aggregatedEvidence.timeline,
      openQuestions: aggregatedEvidence.openQuestions,
      sources: aggregatedEvidence.sources,
    };

    const forecastResult = await this.forecaster.run(
      {
        question: input.question,
        evidence: evidenceForForecaster,
        market: input.market,
        baseRates: input.baseRates,
        resolutionDate: input.resolutionDate,
        targetId: input.targetId,
      },
      { correlationId, systemName: "analyst", domain: this.options.domain }
    );

    return {
      success: forecastResult.success,
      output: forecastResult.success ? forecastResult.output : undefined,
      error: forecastResult.error?.message,
      costUsd: forecastResult.metadata.costUsd,
    };
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  /**
   * Build output for research-only mode
   */
  private buildResearchOnlyOutput(
    input: AnalystPipelineInput,
    research: ResearcherOutput,
    metrics: {
      startTime: number;
      agentsUsed: string[];
      costBreakdown: { researcher: number; filter: number; forecaster: number };
      totalTurns: number;
      allToolsUsed: Set<string>;
    }
  ): AnalystPipelineOutput {
    const { startTime, agentsUsed, costBreakdown, totalTurns, allToolsUsed } = metrics;

    // Create passthrough filter output
    const filtered = this.passthroughFilter(research);

    // Create placeholder forecast
    const forecast: ForecasterOutput = {
      mode: "requestResearch",
      request: {
        question: "Forecasting skipped (research-only mode)",
        reason: "User requested research only",
        expectedImpact: "low",
      },
    };

    return {
      targetId: input.targetId,
      subject: input.subject,
      research,
      filtered,
      forecast,
      metadata: {
        systemVersion: "2.0.0",
        agentsUsed,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        costUsd: costBreakdown.researcher,
        toolsUsed: Array.from(allToolsUsed),
        turns: totalTurns,
        costBreakdown,
      },
    };
  }

  /**
   * Create passthrough filter output (no filtering)
   */
  private passthroughFilter(research: ResearcherOutput): FilterOutput {
    return {
      summary: research.summary,
      findings: research.findings.map((f) => ({
        topic: f.topic,
        claim: f.claim,
        status: f.status,
        supportingSources: f.supportingSources,
        opposingSources: f.opposingSources,
        notes: f.notes,
      })),
      timeline: research.timeline.map((t) => ({
        date: t.date,
        event: t.event,
        sources: t.sources,
      })),
      openQuestions: research.openQuestions.map((q) => ({
        question: q.question,
        reason: q.reason,
      })),
      sources: research.sources.map((s) => ({
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
}

/**
 * Create an Analyst system instance
 */
export function createAnalystSystem(
  options?: AnalystSystemOptions,
  deps?: Partial<AnalystDependencies>
): AnalystSystem {
  return new AnalystSystem(options, deps);
}
