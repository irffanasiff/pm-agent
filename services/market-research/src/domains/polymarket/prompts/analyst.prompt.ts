/**
 * Polymarket Analyst Prompt Enhancement
 * Domain-specific additions for Polymarket analysis
 */

import type { PolymarketData } from "../types.js";

/**
 * Get Polymarket-specific context to add to analyst prompt
 */
export function getPolymarketContext(market: PolymarketData): string {
  const daysToResolution = Math.max(
    0,
    Math.ceil((new Date(market.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );

  return `
## Polymarket Context

This is a prediction market on Polymarket.

**Market Details:**
- Question: ${market.question}
- Category: ${market.category}
- Current YES price: ${(market.outcomes.yes.price * 100).toFixed(1)}%
- Current NO price: ${(market.outcomes.no.price * 100).toFixed(1)}%
- Volume: $${market.volume.toLocaleString()}
- Liquidity: $${market.liquidity.toLocaleString()}
- Days to resolution: ${daysToResolution}
- Resolution source: ${market.resolutionSource ?? "Polymarket"}

**Trading Analysis Required:**
In addition to standard research, provide trading analysis:

1. **Predict the Outcome**: Will this resolve YES or NO?
2. **Calculate Edge**: Compare your probability estimate to market price
3. **Recommend Action**: BUY_YES, BUY_NO, or HOLD
4. **Size the Position**: large/medium/small/skip based on edge and conviction

Include this in your assessment.recommendation:
\`\`\`json
{
  "recommendation": {
    "action": "BUY_YES|BUY_NO|HOLD",
    "conviction": "high|medium|low",
    "rationale": "Why this trade",
    "caveats": ["Risks to consider"]
  },
  "prediction": {
    "outcome": "YES|NO",
    "probability": 0.75,
    "timeframe": "When it resolves",
    "assumptions": ["Key assumptions"]
  }
}
\`\`\`

**Key Question**: Given the current price of ${(market.outcomes.yes.price * 100).toFixed(1)}% for YES, is there an edge?
`;
}

/**
 * Get trading-focused additions to output schema
 */
export function getPolymarketOutputAdditions(): string {
  return `
Additionally, for Polymarket markets, include a "trading" section:

"trading": {
  "recommendation": "BUY_YES|BUY_NO|HOLD",
  "conviction": "high|medium|low",
  "predictedOutcome": "YES|NO|UNCERTAIN",
  "outcomeReasoning": "Why you predict this outcome",
  "profitIfCorrect": 0.35,
  "lossIfWrong": 0.65,
  "expectedValue": 0.05,
  "kellyFraction": 0.15,
  "suggestedSize": "small|medium|large|skip",
  "tradeSummary": "One sentence: Buy YES at 65% because..."
}
`;
}
