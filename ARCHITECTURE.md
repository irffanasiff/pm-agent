# Polymarket Research Agent - Architecture v1

## Design Principles

1. **Simple first** - Get data flowing, then refactor
2. **Bash + Client** - No Polymarket MCP, use existing proxy client + shell tools
3. **Parallel as primary** - Parallel MCP for deep research, WebSearch as fallback
4. **Per-market subagents** - Each market gets its own Claude session
5. **File-based state** - JSON files in `data/markets/{id}/`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                           CLI / Entry                            │
│  npm run research -- --topic "crypto" --depth standard          │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ResearchPipeline                            │
│  1. Discovery → 2. Research (parallel per market) → 3. Critique │
└──────────────────────────────┬──────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ DiscoveryAgent  │  │  ResearchAgent  │  │   CriticAgent   │
│                 │  │  (per market)   │  │                 │
│ Model: Haiku    │  │ Model: Sonnet   │  │ Model: Haiku    │
│                 │  │                 │  │                 │
│ Tools:          │  │ Tools:          │  │ Tools:          │
│ - Bash          │  │ - Bash          │  │ - Read          │
│ - Read          │  │ - Read/Write    │  │ - Grep          │
│                 │  │ - Parallel MCP  │  │                 │
│                 │  │ - WebSearch     │  │                 │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         AgentRunner                              │
│  - Wraps Claude Agent SDK query()                               │
│  - Handles retries, logging, cost tracking                      │
│  - Profile-based config (discovery/research/critic)             │
└──────────────────────────────┬──────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Polymarket     │  │   Parallel MCP  │  │   File System   │
│  (via proxy)    │  │  (deep research)│  │  (data/markets) │
│                 │  │                 │  │                 │
│  bash + curl    │  │  - task-mcp     │  │  - meta.json    │
│  + jq           │  │  - search-mcp   │  │  - research.json│
│                 │  │                 │  │  - eval.json    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Directory Structure (v1)

```
pm-agent/
├── src/
│   ├── index.ts                 # CLI entry point
│   │
│   ├── core/                    # Core infrastructure
│   │   ├── config.ts            # Configuration from env
│   │   ├── logger.ts            # Simple structured logging
│   │   ├── errors.ts            # Error types
│   │   └── agent-runner.ts      # SDK wrapper with profiles
│   │
│   ├── tools/                   # Tool setup
│   │   ├── polymarket/
│   │   │   ├── client.ts        # Refactored from polymarket-client.ts
│   │   │   ├── types.ts         # API response types
│   │   │   └── scripts.ts       # Bash script generators
│   │   └── parallel/
│   │       └── mcp-config.ts    # Parallel MCP server config
│   │
│   ├── agents/                  # Agent implementations
│   │   ├── discovery.ts         # Find markets
│   │   ├── research.ts          # Research per market
│   │   ├── critic.ts            # Evaluate research
│   │   └── prompts.ts           # System prompts
│   │
│   ├── pipeline/                # Orchestration
│   │   └── research-pipeline.ts # End-to-end flow
│   │
│   └── schemas/                 # Output types
│       ├── market.ts            # Market data types
│       ├── research.ts          # Research output schema
│       └── evaluation.ts        # Critic output schema
│
├── scripts/                     # Bash helpers for agent
│   ├── pm-list-markets.sh       # List markets via proxy
│   ├── pm-get-market.sh         # Get single market
│   └── pm-get-orderbook.sh      # Get orderbook
│
├── data/                        # Per-market data
│   └── markets/
│       └── {marketId}/
│           ├── meta.json        # Market metadata
│           ├── orderbook.json   # Current orderbook
│           ├── research.json    # Structured research
│           ├── research.md      # Human-readable
│           └── evaluation.json  # Critic output
│
├── proxy/                       # Cloudflare Worker (existing)
├── .env
├── package.json
└── tsconfig.json
```

---

## JSON Schemas

### 1. `meta.json` - Market Metadata

```typescript
interface MarketMeta {
  // Identity
  id: string;
  slug: string;
  question: string;
  description: string;
  category: string;
  tags: string[];

  // Status
  active: boolean;
  closed: boolean;
  resolved: boolean;
  resolutionSource: string;

  // Timing
  createdAt: string;      // ISO date
  endDate: string;        // ISO date
  resolvedAt?: string;

  // Market data (snapshot)
  volume: number;         // Total volume USD
  volume24h: number;      // 24h volume
  liquidity: number;      // Current liquidity

  // Prices
  outcomeYes: {
    tokenId: string;
    price: number;        // 0-1
    lastUpdated: string;
  };
  outcomeNo: {
    tokenId: string;
    price: number;
    lastUpdated: string;
  };

  // Metadata
  fetchedAt: string;      // When we fetched this
  source: "gamma" | "clob";
}
```

### 2. `research.json` - Research Output

```typescript
interface ResearchOutput {
  // Identity
  marketId: string;
  question: string;
  researchedAt: string;
  depth: "quick" | "standard" | "deep";

  // Market snapshot at research time
  snapshot: {
    priceYes: number;
    priceNo: number;
    volume: number;
    liquidity: number;
    daysToResolution: number;
  };

  // Core analysis
  summary: string;                    // 2-3 sentence summary

  keyDrivers: {
    driver: string;
    impact: "high" | "medium" | "low";
    direction: "yes" | "no" | "neutral";
  }[];

  arguments: {
    forYes: {
      point: string;
      confidence: "high" | "medium" | "low";
      source?: string;
    }[];
    forNo: {
      point: string;
      confidence: "high" | "medium" | "low";
      source?: string;
    }[];
  };

  // Risk assessment
  risks: {
    type: "resolution_ambiguity" | "low_liquidity" | "regulatory" |
          "information_asymmetry" | "timing" | "other";
    description: string;
    severity: "high" | "medium" | "low";
  }[];

  // Resolution analysis
  resolution: {
    criteria: string;           // How it will be resolved
    source: string;             // Who resolves it
    ambiguityLevel: "low" | "medium" | "high";
    concerns: string[];
  };

  // Probability assessment
  assessment: {
    impliedProbYes: number;     // From market price
    researcherEstimate?: number; // Our estimate (optional)
    divergence?: number;         // Difference
    reasoning?: string;
  };

  // Sources
  sources: {
    url: string;
    title: string;
    type: "news" | "official" | "analysis" | "data" | "social";
    retrievedAt: string;
    relevance: "high" | "medium" | "low";
    keyQuote?: string;
  }[];

  // Metadata
  metadata: {
    model: string;
    tokens: { input: number; output: number };
    cost: number;
    duration: number;
    toolsUsed: string[];
  };
}
```

### 3. `evaluation.json` - Critic Output

```typescript
interface EvaluationOutput {
  marketId: string;
  evaluatedAt: string;
  researchVersion: string;      // Hash or timestamp of research.json

  // Scores (0-10)
  scores: {
    overall: number;
    dataCompleteness: number;   // Is market data present and current?
    analysisDepth: number;      // How thorough is the analysis?
    sourceQuality: number;      // Are sources credible and recent?
    riskIdentification: number; // Are risks properly identified?
    logicalConsistency: number; // Does the reasoning hold together?
  };

  // Issues found
  flags: {
    type: "missing_data" | "stale_data" | "weak_sources" |
          "logical_gap" | "missing_risk" | "bias" | "resolution_unclear";
    severity: "critical" | "major" | "minor";
    description: string;
    location?: string;          // Which section has the issue
  }[];

  // Recommendations
  suggestions: {
    action: "verify" | "research_more" | "update_data" | "reconsider";
    description: string;
    priority: "high" | "medium" | "low";
  }[];

  // Final verdict
  verdict: {
    decision: "accept" | "revise" | "reject";
    confidence: "high" | "medium" | "low";
    summary: string;
  };

  // Metadata
  metadata: {
    model: string;
    tokens: { input: number; output: number };
    cost: number;
    duration: number;
  };
}
```

---

## Agent Profiles

### AgentRunner Config

```typescript
interface AgentProfile {
  model: "haiku" | "sonnet" | "opus";
  maxTurns: number;
  maxBudgetUsd: number;
  tools: string[];
  mcpServers?: Record<string, MCPServerConfig>;
  retries: number;
  backoffMs: number;
}

const PROFILES: Record<string, AgentProfile> = {
  discovery: {
    model: "haiku",
    maxTurns: 5,
    maxBudgetUsd: 0.05,
    tools: ["Bash", "Read", "Grep"],
    retries: 2,
    backoffMs: 1000,
  },

  research: {
    model: "sonnet",
    maxTurns: 15,
    maxBudgetUsd: 0.25,
    tools: ["Bash", "Read", "Write", "WebSearch"],
    mcpServers: {
      "parallel-task": {
        type: "sse",
        url: "https://task-mcp.parallel.ai/mcp",
        headers: { Authorization: "Bearer ${PARALLEL_API_KEY}" },
      },
      "parallel-search": {
        type: "sse",
        url: "https://search-mcp.parallel.ai/mcp",
        headers: { Authorization: "Bearer ${PARALLEL_API_KEY}" },
      },
    },
    retries: 3,
    backoffMs: 2000,
  },

  critic: {
    model: "haiku",
    maxTurns: 5,
    maxBudgetUsd: 0.05,
    tools: ["Read", "Grep"],
    retries: 2,
    backoffMs: 1000,
  },
};
```

---

## Polymarket Integration (Bash + Client)

### Option A: Agent calls bash scripts

```bash
# scripts/pm-list-markets.sh
#!/bin/bash
PROXY="$POLYMARKET_PROXY_URL"
SECRET="$PROXY_SECRET"
LIMIT="${1:-10}"

curl -s "$PROXY/proxy/$(urlencode "https://gamma-api.polymarket.com/markets?limit=$LIMIT&active=true")" \
  -H "X-Proxy-Secret: $SECRET" | jq '.'
```

Agent uses:
```
Bash: ./scripts/pm-list-markets.sh 20 | jq '.[] | {id, question, volume}'
```

### Option B: Pre-fetch in orchestrator

```typescript
// In ResearchPipeline, before spawning ResearchAgent:
async function prepareMarketData(marketId: string) {
  const meta = await polymarketClient.getMarket(marketId);
  const orderbook = await polymarketClient.getOrderbook(marketId);

  await fs.writeJson(`data/markets/${marketId}/meta.json`, meta);
  await fs.writeJson(`data/markets/${marketId}/orderbook.json`, orderbook);
}

// Then ResearchAgent just reads the files
```

**Recommendation:** Use Option B for v1 - cleaner separation, agent focuses on research.

---

## Parallel MCP Integration

### In ResearchAgent prompt:

```typescript
const RESEARCH_SYSTEM_PROMPT = `
You are a Polymarket research analyst.

## Your Tools

### Polymarket Data (local files)
- Market metadata: data/markets/{id}/meta.json
- Orderbook: data/markets/{id}/orderbook.json
Use Read tool to access these.

### Deep Research (Parallel MCP)
For comprehensive research with citations:
- Use parallel-task-mcp for multi-step research tasks
- Use parallel-search-mcp for targeted web searches
These return structured results with sources and confidence scores.

### Quick Lookups (WebSearch)
For simple fact-checking or recent news, use WebSearch.

## Output
Write your findings to:
- data/markets/{id}/research.json (structured)
- data/markets/{id}/research.md (readable)

Follow the exact schema provided.
`;
```

---

## Pipeline Flow

```typescript
class ResearchPipeline {
  async run(config: PipelineConfig): Promise<PipelineResult> {
    const correlationId = crypto.randomUUID();
    logger.info("Pipeline started", { correlationId, config });

    // Phase 1: Discovery
    logger.info("Phase 1: Discovery", { correlationId });
    const discovery = await this.discoveryAgent.run({
      topic: config.topic,
      maxResults: config.maxMarkets,
    });

    // Phase 2: Prepare market data (orchestrator fetches, not agent)
    logger.info("Phase 2: Fetching market data", { correlationId });
    await Promise.all(
      discovery.markets.map(m => this.prepareMarketData(m.id))
    );

    // Phase 3: Research (parallel, one subagent per market)
    logger.info("Phase 3: Research", { correlationId, count: discovery.markets.length });
    const researchResults = await Promise.all(
      discovery.markets.map(m =>
        this.researchAgent.run({
          marketId: m.id,
          depth: config.researchDepth,
        })
      )
    );

    // Phase 4: Critique (parallel)
    logger.info("Phase 4: Evaluation", { correlationId });
    const evaluations = await Promise.all(
      researchResults.map(r =>
        this.criticAgent.run({ marketId: r.marketId })
      )
    );

    // Phase 5: Aggregate
    const approved = evaluations.filter(e => e.verdict.decision === "accept");

    const result: PipelineResult = {
      correlationId,
      discovery,
      research: researchResults,
      evaluations,
      summary: {
        marketsFound: discovery.markets.length,
        marketsResearched: researchResults.length,
        marketsApproved: approved.length,
        totalCost: this.calculateTotalCost(researchResults, evaluations),
        duration: Date.now() - startTime,
      },
    };

    logger.info("Pipeline complete", { correlationId, summary: result.summary });
    return result;
  }
}
```

---

## Implementation Order

### Phase 1: Core (This session)
```
src/core/config.ts       - Load from env, validate
src/core/logger.ts       - console + file logging
src/core/errors.ts       - AgentError, PolymarketError, etc.
src/core/agent-runner.ts - SDK wrapper with profiles
```

### Phase 2: Polymarket Tools
```
src/tools/polymarket/types.ts   - Zod schemas for API
src/tools/polymarket/client.ts  - Refactor existing
scripts/pm-*.sh                 - Bash helpers
```

### Phase 3: Schemas + Data
```
src/schemas/market.ts
src/schemas/research.ts
src/schemas/evaluation.ts
data/markets/.gitkeep
```

### Phase 4: Agents
```
src/agents/prompts.ts
src/agents/discovery.ts
src/agents/research.ts
src/agents/critic.ts
```

### Phase 5: Pipeline + CLI
```
src/pipeline/research-pipeline.ts
src/index.ts (CLI)
```

---

## Cost Estimates (v1)

| Phase | Agent | Model | Est. Cost |
|-------|-------|-------|-----------|
| Discovery | 1x | Haiku | $0.02 |
| Research | 5x markets | Sonnet | $0.50 |
| Critique | 5x markets | Haiku | $0.10 |
| **Total** | | | **~$0.62** |

For 5 markets at "standard" depth.

---

## What's Deferred to v2

- Custom Polymarket MCP server
- Database storage (SQLite/Postgres)
- Web API / dashboard
- Scheduled refresh
- Trading integration
- Advanced caching
