/**
 * Polymarket API Types
 * Zod schemas for validating API responses
 */

import { z } from "zod";

// ============ Gamma API Types (Public) ============

/**
 * Helper to parse string or number to number
 */
const stringOrNumber = z.union([z.string(), z.number()]).transform((val) =>
  typeof val === "string" ? parseFloat(val) || 0 : val
);

/**
 * Helper to parse string or array (Gamma returns comma-separated strings sometimes)
 */
const stringOrArray = z.union([
  z.array(z.string()),
  z.string().transform((s) => s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []),
]).optional();

/**
 * Market from Gamma API
 * Note: Gamma API is inconsistent - sometimes returns strings, sometimes numbers/arrays
 */
export const GammaMarketSchema = z.object({
  id: z.string(),
  question: z.string(),
  slug: z.string(),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  tags: z.union([z.array(z.string()), z.string(), z.null()]).optional().transform((val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    return val.split(",").map((x) => x.trim()).filter(Boolean);
  }),

  // Status
  active: z.boolean(),
  closed: z.boolean(),
  resolved: z.boolean().optional().nullable(),
  resolutionSource: z.string().optional().nullable(),

  // Timing
  createdAt: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  resolvedAt: z.string().optional().nullable(),

  // Market data (can be string or number)
  volume: stringOrNumber.optional().nullable().transform((v) => v ?? 0),
  volume24hr: stringOrNumber.optional().nullable().transform((v) => v ?? 0),
  liquidity: stringOrNumber.optional().nullable().transform((v) => v ?? 0),

  // Outcomes (Gamma format - can be array or comma-separated string)
  outcomes: stringOrArray,
  outcomePrices: stringOrArray,

  // CLOB token IDs for trading
  clobTokenIds: stringOrArray,
}).passthrough();

export type GammaMarket = z.infer<typeof GammaMarketSchema>;

/**
 * Gamma API response for list of markets
 */
export const GammaMarketsResponseSchema = z.array(GammaMarketSchema);

// ============ CLOB API Types (Trading) ============

/**
 * CLOB Market response
 * Note: CLOB API has many nullable fields
 */
export const ClobMarketSchema = z.object({
  condition_id: z.string(),
  question_id: z.string().optional().nullable(),
  tokens: z.array(
    z.object({
      token_id: z.string(),
      outcome: z.string(),
      price: z.number().optional().nullable(),
    })
  ),
  rewards: z.object({
    rates: z.array(z.any()).optional().nullable(),
    min_size: z.number().optional().nullable(),
    max_spread: z.number().optional().nullable(),
  }).optional().nullable(),
  minimum_order_size: z.number().optional().nullable(),
  minimum_tick_size: z.number().optional().nullable(),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  end_date_iso: z.string().optional().nullable(),
  game_start_time: z.string().optional().nullable(),
  question: z.string().optional().nullable(),
  market_slug: z.string().optional().nullable(),
  min_incentive_size: z.string().optional().nullable(),
  max_incentive_spread: z.string().optional().nullable(),
  active: z.boolean().optional().nullable(),
  closed: z.boolean().optional().nullable(),
  seconds_delay: z.number().optional().nullable(),
  icon: z.string().optional().nullable(),
  fpmm: z.string().optional().nullable(),
}).passthrough();

export type ClobMarket = z.infer<typeof ClobMarketSchema>;

/**
 * CLOB Markets list response
 */
export const ClobMarketsResponseSchema = z.object({
  data: z.array(ClobMarketSchema),
  next_cursor: z.string().optional(),
  limit: z.number().optional(),
  count: z.number().optional(),
});

export type ClobMarketsResponse = z.infer<typeof ClobMarketsResponseSchema>;

/**
 * Orderbook entry
 */
export const OrderbookEntrySchema = z.object({
  price: z.string(),
  size: z.string(),
});

/**
 * Orderbook response
 */
export const OrderbookSchema = z.object({
  market: z.string().optional(),
  asset_id: z.string().optional(),
  hash: z.string().optional(),
  timestamp: z.string().optional(),
  bids: z.array(OrderbookEntrySchema),
  asks: z.array(OrderbookEntrySchema),
});

export type Orderbook = z.infer<typeof OrderbookSchema>;

/**
 * Price response
 */
export const PriceResponseSchema = z.object({
  price: z.string(),
});

// ============ Internal Types (Our Schema) ============

/**
 * Normalized market metadata - our internal format
 * Maps to data/markets/{id}/meta.json
 */
export const MarketMetaSchema = z.object({
  // Identity
  id: z.string(),
  slug: z.string(),
  question: z.string(),
  description: z.string(),
  category: z.string(),
  tags: z.array(z.string()),

  // Status
  active: z.boolean(),
  closed: z.boolean(),
  resolved: z.boolean(),
  resolutionSource: z.string().optional(),

  // Timing
  createdAt: z.string(),
  endDate: z.string(),
  resolvedAt: z.string().optional(),

  // Market data (snapshot)
  volume: z.number(),
  volume24h: z.number(),
  liquidity: z.number(),

  // Prices
  outcomeYes: z.object({
    tokenId: z.string(),
    price: z.number(),
    lastUpdated: z.string(),
  }),
  outcomeNo: z.object({
    tokenId: z.string(),
    price: z.number(),
    lastUpdated: z.string(),
  }),

  // Metadata
  fetchedAt: z.string(),
  source: z.enum(["gamma", "clob"]),
});

export type MarketMeta = z.infer<typeof MarketMetaSchema>;

/**
 * Normalized orderbook - our internal format
 * Maps to data/markets/{id}/orderbook.json
 */
export const NormalizedOrderbookSchema = z.object({
  marketId: z.string(),
  tokenId: z.string(),
  fetchedAt: z.string(),

  // Best prices
  bestBid: z.number().nullable(),
  bestAsk: z.number().nullable(),
  spread: z.number().nullable(),
  midPrice: z.number().nullable(),

  // Depth
  bids: z.array(
    z.object({
      price: z.number(),
      size: z.number(),
      total: z.number(), // Cumulative
    })
  ),
  asks: z.array(
    z.object({
      price: z.number(),
      size: z.number(),
      total: z.number(),
    })
  ),

  // Summary
  totalBidLiquidity: z.number(),
  totalAskLiquidity: z.number(),
});

export type NormalizedOrderbook = z.infer<typeof NormalizedOrderbookSchema>;

// ============ Helper Functions ============

/**
 * Parse Gamma market prices from string array
 */
export function parseGammaPrices(
  outcomePrices?: string[] | null
): { yes: number; no: number } {
  if (!outcomePrices || outcomePrices.length < 2) {
    return { yes: 0.5, no: 0.5 };
  }
  return {
    yes: parseFloat(outcomePrices[0]) || 0.5,
    no: parseFloat(outcomePrices[1]) || 0.5,
  };
}

/**
 * Convert Gamma market to our normalized format
 */
export function normalizeGammaMarket(gamma: GammaMarket): MarketMeta {
  const prices = parseGammaPrices(gamma.outcomePrices);
  const now = new Date().toISOString();

  // Get token IDs (Yes is usually first, No is second)
  const tokenIds = gamma.clobTokenIds ?? [];

  return {
    id: gamma.id,
    slug: gamma.slug,
    question: gamma.question,
    description: gamma.description ?? "",
    category: gamma.category ?? "Unknown",
    tags: gamma.tags ?? [],

    active: gamma.active,
    closed: gamma.closed,
    resolved: gamma.resolved ?? false,
    resolutionSource: gamma.resolutionSource ?? undefined,

    createdAt: gamma.createdAt ?? now,
    endDate: gamma.endDate ?? now,
    resolvedAt: gamma.resolvedAt ?? undefined,

    volume: typeof gamma.volume === "number" ? gamma.volume : 0,
    volume24h: typeof gamma.volume24hr === "number" ? gamma.volume24hr : 0,
    liquidity: typeof gamma.liquidity === "number" ? gamma.liquidity : 0,

    outcomeYes: {
      tokenId: tokenIds[0] ?? "",
      price: prices.yes,
      lastUpdated: now,
    },
    outcomeNo: {
      tokenId: tokenIds[1] ?? "",
      price: prices.no,
      lastUpdated: now,
    },

    fetchedAt: now,
    source: "gamma",
  };
}

/**
 * Normalize orderbook response
 */
export function normalizeOrderbook(
  raw: Orderbook,
  marketId: string,
  tokenId: string
): NormalizedOrderbook {
  const now = new Date().toISOString();

  // Parse bids (sorted high to low)
  let bidTotal = 0;
  const bids = raw.bids.map((b) => {
    const price = parseFloat(b.price);
    const size = parseFloat(b.size);
    bidTotal += size;
    return { price, size, total: bidTotal };
  });

  // Parse asks (sorted low to high)
  let askTotal = 0;
  const asks = raw.asks.map((a) => {
    const price = parseFloat(a.price);
    const size = parseFloat(a.size);
    askTotal += size;
    return { price, size, total: askTotal };
  });

  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
  const midPrice = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;

  return {
    marketId,
    tokenId,
    fetchedAt: now,
    bestBid,
    bestAsk,
    spread,
    midPrice,
    bids,
    asks,
    totalBidLiquidity: bidTotal,
    totalAskLiquidity: askTotal,
  };
}
