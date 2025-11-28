# Analyst System Architecture

## Overview

The Analyst system is a multi-agent pipeline for prediction market research and probability forecasting. It uses a **Forecaster-driven architecture** where the Forecaster agent acts as the orchestrator that drives research, filters evidence, and produces calibrated probability estimates.

## Input Sources

The Analyst system can receive input from multiple sources:

| Source | Description | Use Case |
|--------|-------------|----------|
| **Scout Agent** | Automated triggers from trader monitoring | "Whale bought $50k YES on market X" |
| **User** | Direct user queries | "What's the probability of X happening?" |
| **Scheduled** | Cron-based market monitoring | Daily re-analysis of tracked markets |
| **API** | External service requests | Integration with trading bots |

---

## System Architecture

```
                              ┌─────────────────────────────────────┐
                              │           INPUT SOURCES             │
                              │                                     │
                              │  Scout Agent  │  User  │  API/Cron  │
                              └───────────────┼───────┼─────────────┘
                                              │       │
                                              ▼       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              ANALYST SYSTEM                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    FORECASTER (Orchestrator)                             │ │
│  │                                                                          │ │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │ │
│  │  │   PHASE 1    │    │   PHASE 2    │    │   PHASE 3    │              │ │
│  │  │  DECOMPOSE   │───▶│   ANALYZE    │───▶│   FORECAST   │              │ │
│  │  │              │    │              │    │              │              │ │
│  │  │ - Parse input│    │ - Check gaps │    │ - Baselines  │              │ │
│  │  │ - Identify   │    │ - Aggregate  │    │ - Evidence   │              │ │
│  │  │   topics     │    │   evidence   │    │ - VOI check  │              │ │
│  │  │ - Craft      │    │ - Assess     │    │ - Synthesize │              │ │
│  │  │   questions  │    │   sufficiency│    │              │              │ │
│  │  └──────────────┘    └──────────────┘    └──────────────┘              │ │
│  │         │                   ▲                   │                       │ │
│  │         │                   │ (loop if gaps)    │                       │ │
│  │         ▼                   │                   ▼                       │ │
│  │  ┌──────────────────────────┴────────────────────────────────────────┐ │ │
│  │  │                    Research Questions[]                            │ │ │
│  │  └──────────────────────────┬────────────────────────────────────────┘ │ │
│  └─────────────────────────────┼────────────────────────────────────────────┘ │
│                                │                                               │
│                                ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                         RESEARCH LOOP                                    │ │
│  │                                                                          │ │
│  │   ┌────────────────┐              ┌────────────────┐                    │ │
│  │   │   RESEARCHER   │─────────────▶│     FILTER     │                    │ │
│  │   │                │              │                │                    │ │
│  │   │ - Web search   │              │ - Drop noise   │                    │ │
│  │   │ - Source eval  │              │ - Merge dupes  │                    │ │
│  │   │ - Timeline     │              │ - Downgrade    │                    │ │
│  │   │ - Findings     │              │   uncertain    │                    │ │
│  │   └────────────────┘              └────────────────┘                    │ │
│  │          ▲                               │                              │ │
│  │          │                               │                              │ │
│  │          │ (per question)                │                              │ │
│  │          │                               ▼                              │ │
│  │   ┌──────┴───────────────────────────────────────────────────────────┐ │ │
│  │   │                    Filtered Evidence[]                            │ │ │
│  │   └──────────────────────────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                              ┌─────────────────────────────────────┐
                              │              OUTPUT                  │
                              │                                      │
                              │  Forecast {                          │
                              │    probability: 0.65,                │
                              │    confidence: "medium",             │
                              │    recommendation: {...}             │
                              │  }                                   │
                              └─────────────────────────────────────┘
```

---

## Agent Roles

### 1. Forecaster (Orchestrator)

The **brain** of the system. Drives the entire pipeline.

| Aspect | Description |
|--------|-------------|
| **Role** | Orchestrator, decision-maker, probability estimator |
| **Input** | Market question + optional context from Scout/User |
| **Output** | Calibrated probability OR research request |
| **Tools** | Write (for output) |
| **Model** | Sonnet |
| **Budget** | $1.00 per run |

#### Three Phases

**Phase 1: DECOMPOSE**
- Parse the input question
- Identify key entities and uncertainties
- Craft specific research questions for the Researcher
- Output: `ResearchQuestion[]`

**Phase 2: ANALYZE**
- Receive filtered evidence from all research questions
- Check for information gaps
- Assess evidence sufficiency
- If gaps: return to Phase 1 with new questions
- If sufficient: proceed to Phase 3

**Phase 3: FORECAST**
- Establish base rates (historical, domain, reference class)
- Weigh evidence against baselines
- Calculate probability with uncertainty bounds
- VOI check: is more research worth the cost?
- Output: `Forecast` or `ResearchRequest`

### 2. Researcher (Evidence Gatherer)

**Pure evidence gatherer**. No opinions, no probabilities.

| Aspect | Description |
|--------|-------------|
| **Role** | Evidence gatherer, fact finder |
| **Input** | Specific research question from Forecaster |
| **Output** | Neutral evidence package (findings, timeline, sources) |
| **Tools** | WebSearch, Read, Write |
| **Model** | Sonnet |
| **Budget** | $3.00 per run |

#### Key Constraints
- **NO probabilities** - never estimate likelihoods
- **NO recommendations** - never suggest actions
- **NO opinions** - present facts neutrally
- Focus on recency and source credibility
- Label claim status: `supported`, `contested`, `unclear`

### 3. Filter (Noise Clearer)

**Schema-preserving airlock** between Researcher and Forecaster.

| Aspect | Description |
|--------|-------------|
| **Role** | Noise reduction, quality control |
| **Input** | Raw research output |
| **Output** | Cleaned, compressed evidence |
| **Tools** | Write (for output) |
| **Model** | Sonnet |
| **Budget** | $0.30 per run |

#### Hard Constraints
- **Subset only**: can only DROP, MERGE, REORDER, DOWNGRADE
- **No new facts**: cannot add anything not in input
- **No status upgrades**: `unclear` → `supported` is FORBIDDEN
- **Frozen sources**: cannot modify source metadata

#### Filter Profiles

| Profile | Max Findings | Max Timeline | Max Sources | Max Questions |
|---------|--------------|--------------|-------------|---------------|
| `strict` | 8 | 10 | 15 | 3 |
| `default` | 15 | 20 | 30 | 5 |
| `loose` | 25 | 30 | 50 | 10 |

---

## Data Flow

### Input Types

```typescript
interface AnalystInput {
  // From Scout
  scoutAlert?: {
    trader: WatchedTrader;
    trade: DetectedTrade;
    marketContext: MarketData;
  };

  // From User
  question?: string;

  // Market context (optional)
  market?: {
    conditionId: string;
    question: string;
    currentPrice: number;
    volume: number;
    endDate: string;
  };

  // Configuration
  config?: {
    maxResearchIterations?: number;
    filterProfile?: "strict" | "default" | "loose";
    minConfidence?: "high" | "medium" | "low";
  };
}
```

### Research Question

```typescript
interface ResearchQuestion {
  id: string;
  topic: string;           // e.g., "regulatory_status"
  question: string;        // Specific question for Researcher
  priority: "critical" | "important" | "supplementary";
  expectedSources: string[]; // Hints for Researcher
}
```

### Evidence Package

```typescript
interface EvidencePackage {
  questionId: string;
  rawResearch: ResearcherOutput;  // From Researcher
  filteredResearch: FilterOutput; // From Filter
  meta: {
    researchCostUsd: number;
    filterCostUsd: number;
    totalSources: number;
    totalFindings: number;
  };
}
```

### Output Types

```typescript
// Success case
interface ForecastResult {
  mode: "forecast";
  forecast: {
    outcome: string;
    probability: number;      // 0.01-0.99
    lowerBound: number;
    upperBound: number;
    confidence: "high" | "medium" | "low";
    baselinesUsed: BaseRate[];
    probabilityReasoning: string;
    recommendation?: TradeRecommendation;
  };
  evidence: EvidencePackage[];
  meta: {
    totalCostUsd: number;
    researchIterations: number;
    questionsAnswered: number;
  };
}

// More research needed
interface ResearchRequest {
  mode: "requestResearch";
  request: {
    reason: string;
    questions: ResearchQuestion[];
    expectedVOI: number;
    currentEstimate: number;
    uncertainty: number;
  };
}
```

---

## Execution Flow

### Standard Flow

```
1. INPUT RECEIVED
   └─▶ Scout alert: "Trader X bought $50k YES on market Y"

2. FORECASTER: DECOMPOSE
   └─▶ Questions:
       - Q1: "What is the current regulatory status of Y?"
       - Q2: "What recent news mentions Y?"
       - Q3: "What do experts say about Y timeline?"

3. RESEARCH LOOP (parallel for each question)
   ├─▶ Researcher(Q1) ─▶ Filter ─▶ Evidence[1]
   ├─▶ Researcher(Q2) ─▶ Filter ─▶ Evidence[2]
   └─▶ Researcher(Q3) ─▶ Filter ─▶ Evidence[3]

4. FORECASTER: ANALYZE
   └─▶ Combine Evidence[1,2,3]
   └─▶ Check for gaps
   └─▶ Gap found: "No historical precedent data"

5. RESEARCH LOOP (additional)
   └─▶ Researcher(Q4) ─▶ Filter ─▶ Evidence[4]

6. FORECASTER: ANALYZE (round 2)
   └─▶ Combine Evidence[1,2,3,4]
   └─▶ Evidence sufficient

7. FORECASTER: FORECAST
   └─▶ Base rates: [historical: 0.3, domain: 0.5]
   └─▶ Evidence adjustment: +0.15
   └─▶ Final: 0.62 [0.45-0.78]
   └─▶ Recommendation: BUY at 0.55

8. OUTPUT
   └─▶ Return ForecastResult to Scout/User
```

### VOI Loop (Value of Information)

```
1. FORECASTER calculates:
   - Current estimate: 0.62
   - Uncertainty: ±0.16
   - Research cost: ~$3.50

2. VOI Analysis:
   - Expected value of perfect info: $X
   - Expected value of research: $Y
   - If Y > cost: continue research
   - If Y < cost: stop and forecast

3. Decision:
   - VOI = $2.00, Cost = $3.50 → STOP
   - Output current forecast with uncertainty
```

---

## Integration with Scout

When Scout detects a significant trade:

```typescript
// Scout triggers Analyst
scout.onAlert(async (alert) => {
  if (alert.trade.usdValue > 5000) {
    const result = await analystSystem.run({
      scoutAlert: {
        trader: alert.trader,
        trade: alert.trade,
        marketContext: await getMarketData(alert.trade.conditionId),
      },
      config: {
        maxResearchIterations: 3,
        filterProfile: "default",
      },
    });

    if (result.mode === "forecast") {
      // Use forecast for trading decision
      if (result.forecast.recommendation?.action === "buy") {
        await executeOrder(result.forecast.recommendation);
      }
    }
  }
});
```

---

## Cost Model

| Agent | Per Run | Typical Calls | Subtotal |
|-------|---------|---------------|----------|
| Forecaster | $1.00 | 1-2 | $1.00-$2.00 |
| Researcher | $3.00 | 2-4 | $6.00-$12.00 |
| Filter | $0.30 | 2-4 | $0.60-$1.20 |
| **Total** | | | **$7.60-$15.20** |

### Budget Controls

```typescript
const config = {
  forecaster: {
    maxBudgetUsd: 1.0,
    maxTurns: 15,
  },
  researcher: {
    maxBudgetUsd: 3.0,
    maxTurns: 40,
  },
  filter: {
    maxBudgetUsd: 0.3,
    maxTurns: 5,
  },
  system: {
    maxTotalBudgetUsd: 20.0,
    maxResearchIterations: 5,
  },
};
```

---

## Error Handling

### Agent Failures

```typescript
// Researcher timeout/failure
if (!researchResult.success) {
  // Option 1: Retry with backoff
  // Option 2: Continue with partial evidence
  // Option 3: Return low-confidence forecast
}

// Filter validation failure
if (subsetErrors.length > 0) {
  // Log warning but continue with raw research
  // Filter fallback: pass-through mode
}

// Forecaster budget exceeded
if (forecasterResult.error?.code === "BUDGET_EXCEEDED") {
  // Return partial forecast with uncertainty
  // Flag for human review
}
```

### Recovery Strategies

| Error Type | Strategy |
|------------|----------|
| Network timeout | Retry with exponential backoff |
| Rate limit | Queue and retry after cooldown |
| Invalid output | Use fallback/passthrough |
| Budget exceeded | Return partial result |
| All retries failed | Return error with context |

---

## Configuration

```typescript
// src/systems/analyst/config.ts

export interface AnalystConfig {
  // Agent budgets
  budgets: {
    forecaster: number;
    researcher: number;
    filter: number;
    total: number;
  };

  // Research limits
  research: {
    maxIterations: number;
    maxQuestionsPerIteration: number;
    parallelResearchers: number;
  };

  // Filter settings
  filter: {
    defaultProfile: "strict" | "default" | "loose";
    skipFilter: boolean;
  };

  // VOI settings
  voi: {
    minExpectedValue: number;
    maxResearchCost: number;
  };

  // Output
  output: {
    minConfidence: "high" | "medium" | "low";
    requireRecommendation: boolean;
  };
}
```

---

## File Structure

```
services/market-research/src/systems/analyst/
├── system.ts                    # Main orchestrator
├── config.ts                    # System configuration
├── types.ts                     # Shared types
│
├── agents/
│   ├── forecaster/
│   │   ├── index.ts
│   │   ├── agent.ts            # Forecaster implementation
│   │   ├── prompt.ts           # 3-phase prompt
│   │   ├── schema.ts           # Zod validation
│   │   └── types.ts            # Forecaster-specific types
│   │
│   ├── researcher/
│   │   ├── index.ts
│   │   ├── agent.ts            # Researcher implementation
│   │   ├── prompt.ts           # Evidence-gathering prompt
│   │   ├── schema.ts           # Output validation
│   │   └── types.ts            # Evidence types
│   │
│   └── filter/
│       ├── index.ts
│       ├── agent.ts            # Filter implementation
│       ├── prompt.ts           # Filtering rules
│       ├── schema.ts           # Subset validation
│       └── types.ts            # Filter profiles
│
└── utils/
    ├── evidence-aggregator.ts   # Combine multiple research results
    ├── voi-calculator.ts        # Value of Information logic
    └── cost-tracker.ts          # Budget monitoring
```

---

## Future Enhancements

### Planned
- [ ] Parallel research execution
- [ ] Evidence caching (avoid re-researching same topics)
- [ ] Calibration tracking (Brier score history)
- [ ] A/B testing different prompts
- [ ] Human-in-the-loop for low-confidence forecasts

### Considered
- [ ] Multi-market correlation analysis
- [ ] Trader reputation weighting
- [ ] Real-time evidence streaming
- [ ] Ensemble forecasting (multiple Forecaster runs)
