/**
 * Prompt Registry Types
 * Versioned prompt management
 */

// ============================================
// PROMPT VARIANT
// ============================================

/**
 * A versioned prompt variant
 */
export interface PromptVariant {
  /** Unique identifier (e.g., "polymarket_researcher_v2") */
  id: string;

  /** Human-readable name */
  name: string;

  /** Version number */
  version: string;

  /** Description of what this prompt does */
  description: string;

  /** Domain this prompt is for ("generic" for domain-agnostic) */
  domain: string;

  /** Agent role this prompt is for */
  role: string;

  /** The system prompt */
  systemPrompt?: string;

  /** The main prompt template */
  template: string;

  /** Few-shot examples */
  examples?: PromptExample[];

  /** Output format instructions */
  outputFormat?: string;

  /** Tags for filtering/searching */
  tags?: string[];

  /** When this variant was created */
  createdAt: string;

  /** Whether this is the default for its domain+role */
  isDefault?: boolean;

  /** Parent variant ID if this is a derivative */
  parentId?: string;

  /** Performance metrics from evals */
  metrics?: PromptMetrics;
}

/**
 * Few-shot example
 */
export interface PromptExample {
  /** Example input */
  input: string;

  /** Expected output */
  output: string;

  /** Why this is a good example */
  rationale?: string;
}

/**
 * Prompt performance metrics
 */
export interface PromptMetrics {
  /** Number of times used */
  usageCount: number;

  /** Average quality score from evals (0-1) */
  avgQualityScore?: number;

  /** Average cost per use */
  avgCostUsd?: number;

  /** Average latency */
  avgLatencyMs?: number;

  /** Success rate */
  successRate?: number;
}

// ============================================
// PROMPT REGISTRY
// ============================================

/**
 * Prompt registry interface
 */
export interface IPromptRegistry {
  /**
   * Get a prompt variant by ID
   */
  get(id: string): PromptVariant | undefined;

  /**
   * Get the default prompt for a domain and role
   */
  getDefault(domain: string, role: string): PromptVariant | undefined;

  /**
   * Get all variants for a domain and role
   */
  getVariants(domain: string, role: string): PromptVariant[];

  /**
   * Register a new prompt variant
   */
  register(variant: PromptVariant): void;

  /**
   * List all registered prompts
   */
  list(): PromptVariant[];

  /**
   * Render a prompt with variables
   */
  render(id: string, variables: Record<string, unknown>): string;
}

// ============================================
// PROMPT BUILDER
// ============================================

/**
 * Options for building a prompt
 */
export interface PromptBuildOptions {
  /** Variables to substitute in template */
  variables?: Record<string, unknown>;

  /** Additional context to append */
  additionalContext?: string;

  /** Domain-specific context */
  domainContext?: string;

  /** Override output format */
  outputFormatOverride?: string;

  /** Include examples */
  includeExamples?: boolean;

  /** Maximum examples to include */
  maxExamples?: number;
}
