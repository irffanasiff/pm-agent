# Scout Agent - Polymarket Trader Monitoring System

## Overview

The Scout agent monitors high-value Polymarket traders in real-time and triggers alerts/analysis when they make trades. This enables "smart money" tracking for research and trading signals.

## Polymarket API Deep Dive

### Available APIs

| API | Base URL | Auth Required | Use Case |
|-----|----------|---------------|----------|
| **Data API** | `https://data-api.polymarket.com/` | No | Historical trades, positions, activity |
| **CLOB REST** | `https://clob.polymarket.com/` | Yes (L2) | Trading, authenticated queries |
| **RTDS WebSocket** | `wss://ws-subscriptions-clob.polymarket.com/ws/` | Optional | Real-time trades stream |
| **Gamma API** | `https://gamma-api.polymarket.com/` | No | Market metadata |

### Key Endpoints for Trader Monitoring

#### 1. Data API - Activity Endpoint
```
GET https://data-api.polymarket.com/activity?user={wallet_address}
```

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `user` | string | **Required.** Wallet address to monitor |
| `type` | string | Filter: TRADE, SPLIT, MERGE, REDEEM, REWARD, CONVERSION |
| `market` | string | Condition ID (comma-separated for multiple) |
| `start` | number | Start timestamp (seconds) |
| `end` | number | End timestamp (seconds) |
| `side` | string | BUY or SELL |
| `sortBy` | string | TIMESTAMP, TOKENS, or CASH |
| `sortDirection` | string | ASC or DESC |
| `limit` | number | Max 500, default 100 |
| `offset` | number | Pagination offset |

**Response includes:** timestamp, type, size, USD value, transaction hash, market/outcome details

#### 2. Data API - Trades Endpoint
```
GET https://data-api.polymarket.com/trades?user={wallet_address}
```

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `user` | string | Wallet address |
| `takerOnly` | boolean | Only taker orders (default: true) |
| `side` | string | BUY or SELL |
| `market` | string | Condition ID |
| `filterType` | string | CASH or TOKENS |
| `filterAmount` | number | Amount threshold |
| `limit` | number | Max 500 |

#### 3. Data API - Positions Endpoint
```
GET https://data-api.polymarket.com/positions?user={wallet_address}
```

Returns current open positions with PnL metrics.

#### 4. WebSocket Real-Time Data Stream

```typescript
// Connection
const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/');

// Subscribe to all trades
ws.send(JSON.stringify({
  type: 'subscribe',
  subscriptions: [{
    topic: 'activity',
    type: 'trades',
    // filters: '{"market_slug":"..."}' // Optional market filter
  }]
}));
```

**Trade Message Payload:**
```typescript
interface TradeMessage {
  proxyWallet: string;      // Trader's wallet address
  conditionId: string;      // Market condition ID
  eventSlug: string;        // Event identifier
  marketSlug: string;       // Market identifier
  outcome: string;          // YES/NO
  outcomeIndex: number;     // 0 or 1
  side: 'BUY' | 'SELL';
  size: string;             // Token amount
  price: string;            // Price paid
  timestamp: string;        // ISO timestamp
  transactionHash: string;  // On-chain tx hash
  name: string;             // Trader display name
  pseudonym: string;        // Trader pseudonym
  profileImage: string;     // Avatar URL
}
```

**Key Limitation:** WebSocket does NOT support filtering by wallet address. Must filter client-side using `proxyWallet` field.

---

## Architecture Design

### Option Analysis

| Approach | Latency | Complexity | Traffic | Reliability |
|----------|---------|------------|---------|-------------|
| **Polling Only** | 5-30s | Low | Medium | High |
| **WebSocket Only** | <1s | Medium | High | Medium |
| **Hybrid (Recommended)** | <1s | Medium-High | Medium | High |

### Recommended: Hybrid Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SCOUT SYSTEM                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│  │   Watchlist  │     │  Trade Detector  │     │   Alert     │ │
│  │   Manager    │────▶│                  │────▶│   Router    │ │
│  │              │     │  - WebSocket     │     │             │ │
│  │  - Add/Remove│     │  - Polling       │     │  - Webhook  │ │
│  │  - Priority  │     │  - Deduplication │     │  - Queue    │ │
│  └──────────────┘     └──────────────────┘     └─────────────┘ │
│         │                      │                      │         │
│         ▼                      ▼                      ▼         │
│  ┌──────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│  │   Database   │     │    Trade Store   │     │  Analyst    │ │
│  │              │     │                  │     │   System    │ │
│  │  - Traders   │     │  - History       │     │             │ │
│  │  - Trades    │     │  - Positions     │     │  - Research │ │
│  │  - Alerts    │     │  - PnL           │     │  - Signals  │ │
│  └──────────────┘     └──────────────────┘     └─────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Component Design

#### 1. Watchlist Manager
```typescript
interface WatchedTrader {
  id: string;
  walletAddress: string;
  displayName?: string;
  priority: 'high' | 'medium' | 'low';

  // Monitoring config
  minTradeSize: number;        // Minimum USD to alert
  markets?: string[];          // Specific markets (or all)
  sides?: ('BUY' | 'SELL')[];  // Specific sides (or both)

  // State
  lastSeenTradeAt?: string;
  lastPolledAt?: string;
  totalTrackedTrades: number;

  // Metadata
  addedAt: string;
  addedReason?: string;
  tags?: string[];
}
```

#### 2. Trade Detector
- **WebSocket Stream:** Subscribe to all trades, filter by watchlist wallets
- **Polling Fallback:** Every 30s for high-priority, 60s for medium, 300s for low
- **Deduplication:** Track `transactionHash` to avoid duplicate alerts

```typescript
interface DetectedTrade {
  id: string;
  traderId: string;
  walletAddress: string;

  // Trade details
  market: {
    conditionId: string;
    slug: string;
    question: string;
  };
  outcome: 'YES' | 'NO';
  side: 'BUY' | 'SELL';
  size: number;           // Token amount
  price: number;          // Price per token
  usdValue: number;       // Total USD value

  // Timing
  timestamp: string;
  detectedAt: string;
  latencyMs: number;      // Detection latency

  // On-chain
  transactionHash: string;

  // Detection source
  source: 'websocket' | 'polling';
}
```

#### 3. Alert Router
```typescript
interface AlertConfig {
  // Delivery
  webhookUrl?: string;
  webhookSecret?: string;

  // Thresholds
  minUsdValue: number;

  // Actions
  triggerAnalysis: boolean;    // Spawn Analyst agent
  triggerNotification: boolean;

  // Rate limiting
  maxAlertsPerMinute: number;
  cooldownPerTrader: number;   // Seconds between alerts for same trader
}

interface TradeAlert {
  id: string;
  trade: DetectedTrade;
  trader: WatchedTrader;

  // Analysis trigger
  analysisRequested: boolean;
  analysisId?: string;

  // Delivery status
  webhookSent: boolean;
  webhookResponse?: string;

  createdAt: string;
}
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

#### 1.1 Extend Polymarket Client
```typescript
// Add to src/tools/polymarket/client.ts

// Data API methods
async getTraderActivity(wallet: string, options?: ActivityOptions): Promise<Activity[]>
async getTraderTrades(wallet: string, options?: TradeOptions): Promise<Trade[]>
async getTraderPositions(wallet: string): Promise<Position[]>

// WebSocket connection
createTradeStream(onTrade: (trade: Trade) => void): TradeStreamHandle
```

#### 1.2 Create Scout Types
```typescript
// src/systems/scout/types.ts

export interface ScoutInput {
  // Add traders to watch
  addTraders?: WatchedTrader[];

  // Remove traders
  removeTraders?: string[];

  // Query
  getTraders?: boolean;
  getRecentTrades?: { traderId?: string; limit?: number };
}

export interface ScoutOutput {
  traders: WatchedTrader[];
  recentTrades: DetectedTrade[];
  alerts: TradeAlert[];
}
```

### Phase 2: Trade Detection (Week 2)

#### 2.1 WebSocket Client
```typescript
// src/systems/scout/websocket/client.ts

export class PolymarketTradeStream {
  private ws: WebSocket;
  private watchlist: Set<string>;
  private onTrade: (trade: DetectedTrade) => void;

  connect(): void;
  disconnect(): void;

  updateWatchlist(wallets: string[]): void;

  // Handles reconnection, heartbeat
  private handleMessage(data: TradeMessage): void;
  private filterByWatchlist(trade: TradeMessage): boolean;
}
```

#### 2.2 Polling Service
```typescript
// src/systems/scout/polling/service.ts

export class TraderPollingService {
  private traders: Map<string, WatchedTrader>;
  private lastSeen: Map<string, string>; // wallet -> last trade timestamp

  async pollTrader(wallet: string): Promise<DetectedTrade[]>;

  // Scheduled polling based on priority
  startPolling(): void;
  stopPolling(): void;
}
```

### Phase 3: Alert System (Week 3)

#### 3.1 Alert Router
```typescript
// src/systems/scout/alerts/router.ts

export class AlertRouter {
  private config: AlertConfig;
  private rateLimiter: RateLimiter;

  async processDetectedTrade(trade: DetectedTrade, trader: WatchedTrader): Promise<TradeAlert>;

  private async sendWebhook(alert: TradeAlert): Promise<void>;
  private async triggerAnalysis(alert: TradeAlert): Promise<string>;
}
```

#### 3.2 Webhook Payload
```typescript
// Webhook POST body
interface WebhookPayload {
  event: 'trade_detected';
  timestamp: string;

  trader: {
    id: string;
    name: string;
    wallet: string;
  };

  trade: {
    market: string;
    question: string;
    outcome: 'YES' | 'NO';
    side: 'BUY' | 'SELL';
    size: number;
    price: number;
    usdValue: number;
    transactionHash: string;
  };

  context: {
    traderTotalPositionInMarket?: number;
    marketCurrentPrice?: number;
    traderPnL?: number;
  };
}
```

### Phase 4: Integration with Analyst (Week 4)

When a significant trade is detected, spawn an Analyst agent to research:

```typescript
// Trigger analyst on large trade
if (trade.usdValue > config.analysisThreshold) {
  const analysisInput = {
    subject: `Why did ${trader.name} ${trade.side} $${trade.usdValue} of "${trade.market.question}"?`,
    depth: 'standard',
    focus: ['facts', 'prediction'],
    context: {
      trader: trader,
      trade: trade,
      marketPrice: await getMarketPrice(trade.market.conditionId),
    }
  };

  await analystSystem.run(analysisInput);
}
```

---

## Database Schema (Supabase)

```sql
-- Watched traders
CREATE TABLE scout_traders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL UNIQUE,
  display_name TEXT,
  priority TEXT DEFAULT 'medium',
  min_trade_size DECIMAL DEFAULT 100,
  markets TEXT[], -- Condition IDs, NULL = all

  -- State
  last_seen_trade_at TIMESTAMPTZ,
  last_polled_at TIMESTAMPTZ,
  total_tracked_trades INTEGER DEFAULT 0,

  -- Meta
  added_at TIMESTAMPTZ DEFAULT NOW(),
  added_reason TEXT,
  tags TEXT[],

  is_active BOOLEAN DEFAULT true
);

-- Detected trades
CREATE TABLE scout_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_id UUID REFERENCES scout_traders(id),
  wallet_address TEXT NOT NULL,

  -- Trade details
  condition_id TEXT NOT NULL,
  market_slug TEXT,
  market_question TEXT,
  outcome TEXT NOT NULL,
  side TEXT NOT NULL,
  size DECIMAL NOT NULL,
  price DECIMAL NOT NULL,
  usd_value DECIMAL NOT NULL,

  -- Timing
  trade_timestamp TIMESTAMPTZ NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  latency_ms INTEGER,

  -- On-chain
  transaction_hash TEXT UNIQUE NOT NULL,

  -- Detection
  source TEXT NOT NULL, -- 'websocket' or 'polling'

  CONSTRAINT unique_trade UNIQUE (transaction_hash)
);

-- Alerts
CREATE TABLE scout_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID REFERENCES scout_trades(id),
  trader_id UUID REFERENCES scout_traders(id),

  -- Analysis
  analysis_requested BOOLEAN DEFAULT false,
  analysis_id UUID,

  -- Delivery
  webhook_sent BOOLEAN DEFAULT false,
  webhook_response TEXT,
  webhook_sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_trades_trader ON scout_trades(trader_id);
CREATE INDEX idx_trades_timestamp ON scout_trades(trade_timestamp DESC);
CREATE INDEX idx_trades_wallet ON scout_trades(wallet_address);
CREATE INDEX idx_alerts_created ON scout_alerts(created_at DESC);
```

---

## Configuration

```typescript
// src/systems/scout/config.ts

export interface ScoutConfig {
  // API
  dataApiBaseUrl: string;
  wsUrl: string;

  // Polling
  pollingIntervals: {
    high: number;    // ms, e.g., 30000
    medium: number;  // ms, e.g., 60000
    low: number;     // ms, e.g., 300000
  };

  // Alerts
  alerts: {
    webhookUrl?: string;
    webhookSecret?: string;
    minUsdValue: number;
    analysisThreshold: number;
    maxAlertsPerMinute: number;
    cooldownPerTrader: number;
  };

  // WebSocket
  ws: {
    reconnectDelay: number;
    pingInterval: number;
    maxReconnectAttempts: number;
  };
}
```

---

## Usage Example

```typescript
import { ScoutSystem } from './systems/scout';

const scout = new ScoutSystem(config);

// Add traders to watch
await scout.addTraders([
  {
    walletAddress: '0x1234...',
    displayName: 'Whale Alpha',
    priority: 'high',
    minTradeSize: 1000,
  },
  {
    walletAddress: '0x5678...',
    displayName: 'Smart Money',
    priority: 'medium',
    minTradeSize: 500,
  },
]);

// Set up alert handler
scout.onAlert(async (alert) => {
  console.log(`${alert.trader.displayName} ${alert.trade.side} $${alert.trade.usdValue}`);

  // Trigger analysis for large trades
  if (alert.trade.usdValue > 5000) {
    await analystSystem.run({
      subject: `Analyze trade by ${alert.trader.displayName}`,
      context: { trade: alert.trade }
    });
  }
});

// Start monitoring
await scout.start();
```

---

## Sources

- [Polymarket Data API - Activity](https://docs.polymarket.com/developers/misc-endpoints/data-api-activity)
- [Polymarket Trades Data API](https://docs.polymarket.com/developers/CLOB/trades/trades-data-api)
- [Polymarket RTDS Overview](https://docs.polymarket.com/developers/RTDS/RTDS-overview)
- [Polymarket Real-Time Data Client](https://github.com/Polymarket/real-time-data-client)
- [Polymarket Python CLOB Client](https://github.com/Polymarket/py-clob-client)
- [Polymarket Data API Gist](https://gist.github.com/shaunlebron/0dd3338f7dea06b8e9f8724981bb13bf)
