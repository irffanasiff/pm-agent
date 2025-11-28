/**
 * Polymarket API Client
 * Production-ready client with proxy support, validation, and error handling
 */

import crypto from "crypto";
import {
  getBaseConfig,
  logger,
  PolymarketError,
  NetworkError,
  type ChildLogger,
} from "@probable/core";
import {
  GammaMarketSchema,
  GammaMarketsResponseSchema,
  ClobMarketsResponseSchema,
  OrderbookSchema,
  PriceResponseSchema,
  type GammaMarket,
  type ClobMarketsResponse,
  type Orderbook,
  type MarketMeta,
  type NormalizedOrderbook,
  normalizeGammaMarket,
  normalizeOrderbook,
} from "./types.js";

const CLOB_BASE_URL = "https://clob.polymarket.com";
const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const DATA_API_BASE_URL = "https://data-api.polymarket.com";

/**
 * Polymarket API Client
 */
export class PolymarketClient {
  private log: ChildLogger;

  constructor() {
    this.log = logger.child({ component: "polymarket" });
  }

  /**
   * Build URL - either direct or through proxy
   */
  private buildUrl(baseUrl: string, path: string): string {
    const config = getBaseConfig();
    const directUrl = `${baseUrl}${path}`;

    if (config.polymarket.proxyUrl) {
      return `${config.polymarket.proxyUrl}/proxy/${encodeURIComponent(directUrl)}`;
    }

    return directUrl;
  }

  /**
   * Get headers for proxy authentication
   */
  private getProxyHeaders(): Record<string, string> {
    const config = getBaseConfig();
    if (config.polymarket.proxyUrl && config.polymarket.proxySecret) {
      return { "X-Proxy-Secret": config.polymarket.proxySecret };
    }
    return {};
  }

  /**
   * Create HMAC signature for CLOB API
   */
  private createSignature(
    secret: string,
    timestamp: string,
    method: string,
    path: string,
    body: string = ""
  ): string {
    const message = timestamp + method + path + body;
    const key = Buffer.from(secret, "base64");
    return crypto.createHmac("sha256", key).update(message).digest("base64");
  }

  /**
   * Make request to Gamma API (public, no auth required)
   */
  async gammaRequest<T>(path: string, schema?: { parse: (data: unknown) => T }): Promise<T> {
    const url = this.buildUrl(GAMMA_BASE_URL, path);
    this.log.debug("Gamma request", { path });

    try {
      const response = await fetch(url, {
        headers: {
          ...this.getProxyHeaders(),
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new PolymarketError(`Gamma API error: ${errorText}`, {
          statusCode: response.status,
          endpoint: path,
        });
      }

      const data = await response.json();

      if (schema) {
        return schema.parse(data);
      }

      return data as T;
    } catch (error) {
      if (error instanceof PolymarketError) throw error;

      if (error instanceof Error) {
        if (error.message.includes("fetch")) {
          throw new NetworkError(`Failed to reach Gamma API: ${error.message}`, error);
        }
      }

      throw new PolymarketError(`Gamma API request failed: ${error}`, {
        endpoint: path,
      });
    }
  }

  /**
   * Make authenticated request to CLOB API
   */
  async clobRequest<T>(
    method: "GET" | "POST",
    path: string,
    body?: object,
    schema?: { parse: (data: unknown) => T }
  ): Promise<T> {
    const config = getBaseConfig();

    if (!config.polymarket.apiKey || !config.polymarket.secret || !config.polymarket.passphrase) {
      throw new PolymarketError("Missing Polymarket CLOB credentials", {
        context: { hasApiKey: !!config.polymarket.apiKey },
      });
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyStr = body ? JSON.stringify(body) : "";
    const signature = this.createSignature(config.polymarket.secret, timestamp, method, path, bodyStr);

    const headers: Record<string, string> = {
      ...this.getProxyHeaders(),
      POLY_API_KEY: config.polymarket.apiKey,
      POLY_SIGNATURE: signature,
      POLY_TIMESTAMP: timestamp,
      POLY_PASSPHRASE: config.polymarket.passphrase,
      "Content-Type": "application/json",
    };

    const url = this.buildUrl(CLOB_BASE_URL, path);
    this.log.debug("CLOB request", { method, path });

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? bodyStr : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new PolymarketError(`CLOB API error: ${errorText}`, {
          statusCode: response.status,
          endpoint: path,
        });
      }

      const data = await response.json();

      if (schema) {
        return schema.parse(data);
      }

      return data as T;
    } catch (error) {
      if (error instanceof PolymarketError) throw error;

      if (error instanceof Error) {
        if (error.message.includes("fetch")) {
          throw new NetworkError(`Failed to reach CLOB API: ${error.message}`, error);
        }
      }

      throw new PolymarketError(`CLOB API request failed: ${error}`, {
        endpoint: path,
      });
    }
  }

  /**
   * Make request to Data API (public, no auth required)
   */
  async dataRequest<T>(path: string, schema?: { parse: (data: unknown) => T }): Promise<T> {
    const url = this.buildUrl(DATA_API_BASE_URL, path);
    this.log.debug("Data API request", { path });

    try {
      const response = await fetch(url, {
        headers: {
          ...this.getProxyHeaders(),
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new PolymarketError(`Data API error: ${errorText}`, {
          statusCode: response.status,
          endpoint: path,
        });
      }

      const data = await response.json();

      if (schema) {
        return schema.parse(data);
      }

      return data as T;
    } catch (error) {
      if (error instanceof PolymarketError) throw error;

      if (error instanceof Error) {
        if (error.message.includes("fetch")) {
          throw new NetworkError(`Failed to reach Data API: ${error.message}`, error);
        }
      }

      throw new PolymarketError(`Data API request failed: ${error}`, {
        endpoint: path,
      });
    }
  }

  // ============ High-Level Methods ============

  /**
   * Get list of markets from Gamma API
   */
  async getMarkets(options: {
    limit?: number;
    active?: boolean;
    closed?: boolean;
    category?: string;
  } = {}): Promise<GammaMarket[]> {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", options.limit.toString());
    if (options.active !== undefined) params.set("active", options.active.toString());
    if (options.closed !== undefined) params.set("closed", options.closed.toString());
    if (options.category) params.set("category", options.category);

    const query = params.toString() ? `?${params.toString()}` : "";
    return this.gammaRequest(`/markets${query}`, GammaMarketsResponseSchema);
  }

  /**
   * Get single market by slug from Gamma API
   */
  async getMarketBySlug(slug: string): Promise<GammaMarket> {
    return this.gammaRequest(`/markets/${slug}`, GammaMarketSchema);
  }

  /**
   * Get markets from CLOB API (with cursor pagination)
   */
  async getClobMarkets(cursor?: string): Promise<ClobMarketsResponse> {
    const query = cursor ? `?next_cursor=${cursor}` : "?next_cursor=MA==";
    return this.clobRequest("GET", `/markets${query}`, undefined, ClobMarketsResponseSchema);
  }

  /**
   * Get orderbook for a token
   */
  async getOrderbook(tokenId: string): Promise<Orderbook> {
    return this.clobRequest("GET", `/book?token_id=${tokenId}`, undefined, OrderbookSchema);
  }

  /**
   * Get price for a token
   */
  async getPrice(tokenId: string): Promise<number> {
    const response = await this.clobRequest(
      "GET",
      `/price?token_id=${tokenId}`,
      undefined,
      PriceResponseSchema
    );
    return parseFloat(response.price);
  }

  // ============ Normalized Methods (Our Schema) ============

  /**
   * Get market metadata in our normalized format
   */
  async getMarketMeta(slug: string): Promise<MarketMeta> {
    const gamma = await this.getMarketBySlug(slug);
    return normalizeGammaMarket(gamma);
  }

  /**
   * Get normalized orderbook
   */
  async getNormalizedOrderbook(marketId: string, tokenId: string): Promise<NormalizedOrderbook> {
    const raw = await this.getOrderbook(tokenId);
    return normalizeOrderbook(raw, marketId, tokenId);
  }

  /**
   * Search markets by query (filters Gamma results)
   * Only returns open markets by default (closed=false)
   */
  async searchMarkets(query: string, options: {
    limit?: number;
    active?: boolean;
    closed?: boolean;
  } = {}): Promise<GammaMarket[]> {
    const markets = await this.getMarkets({
      limit: options.limit ?? 100,
      active: options.active ?? true,
      closed: options.closed ?? false,
    });

    const queryLower = query.toLowerCase();
    return markets.filter(
      (m) =>
        m.question.toLowerCase().includes(queryLower) ||
        m.slug.toLowerCase().includes(queryLower) ||
        m.category?.toLowerCase().includes(queryLower) ||
        m.description?.toLowerCase().includes(queryLower)
    );
  }

  // ============ Data API Methods ============

  /**
   * Get activity for a wallet address
   */
  async getActivity(address: string, options: {
    limit?: number;
    offset?: number;
  } = {}): Promise<unknown[]> {
    const params = new URLSearchParams();
    params.set("address", address);
    if (options.limit) params.set("limit", options.limit.toString());
    if (options.offset) params.set("offset", options.offset.toString());

    return this.dataRequest<unknown[]>(`/activity?${params.toString()}`);
  }

  /**
   * Get positions for a wallet address
   */
  async getPositions(address: string, options: {
    sizeThreshold?: number;
  } = {}): Promise<unknown[]> {
    const params = new URLSearchParams();
    params.set("address", address);
    if (options.sizeThreshold) params.set("sizeThreshold", options.sizeThreshold.toString());

    return this.dataRequest<unknown[]>(`/positions?${params.toString()}`);
  }

  /**
   * Get trades for a market
   */
  async getTrades(conditionId: string, options: {
    limit?: number;
  } = {}): Promise<unknown[]> {
    const params = new URLSearchParams();
    params.set("market", conditionId);
    if (options.limit) params.set("limit", options.limit.toString());

    return this.dataRequest<unknown[]>(`/trades?${params.toString()}`);
  }
}

// Singleton instance
let clientInstance: PolymarketClient | null = null;

/**
 * Get the Polymarket client instance
 */
export function getPolymarketClient(): PolymarketClient {
  if (!clientInstance) {
    clientInstance = new PolymarketClient();
  }
  return clientInstance;
}

/**
 * Reset client (for testing)
 */
export function resetClient(): void {
  clientInstance = null;
}
