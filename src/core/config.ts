import { z } from "zod";
import "dotenv/config";

/**
 * Configuration Management
 * Loads and validates all config from environment variables
 */

// Schema for environment validation
const envSchema = z.object({
  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),

  // Parallel.ai
  PARALLEL_API_KEY: z.string().min(1, "PARALLEL_API_KEY is required"),

  // Polymarket
  POLYMARKET_PROXY_URL: z.string().url("POLYMARKET_PROXY_URL must be a valid URL"),
  PROXY_SECRET: z.string().min(1, "PROXY_SECRET is required"),
  POLYMARKET_API_KEY: z.string().optional(),
  POLYMARKET_SECRET: z.string().optional(),
  POLYMARKET_PASSPHRASE: z.string().optional(),

  // Optional overrides
  DEFAULT_MODEL: z.enum(["haiku", "sonnet", "opus"]).default("sonnet"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATA_DIR: z.string().default("./data"),
});

type Env = z.infer<typeof envSchema>;

// Agent profile configuration
export interface AgentProfile {
  model: "haiku" | "sonnet" | "opus";
  maxTurns: number;
  maxBudgetUsd: number;
  tools: string[];
  mcpServers?: Record<string, MCPServerConfig>;
  retries: number;
  backoffMs: number;
}

export interface MCPServerConfig {
  type: "sse" | "stdio" | "http";
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

// Validated configuration
export interface Config {
  anthropic: {
    apiKey: string;
  };

  parallel: {
    apiKey: string;
    taskMcpUrl: string;
    searchMcpUrl: string;
  };

  polymarket: {
    proxyUrl: string;
    proxySecret: string;
    apiKey?: string;
    secret?: string;
    passphrase?: string;
  };

  defaults: {
    model: "haiku" | "sonnet" | "opus";
    logLevel: "debug" | "info" | "warn" | "error";
    dataDir: string;
  };

  profiles: {
    discovery: AgentProfile;
    research: AgentProfile;
    critic: AgentProfile;
  };
}

/**
 * Load and validate configuration from environment
 */
function loadConfig(): Config {
  // Parse and validate environment
  const parseResult = envSchema.safeParse(process.env);

  if (!parseResult.success) {
    const errors = parseResult.error.errors
      .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  const env = parseResult.data;

  // Build config object
  const config: Config = {
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
    },

    parallel: {
      apiKey: env.PARALLEL_API_KEY,
      taskMcpUrl: "https://task-mcp.parallel.ai/mcp",
      searchMcpUrl: "https://search-mcp.parallel.ai/mcp",
    },

    polymarket: {
      proxyUrl: env.POLYMARKET_PROXY_URL,
      proxySecret: env.PROXY_SECRET,
      apiKey: env.POLYMARKET_API_KEY,
      secret: env.POLYMARKET_SECRET,
      passphrase: env.POLYMARKET_PASSPHRASE,
    },

    defaults: {
      model: env.DEFAULT_MODEL,
      logLevel: env.LOG_LEVEL,
      dataDir: env.DATA_DIR,
    },

    // ============================================================
    // AGENT PROFILES
    // Each profile defines: model, budget, turns, tools
    // Budgets are per-agent-run, not per-pipeline
    // ============================================================
    profiles: {
      // Discovery Agent: Finds relevant markets from pre-fetched list
      // Uses Sonnet (was Haiku, but Haiku not available in SDK yet)
      discovery: {
        model: "haiku",
        maxTurns: 10,           // Increased: needs to read large JSON + write output
        maxBudgetUsd: 0.50,     // Increased: $0.05 was too low, spent $0.12
        tools: ["Bash", "Read", "Write", "Grep"],  // Added Write for output
        retries: 2,
        backoffMs: 1000,
      },

      // Research Agent: Deep research on each market
      // Uses Sonnet for quality, has MCP access for web research
      research: {
        model: "sonnet",
        maxTurns: 25,           // Increased: complex research needs more turns
        maxBudgetUsd: 1.00,     // Increased: deep research costs more
        tools: ["Bash", "Read", "Write", "WebSearch"],
        mcpServers: {
          "parallel-task": {
            type: "sse",
            url: "https://task-mcp.parallel.ai/mcp",
            headers: {
              Authorization: `Bearer ${env.PARALLEL_API_KEY}`,
            },
          },
          "parallel-search": {
            type: "sse",
            url: "https://search-mcp.parallel.ai/mcp",
            headers: {
              Authorization: `Bearer ${env.PARALLEL_API_KEY}`,
            },
          },
        },
        retries: 3,
        backoffMs: 2000,
      },

      // Critic Agent: Evaluates research quality
      // Uses Sonnet (was Haiku) for better judgment
      critic: {
        model: "haiku",
        maxTurns: 10,           // Increased: needs to read research + write evaluation
        maxBudgetUsd: 0.50,     // Increased: evaluation needs thorough analysis
        tools: ["Read", "Write", "Grep"],  // Added Write for output
        retries: 2,
        backoffMs: 1000,
      },
    },
  };

  return config;
}

// Singleton config instance
let configInstance: Config | null = null;

/**
 * Get configuration (lazy-loaded singleton)
 */
export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Get a specific agent profile
 */
export function getProfile(name: keyof Config["profiles"]): AgentProfile {
  return getConfig().profiles[name];
}

/**
 * Reset config (for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}

// Export for convenience
export const config = {
  get: getConfig,
  getProfile,
  reset: resetConfig,
};
