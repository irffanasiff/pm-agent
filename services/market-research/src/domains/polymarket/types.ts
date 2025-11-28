/**
 * Polymarket Domain Types
 * Domain-specific types for Polymarket prediction markets
 */

// ============================================
// MARKET DATA
// ============================================

/**
 * Normalized market data
 */
export interface PolymarketData {
  /** Market ID */
  id: string;

  /** URL slug */
  slug: string;

  /** Market question */
  question: string;

  /** Description */
  description?: string;

  /** Category */
  category: string;

  /** Outcomes */
  outcomes: {
    yes: OutcomeData;
    no: OutcomeData;
  };

  /** Market metrics */
  volume: number;
  liquidity: number;

  /** Dates */
  endDate: string;
  createdAt: string;

  /** Status */
  active: boolean;
  closed: boolean;

  /** Resolution */
  resolutionSource?: string;
}

export interface OutcomeData {
  price: number;
  token?: string;
}

// ============================================
// ANALYST CONTEXT
// ============================================

/**
 * Polymarket-specific context for Analyst system
 */
export interface PolymarketAnalystContext {
  /** Market data */
  market: PolymarketData;

  /** Current prices */
  prices: {
    yes: number;
    no: number;
  };

  /** Orderbook snapshot (optional) */
  orderbook?: {
    bids: Array<{ price: number; size: number }>;
    asks: Array<{ price: number; size: number }>;
  };
}

// ============================================
// TRADING ASSESSMENT
// ============================================

/**
 * Polymarket-specific trading assessment
 */
export interface PolymarketTradingAssessment {
  /** Trading recommendation */
  recommendation: "BUY_YES" | "BUY_NO" | "HOLD";

  /** Conviction level */
  conviction: "high" | "medium" | "low";

  /** Predicted outcome */
  predictedOutcome: "YES" | "NO" | "UNCERTAIN";

  /** Reasoning */
  outcomeReasoning: string;

  /** Profit/loss calculations */
  profitIfCorrect: number;
  lossIfWrong: number;
  expectedValue: number;

  /** Position sizing */
  kellyFraction: number;
  suggestedSize: "large" | "medium" | "small" | "skip";

  /** One-liner */
  tradeSummary: string;
}
