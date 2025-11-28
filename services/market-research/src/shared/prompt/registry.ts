/**
 * Prompt Registry
 * Manages versioned prompts across domains and roles
 */

import type {
  IPromptRegistry,
  PromptVariant,
  PromptBuildOptions,
} from "./types.js";

/**
 * In-memory prompt registry
 */
export class PromptRegistry implements IPromptRegistry {
  private readonly prompts: Map<string, PromptVariant> = new Map();
  private readonly defaults: Map<string, string> = new Map(); // domain:role -> id

  /**
   * Get a prompt variant by ID
   */
  get(id: string): PromptVariant | undefined {
    return this.prompts.get(id);
  }

  /**
   * Get the default prompt for a domain and role
   */
  getDefault(domain: string, role: string): PromptVariant | undefined {
    const key = `${domain}:${role}`;
    const id = this.defaults.get(key);
    if (id) {
      return this.prompts.get(id);
    }

    // Fallback to generic domain
    const genericKey = `generic:${role}`;
    const genericId = this.defaults.get(genericKey);
    if (genericId) {
      return this.prompts.get(genericId);
    }

    return undefined;
  }

  /**
   * Get all variants for a domain and role
   */
  getVariants(domain: string, role: string): PromptVariant[] {
    return Array.from(this.prompts.values()).filter(
      (p) => p.domain === domain && p.role === role
    );
  }

  /**
   * Register a new prompt variant
   */
  register(variant: PromptVariant): void {
    this.prompts.set(variant.id, variant);

    if (variant.isDefault) {
      const key = `${variant.domain}:${variant.role}`;
      this.defaults.set(key, variant.id);
    }
  }

  /**
   * List all registered prompts
   */
  list(): PromptVariant[] {
    return Array.from(this.prompts.values());
  }

  /**
   * Render a prompt with variables
   */
  render(id: string, variables: Record<string, unknown>): string {
    const variant = this.prompts.get(id);
    if (!variant) {
      throw new Error(`Prompt not found: ${id}`);
    }

    return this.renderTemplate(variant.template, variables);
  }

  /**
   * Build a complete prompt from a variant
   */
  build(id: string, options: PromptBuildOptions = {}): string {
    const variant = this.prompts.get(id);
    if (!variant) {
      throw new Error(`Prompt not found: ${id}`);
    }

    const parts: string[] = [];

    // System prompt
    if (variant.systemPrompt) {
      parts.push(variant.systemPrompt);
    }

    // Main template with variables
    const template = this.renderTemplate(
      variant.template,
      options.variables ?? {}
    );
    parts.push(template);

    // Domain context
    if (options.domainContext) {
      parts.push(options.domainContext);
    }

    // Additional context
    if (options.additionalContext) {
      parts.push(options.additionalContext);
    }

    // Examples
    if (options.includeExamples !== false && variant.examples?.length) {
      const maxExamples = options.maxExamples ?? 3;
      const examples = variant.examples.slice(0, maxExamples);
      parts.push(this.formatExamples(examples));
    }

    // Output format
    const outputFormat = options.outputFormatOverride ?? variant.outputFormat;
    if (outputFormat) {
      parts.push(outputFormat);
    }

    return parts.join("\n\n");
  }

  /**
   * Build prompt for a domain/role (using default)
   */
  buildDefault(
    domain: string,
    role: string,
    options: PromptBuildOptions = {}
  ): { prompt: string; promptId: string; promptVersion: string } {
    const variant = this.getDefault(domain, role);
    if (!variant) {
      throw new Error(`No default prompt for ${domain}:${role}`);
    }

    return {
      prompt: this.build(variant.id, options),
      promptId: variant.id,
      promptVersion: variant.version,
    };
  }

  /**
   * Render template with variable substitution
   */
  private renderTemplate(
    template: string,
    variables: Record<string, unknown>
  ): string {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      const stringValue =
        typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
      result = result.split(placeholder).join(stringValue);
    }

    return result;
  }

  /**
   * Format examples section
   */
  private formatExamples(
    examples: Array<{ input: string; output: string; rationale?: string }>
  ): string {
    const formatted = examples.map((ex, i) => {
      let text = `### Example ${i + 1}\n\n**Input:**\n${ex.input}\n\n**Output:**\n${ex.output}`;
      if (ex.rationale) {
        text += `\n\n**Why:** ${ex.rationale}`;
      }
      return text;
    });

    return `## Examples\n\n${formatted.join("\n\n---\n\n")}`;
  }
}

/**
 * Global prompt registry singleton
 */
let globalRegistry: PromptRegistry | null = null;

/**
 * Get or create global prompt registry
 */
export function getPromptRegistry(): PromptRegistry {
  if (!globalRegistry) {
    globalRegistry = new PromptRegistry();
  }
  return globalRegistry;
}

/**
 * Create a new prompt registry
 */
export function createPromptRegistry(): PromptRegistry {
  return new PromptRegistry();
}

/**
 * Helper to define a prompt variant
 */
export function definePrompt(
  config: Omit<PromptVariant, "createdAt">
): PromptVariant {
  return {
    ...config,
    createdAt: new Date().toISOString(),
  };
}
