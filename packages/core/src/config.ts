/**
 * Configuration Management
 * Loads and validates base configuration from environment variables
 */

import { z } from "zod";
import "dotenv/config";

// Base environment schema - shared across all apps
const baseEnvSchema = z.object({
  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),

  // Polymarket
  POLYMARKET_PROXY_URL: z.string().url().optional(),
  PROXY_SECRET: z.string().optional(),
  POLYMARKET_API_KEY: z.string().optional(),
  POLYMARKET_SECRET: z.string().optional(),
  POLYMARKET_PASSPHRASE: z.string().optional(),

  // Supabase
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_KEY: z.string().optional(),

  // General
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATA_DIR: z.string().default("./data"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

/**
 * Base configuration - shared across all apps
 */
export interface BaseConfig {
  anthropic: {
    apiKey: string;
  };

  polymarket: {
    proxyUrl?: string;
    proxySecret?: string;
    apiKey?: string;
    secret?: string;
    passphrase?: string;
  };

  supabase?: {
    url: string;
    key: string;
  };

  env: {
    logLevel: "debug" | "info" | "warn" | "error";
    dataDir: string;
    nodeEnv: "development" | "production" | "test";
  };
}

let baseConfigInstance: BaseConfig | null = null;

/**
 * Load and validate base configuration
 */
export function loadBaseConfig(): BaseConfig {
  const parseResult = baseEnvSchema.safeParse(process.env);

  if (!parseResult.success) {
    const errors = parseResult.error.issues
      .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Configuration validation failed:\n${errors}`);
  }

  const env = parseResult.data;

  return {
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
    },

    polymarket: {
      proxyUrl: env.POLYMARKET_PROXY_URL,
      proxySecret: env.PROXY_SECRET,
      apiKey: env.POLYMARKET_API_KEY,
      secret: env.POLYMARKET_SECRET,
      passphrase: env.POLYMARKET_PASSPHRASE,
    },

    supabase: env.SUPABASE_URL && env.SUPABASE_KEY
      ? {
          url: env.SUPABASE_URL,
          key: env.SUPABASE_KEY,
        }
      : undefined,

    env: {
      logLevel: env.LOG_LEVEL,
      dataDir: env.DATA_DIR,
      nodeEnv: env.NODE_ENV,
    },
  };
}

/**
 * Get base configuration (lazy-loaded singleton)
 */
export function getBaseConfig(): BaseConfig {
  if (!baseConfigInstance) {
    baseConfigInstance = loadBaseConfig();
  }
  return baseConfigInstance;
}

/**
 * Reset config (for testing)
 */
export function resetBaseConfig(): void {
  baseConfigInstance = null;
}

/**
 * Helper to require environment variable
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Helper to get optional environment variable with default
 */
export function getEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}
