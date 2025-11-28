/**
 * Forecaster Agent Types
 * Orchestrator agent that drives research and produces probability estimates
 *
 * Three Phases:
 * 1. DECOMPOSE: Parse input, craft research questions
 * 2. ANALYZE: Aggregate evidence, check for gaps
 * 3. FORECAST: Produce calibrated probability estimate
 */

import type { ResearcherOutput } from "../researcher/types.js";
import type { FilterOutput } from "../filter/types.js";

// ============================================
// RESEARCH QUESTION (crafted by Forecaster)
// ============================================

export interface ResearchQuestion {
  /**
   * Unique identifier for this question
   */
  id: string;

  /**
   * Topic category (e.g., "regulatory", "technical", "market")
   */
  topic: string;

  /**
   * The specific research question for the Researcher agent
   */
  question: string;

  /**
   * How important is this question for the forecast
   */
  priority: "critical" | "important" | "supplementary";

  /**
   * Hints for Researcher about where to look
   */
  expectedSources?: string[];

  /**
   * Why this question matters for the forecast
   */
  rationale: string;
}

// ============================================
// EVIDENCE PACKAGE (returned from research loop)
// ============================================

export interface EvidencePackage {
  /**
   * ID of the research question this answers
   */
  questionId: string;

  /**
   * Raw research output from Researcher
   */
  rawResearch: ResearcherOutput;

  /**
   * Cleaned evidence from Filter
   */
  filteredResearch: FilterOutput;

  /**
   * Metadata about this research run
   */
  meta: {
    researchCostUsd: number;
    filterCostUsd: number;
    durationMs: number;
    totalSources: number;
    totalFindings: number;
  };
}

// ============================================
// INPUT
// ============================================

/**
 * Input for orchestrator mode (starts the pipeline)
 */
export interface ForecasterOrchestratorInput {
  /**
   * The question to forecast (e.g., "Will the Fed cut rates in December 2025?")
   */
  question: string;

  /**
   * Source of this input
   */
  source: "scout" | "user" | "api" | "scheduled";

  /**
   * Context from Scout (if source is scout)
   */
  scoutContext?: {
    trader: {
      id: string;
      name: string;
      wallet: string;
    };
    trade: {
      side: "BUY" | "SELL";
      outcome: "YES" | "NO";
      usdValue: number;
      price: number;
    };
  };

  /**
   * Current market data (prices, volume, etc.)
   */
  market?: MarketData;

  /**
   * Historical base rates for similar questions
   */
  baseRates?: BaseRate[];

  /**
   * Budget constraints for the entire pipeline
   */
  budget?: {
    totalUsd: number;
    maxResearchIterations: number;
  };

  /**
   * Time until resolution
   */
  resolutionDate?: string;

  /**
   * Target ID for data storage
   */
  targetId?: string;
}

/**
 * Input for analyze/forecast phase (already has evidence)
 */
export interface ForecasterAnalyzeInput {
  /**
   * The question to forecast
   */
  question: string;

  /**
   * Evidence packages from research loop
   */
  evidence: EvidencePackage[];

  /**
   * Current market data
   */
  market?: MarketData;

  /**
   * Historical base rates
   */
  baseRates?: BaseRate[];

  /**
   * Budget remaining
   */
  budget?: {
    remainingUsd: number;
    researchIterationsLeft: number;
  };

  /**
   * Resolution date
   */
  resolutionDate?: string;

  /**
   * Target ID
   */
  targetId?: string;
}

/**
 * Legacy input format (for backward compatibility)
 * @deprecated Use ForecasterOrchestratorInput or ForecasterAnalyzeInput
 */
export interface ForecasterInput {
  /**
   * The question to forecast (e.g., "Will the Fed cut rates in December 2025?")
   */
  question: string;

  /**
   * Evidence from Researcher (raw or cleaned by Filter)
   */
  evidence: ResearcherOutput;

  /**
   * Current market data (prices, volume, etc.)
   */
  market?: MarketData;

  /**
   * Historical base rates for similar questions
   */
  baseRates?: BaseRate[];

  /**
   * Budget constraints for VOI decisions
   */
  budget?: {
    remainingUsd: number;
    maxResearchCalls: number;
  };

  /**
   * Time until resolution
   */
  resolutionDate?: string;

  /**
   * Target ID for data storage
   */
  targetId?: string;
}

export interface MarketData {
  /**
   * Current YES price (0-1)
   */
  yesPrice: number;

  /**
   * Current NO price (0-1)
   */
  noPrice?: number;

  /**
   * 24h volume in USD
   */
  volume24h?: number;

  /**
   * Total liquidity
   */
  liquidity?: number;

  /**
   * Price history
   */
  priceHistory?: Array<{
    timestamp: string;
    price: number;
  }>;

  /**
   * Source of market data
   */
  source: string;

  /**
   * When the market data was fetched
   */
  fetchedAt: string;
}

export interface BaseRate {
  /**
   * Description of the reference class
   */
  referenceClass: string;

  /**
   * Historical probability
   */
  probability: number;

  /**
   * Sample size / confidence
   */
  sampleSize?: number;

  /**
   * Source of base rate
   */
  source: string;

  /**
   * How applicable is this to the current question
   */
  applicability: "high" | "medium" | "low";
}

// ============================================
// OUTPUT
// ============================================

/**
 * Output from DECOMPOSE phase - list of research questions
 */
export interface DecomposeOutput {
  mode: "decompose";

  /**
   * Research questions crafted by Forecaster
   */
  questions: ResearchQuestion[];

  /**
   * Initial assessment before research
   */
  initialAssessment: {
    /**
     * Key uncertainties identified
     */
    uncertainties: string[];

    /**
     * Preliminary probability range (before research)
     */
    preliminaryRange: {
      low: number;
      high: number;
    };

    /**
     * Key factors that will drive the probability
     */
    keyFactors: string[];
  };
}

/**
 * Output from ANALYZE phase - either more research needed or ready to forecast
 */
export interface AnalyzeOutput {
  mode: "analyze";

  /**
   * Assessment of current evidence
   */
  evidenceAssessment: {
    /**
     * Is evidence sufficient to forecast?
     */
    sufficient: boolean;

    /**
     * Confidence in evidence quality
     */
    quality: "high" | "medium" | "low";

    /**
     * Information gaps identified
     */
    gaps: Array<{
      topic: string;
      description: string;
      importance: "critical" | "important" | "minor";
    }>;

    /**
     * Summary of aggregated evidence
     */
    aggregatedSummary: string;
  };

  /**
   * Additional research questions (if gaps found)
   */
  additionalQuestions?: ResearchQuestion[];

  /**
   * Ready to forecast? If true, proceed to FORECAST phase
   */
  readyToForecast: boolean;
}

/**
 * Final forecast output
 */
export interface ForecastOutput {
  mode: "forecast";
  forecast: Forecast;
}

/**
 * Legacy output types (for backward compatibility)
 */
export type ForecasterOutput = ForecastResult | ResearchRequest;

export interface ForecastResult {
  mode: "forecast";
  forecast: Forecast;
}

export interface ResearchRequest {
  mode: "requestResearch";
  request: {
    /**
     * Specific research question to answer
     */
    question: string;

    /**
     * Why this information matters for the forecast
     */
    reason: string;

    /**
     * Expected impact on probability if answered
     */
    expectedImpact: "high" | "medium" | "low";

    /**
     * Suggested focus areas for researcher
     */
    suggestedFocus?: string[];

    /**
     * Current best guess before additional research
     */
    preliminaryProbability?: number;
  };
}

/**
 * Combined output type for orchestrator mode
 */
export type ForecasterOrchestratorOutput =
  | DecomposeOutput
  | AnalyzeOutput
  | ForecastOutput;

/**
 * Structured reasoning from 7-step forecasting process
 */
export interface ForecastReasoning {
  /**
   * Step 1: Rephrased understanding of the question
   */
  questionRestatement: string;

  /**
   * Step 2: Arguments against the outcome (NO)
   */
  reasonsForNo: Array<{
    strength: "strong" | "moderate" | "weak";
    reason: string;
    evidence: string | null;
  }>;

  /**
   * Step 3: Arguments for the outcome (YES)
   */
  reasonsForYes: Array<{
    strength: "strong" | "moderate" | "weak";
    reason: string;
    evidence: string | null;
  }>;

  /**
   * Step 5: Initial probability before calibration
   */
  initialProbability: number;

  /**
   * Step 5: Reasoning for initial probability
   */
  initialReasoning: string;

  /**
   * Step 6: Calibration self-evaluation
   */
  calibrationAdjustment: {
    adjustedFrom: number;
    adjustedTo: number;
    reason: string;
  };
}

export interface Forecast {
  /**
   * The outcome being forecasted (for binary: "YES" or event description)
   */
  outcome: string;

  /**
   * Point estimate probability (0-1)
   */
  probability: number;

  /**
   * Lower bound of 90% credible interval
   */
  lowerBound: number;

  /**
   * Upper bound of 90% credible interval
   */
  upperBound: number;

  /**
   * Confidence in this forecast
   */
  confidence: "high" | "medium" | "low";

  /**
   * Structured reasoning from 7-step process
   */
  reasoning: ForecastReasoning;

  /**
   * Baselines considered and how they were weighted
   */
  baselinesUsed: Array<{
    source: string;
    value: number;
    weight: number;
    reasoning: string;
  }>;

  /**
   * How evidence shifted the probability from baseline
   */
  evidenceSummary: string;

  /**
   * Detailed reasoning for the probability estimate
   */
  probabilityReasoning: string;

  /**
   * Key assumptions underlying the forecast
   */
  assumptions: string[];

  /**
   * Scenario breakdown (optional, for complex questions)
   */
  scenarioBreakdown?: Array<{
    scenario: string;
    probability: number;
    reasoning: string;
  }>;

  /**
   * Recommendation for trading (if applicable)
   */
  recommendation?: TradeRecommendation;
}

export interface TradeRecommendation {
  /**
   * Suggested action
   */
  action: "buy_yes" | "buy_no" | "hold" | "avoid";

  /**
   * Conviction level
   */
  conviction: "high" | "medium" | "low";

  /**
   * Edge over market (myProb - marketPrice for YES)
   */
  edge: number;

  /**
   * Rationale for the recommendation
   */
  rationale: string;

  /**
   * Risk factors to consider
   */
  risks: string[];

  /**
   * Suggested position size (as fraction of bankroll, Kelly-based)
   */
  suggestedSize?: number;
}
