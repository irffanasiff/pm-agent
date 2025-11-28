/**
 * @probable/polymarket
 * Polymarket API client and types for the Probable platform
 */

// Types
export {
  // Gamma API
  GammaMarketSchema,
  type GammaMarket,
  GammaMarketsResponseSchema,

  // CLOB API
  ClobMarketSchema,
  type ClobMarket,
  ClobMarketsResponseSchema,
  type ClobMarketsResponse,
  OrderbookEntrySchema,
  OrderbookSchema,
  type Orderbook,
  PriceResponseSchema,

  // Data API
  TradeSchema,
  type Trade,
  ActivitySchema,
  type Activity,
  PositionSchema,
  type Position,

  // Normalized (Internal)
  MarketMetaSchema,
  type MarketMeta,
  NormalizedOrderbookSchema,
  type NormalizedOrderbook,

  // Helper functions
  parseGammaPrices,
  normalizeGammaMarket,
  normalizeOrderbook,
} from "./types.js";

// Client
export {
  PolymarketClient,
  getPolymarketClient,
  resetClient,
} from "./client.js";
