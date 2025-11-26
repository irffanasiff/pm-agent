/**
 * Market Schema
 * Re-exports market types and adds data directory utilities
 */

import fs from "fs/promises";
import path from "path";
import { getConfig } from "../core/config.js";
import {
  MarketMetaSchema,
  NormalizedOrderbookSchema,
  type MarketMeta,
  type NormalizedOrderbook,
} from "../tools/polymarket/types.js";

// Re-export types
export { MarketMetaSchema, NormalizedOrderbookSchema };
export type { MarketMeta, NormalizedOrderbook };

/**
 * Get the data directory for a market
 */
export function getMarketDir(marketId: string): string {
  const config = getConfig();
  return path.join(config.defaults.dataDir, "markets", marketId);
}

/**
 * Ensure market directory exists
 */
export async function ensureMarketDir(marketId: string): Promise<string> {
  const dir = getMarketDir(marketId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Save market metadata
 */
export async function saveMarketMeta(meta: MarketMeta): Promise<void> {
  const dir = await ensureMarketDir(meta.id);
  const filePath = path.join(dir, "meta.json");
  await fs.writeFile(filePath, JSON.stringify(meta, null, 2));
}

/**
 * Load market metadata
 */
export async function loadMarketMeta(marketId: string): Promise<MarketMeta | null> {
  const filePath = path.join(getMarketDir(marketId), "meta.json");
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return MarketMetaSchema.parse(JSON.parse(content));
  } catch {
    return null;
  }
}

/**
 * Save orderbook data
 */
export async function saveOrderbook(orderbook: NormalizedOrderbook): Promise<void> {
  const dir = await ensureMarketDir(orderbook.marketId);
  const filePath = path.join(dir, "orderbook.json");
  await fs.writeFile(filePath, JSON.stringify(orderbook, null, 2));
}

/**
 * Load orderbook data
 */
export async function loadOrderbook(marketId: string): Promise<NormalizedOrderbook | null> {
  const filePath = path.join(getMarketDir(marketId), "orderbook.json");
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return NormalizedOrderbookSchema.parse(JSON.parse(content));
  } catch {
    return null;
  }
}

/**
 * Check if market data exists
 */
export async function marketExists(marketId: string): Promise<boolean> {
  const filePath = path.join(getMarketDir(marketId), "meta.json");
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all market IDs in the data directory
 */
export async function listMarketIds(): Promise<string[]> {
  const config = getConfig();
  const marketsDir = path.join(config.defaults.dataDir, "markets");

  try {
    const entries = await fs.readdir(marketsDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
